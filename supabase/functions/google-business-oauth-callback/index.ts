import { sha256Hex } from "../_shared/meta-auth.ts";
import {
  exchangeGoogleBusinessCode,
  getGoogleBusinessIdentity,
  GoogleBusinessApiError,
} from "../_shared/google-business.ts";
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
  const safePath = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  const url = new URL(safePath, origin);
  if (url.origin !== origin) throw new HttpError(400, "callback_redirect_invalid");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
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
      throw new HttpError(400, "google_business_oauth_state_missing");
    }
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "google_business_server_consume_oauth_state",
      { _state_hash: await sha256Hex(rawState) },
    );
    if (error || !data?.[0]) {
      throw new HttpError(400, "google_business_oauth_state_invalid_or_expired");
    }
    state = data[0] as OAuthState;

    if (query.get("error")) {
      return redirectTarget(returnOrigin, state.redirect_path, {
        google_business_status: "error",
        reason_code: "google_business_oauth_denied_by_user",
      });
    }
    const code = query.get("code");
    if (!code) throw new HttpError(400, "google_business_authorization_code_missing");

    const token = await exchangeGoogleBusinessCode(code);
    const identity = await getGoogleBusinessIdentity(token.accessToken);
    const { error: saveError } = await admin.rpc(
      "google_business_server_upsert_connection",
      {
        _oauth_state_id: state.oauth_state_id,
        _google_account_id: identity.sub,
        _google_account_email: identity.email,
        _access_token: token.accessToken,
        _refresh_token: token.refreshToken ?? "",
        _token_expires_at: token.expiresAt,
        _granted_scopes: token.scopes,
      },
    );
    if (saveError) {
      const reason = saveError.message.includes("refresh_token_missing")
        ? "google_business_refresh_token_missing"
        : "google_business_connection_save_failed";
      throw new HttpError(500, reason);
    }

    return redirectTarget(returnOrigin, state.redirect_path, {
      google_business_status: "connected",
    });
  } catch (error) {
    const reason = error instanceof HttpError
      ? error.reasonCode
      : error instanceof GoogleBusinessApiError
      ? error.reasonCode
      : "google_business_oauth_callback_failed";
    return redirectTarget(returnOrigin, state?.redirect_path ?? "/", {
      google_business_status: "error",
      reason_code: reason,
    });
  }
});
