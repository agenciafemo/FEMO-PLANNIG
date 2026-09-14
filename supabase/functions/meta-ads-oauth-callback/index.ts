import { sha256Hex } from "../_shared/meta-auth.ts";
import {
  exchangeCodeForToken,
  getGrantedPermissions,
  getMetaUser,
} from "../_shared/meta-client.ts";
import { HttpError, methodNotAllowed } from "../_shared/http.ts";
import {
  META_ADS_REQUIRED_SCOPE,
  metaAdsConfig,
  tokenExpiresAt,
} from "../_shared/meta-ads.ts";
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
  if (url.origin !== origin) {
    throw new HttpError(400, "callback_redirect_invalid");
  }
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return Response.redirect(url, 303);
}

Deno.serve(async (request) => {
  if (request.method !== "GET") return methodNotAllowed({}, ["GET"]);
  const returnOrigin = new URL(requiredEnv("META_APP_RETURN_ORIGIN")).origin;
  const query = new URL(request.url).searchParams;
  const rawState = query.get("state") ?? "";
  let state: OAuthState | null = null;

  try {
    if (rawState.length < 32 || rawState.length > 256) {
      throw new HttpError(400, "meta_ads_oauth_state_missing");
    }
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "meta_ads_server_consume_oauth_state",
      { _state_hash: await sha256Hex(rawState) },
    );
    if (error || !data?.[0]) {
      throw new HttpError(400, "meta_ads_oauth_state_invalid_or_expired");
    }
    state = data[0] as OAuthState;

    if (query.get("error")) {
      return redirectTarget(returnOrigin, state.redirect_path, {
        meta_ads_status: "error",
        reason_code: "meta_ads_oauth_denied_by_user",
      });
    }
    const code = query.get("code");
    if (!code) throw new HttpError(400, "meta_ads_authorization_code_missing");

    const config = metaAdsConfig();
    // Troca direto pelo token de longa duração (60 dias).
    const token = await exchangeCodeForToken(code, config);

    // Na tela de consentimento dá para desmarcar permissões. Sem `ads_read` a
    // conexão seria salva e só falharia no primeiro relatório — melhor recusar
    // aqui, com o motivo certo.
    const permissions = await getGrantedPermissions(token.access_token, config);
    if (permissions[META_ADS_REQUIRED_SCOPE] !== "granted") {
      throw new HttpError(400, "meta_ads_permission_declined");
    }
    const grantedScopes = Object.entries(permissions)
      .filter(([, status]) => status === "granted")
      .map(([permission]) => permission);

    const user = await getMetaUser(token.access_token, config);
    const { error: saveError } = await admin.rpc(
      "meta_ads_server_upsert_connection",
      {
        _oauth_state_id: state.oauth_state_id,
        _meta_user_id: user.id,
        _meta_user_name: user.name,
        _access_token: token.access_token,
        _token_expires_at: tokenExpiresAt(token.expires_in),
        _granted_scopes: grantedScopes,
      },
    );
    if (saveError) throw new HttpError(500, "meta_ads_connection_save_failed");

    return redirectTarget(returnOrigin, state.redirect_path, {
      meta_ads_status: "connected",
    });
  } catch (error) {
    const reason = error instanceof HttpError
      ? error.reasonCode
      : "meta_ads_oauth_callback_failed";
    return redirectTarget(returnOrigin, state?.redirect_path ?? "/", {
      meta_ads_status: "error",
      reason_code: reason,
    });
  }
});
