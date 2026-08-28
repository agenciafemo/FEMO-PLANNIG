import { sha256Hex } from "../_shared/meta-auth.ts";
import {
  exchangeGoogleCode,
  getGoogleUserInfo,
  GoogleCalendarApiError,
} from "../_shared/google-calendar.ts";
import { HttpError, methodNotAllowed } from "../_shared/http.ts";
import { createAdminClient, requiredEnv } from "../_shared/supabase.ts";

type OAuthState = {
  oauth_state_id: string;
  organization_id: string;
  requested_by: string;
  requested_scopes: string[];
  redirect_path: string;
};

function redirectTarget(
  origin: string,
  path: string,
  params: Record<string, string>,
): Response {
  const safePath = path.startsWith("/") && !path.startsWith("//")
    ? path
    : "/calendario";
  const url = new URL(safePath, origin);
  if (url.origin !== origin) {
    throw new HttpError(400, "callback_redirect_invalid");
  }
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value)
  );
  return Response.redirect(url, 303);
}

Deno.serve(async (request) => {
  if (request.method !== "GET") return methodNotAllowed({}, ["GET"]);
  const returnOrigin = new URL(requiredEnv("GOOGLE_APP_RETURN_ORIGIN")).origin;
  const query = new URL(request.url).searchParams;
  const rawState = query.get("state") ?? "";
  let state: OAuthState | null = null;

  try {
    if (rawState.length < 32 || rawState.length > 256) {
      throw new HttpError(400, "google_oauth_state_missing");
    }
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "google_calendar_server_consume_oauth_state",
      {
        _state_hash: await sha256Hex(rawState),
      },
    );
    if (error || !data?.[0]) {
      throw new HttpError(400, "google_oauth_state_invalid_or_expired");
    }
    state = data[0] as OAuthState;

    if (query.get("error")) {
      return redirectTarget(returnOrigin, state.redirect_path, {
        google_calendar_status: "error",
        reason_code: "google_oauth_denied_by_user",
      });
    }
    const code = query.get("code");
    if (!code) throw new HttpError(400, "google_authorization_code_missing");

    const token = await exchangeGoogleCode(code);
    if (!token.refreshToken) {
      throw new HttpError(409, "google_refresh_token_missing");
    }
    const account = await getGoogleUserInfo(token.accessToken);
    const { error: saveError } = await admin.rpc(
      "google_calendar_server_upsert_connection",
      {
        _oauth_state_id: state.oauth_state_id,
        _google_account_id: account.sub,
        _google_account_email: account.email,
        _access_token: token.accessToken,
        _refresh_token: token.refreshToken,
        _token_expires_at: token.expiresAt,
        _granted_scopes: token.scopes,
      },
    );
    if (saveError) throw new HttpError(500, "google_connection_save_failed");

    return redirectTarget(returnOrigin, state.redirect_path, {
      google_calendar_status: "connected",
    });
  } catch (error) {
    const reason = error instanceof HttpError
      ? error.reasonCode
      : error instanceof GoogleCalendarApiError
      ? error.reasonCode
      : "google_oauth_callback_failed";
    return redirectTarget(returnOrigin, state?.redirect_path ?? "/calendario", {
      google_calendar_status: "error",
      reason_code: reason,
    });
  }
});
