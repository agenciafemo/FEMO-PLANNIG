import {
  assertAllowedOrigin,
  corsHeaders,
  handlePreflight,
} from "../_shared/cors.ts";
import {
  errorResponse,
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
} from "../_shared/http.ts";
import {
  generateOAuthState,
  requireAuthenticatedActor,
  sha256Hex,
} from "../_shared/meta-auth.ts";
import {
  assertUuid,
  buildMetaAdsAuthorizeUrl,
  metaAdsStartConfig,
  requireMetaAdsMember,
} from "../_shared/meta-ads.ts";
import { createAdminClient } from "../_shared/supabase.ts";

// Inicia a conexão do Meta Ads DA AGÊNCIA (não de um cliente).
type Body = { organization_id?: string; redirect_path?: string };

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    assertAllowedOrigin(request);
    if (request.method !== "POST") {
      return methodNotAllowed(headers, ["POST", "OPTIONS"]);
    }

    const actor = await requireAuthenticatedActor(request);
    const body = await readJson<Body>(request);
    const organizationId = assertUuid(
      body.organization_id,
      "organization_id_invalid",
    );
    const redirectPath = body.redirect_path?.trim() || "/relatorios";
    if (!redirectPath.startsWith("/") || redirectPath.startsWith("//")) {
      throw new HttpError(400, "redirect_path_invalid");
    }

    const admin = createAdminClient();
    await requireMetaAdsMember(admin, organizationId, actor.userId, true);

    const config = metaAdsStartConfig();
    const state = generateOAuthState();
    const { error } = await admin.rpc("meta_ads_server_create_oauth_state", {
      _organization_id: organizationId,
      _requested_by: actor.userId,
      _state_hash: await sha256Hex(state),
      _requested_scopes: config.scopes,
      _redirect_path: redirectPath,
      _expires_at: new Date(Date.now() + config.stateTtlSeconds * 1000)
        .toISOString(),
    });
    if (error) throw new HttpError(500, "meta_ads_oauth_state_create_failed");

    // O state cru só viaja na URL; o banco guarda o hash.
    return jsonResponse(
      { authorize_url: buildMetaAdsAuthorizeUrl(state, config) },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
});
