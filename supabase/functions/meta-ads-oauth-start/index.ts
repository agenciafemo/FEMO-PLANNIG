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

// Inicia a conexão do Meta Ads.
//   sem client_id -> conexão DA AGÊNCIA (vale para todos os clientes)
//   com client_id -> conexão com o PERFIL DO CLIENTE (só para aquele cliente)
type Body = {
  organization_id?: string;
  client_id?: string;
  redirect_path?: string;
};

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
    const clientId = body.client_id
      ? assertUuid(body.client_id, "client_id_invalid")
      : null;
    const redirectPath = body.redirect_path?.trim() || "/relatorios";
    if (!redirectPath.startsWith("/") || redirectPath.startsWith("//")) {
      throw new HttpError(400, "redirect_path_invalid");
    }

    const admin = createAdminClient();
    await requireMetaAdsMember(admin, organizationId, actor.userId, true);

    if (clientId) {
      const { data: client, error: clientError } = await admin
        .from("clients")
        .select("id")
        .eq("id", clientId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (clientError) throw new HttpError(500, "client_lookup_failed");
      if (!client) throw new HttpError(404, "client_not_found");
    }

    const config = metaAdsStartConfig();
    const state = generateOAuthState();
    const common = {
      _organization_id: organizationId,
      _requested_by: actor.userId,
      _state_hash: await sha256Hex(state),
      _requested_scopes: config.scopes,
      _redirect_path: redirectPath,
      _expires_at: new Date(Date.now() + config.stateTtlSeconds * 1000)
        .toISOString(),
    };
    const { error } = clientId
      ? await admin.rpc("meta_ads_server_create_client_oauth_state", {
        ...common,
        _client_id: clientId,
      })
      : await admin.rpc("meta_ads_server_create_oauth_state", common);
    if (error) throw new HttpError(500, "meta_ads_oauth_state_create_failed");

    // O state cru só viaja na URL; o banco guarda o hash.
    return jsonResponse(
      {
        authorize_url: buildMetaAdsAuthorizeUrl(
          state,
          config,
          clientId !== null,
        ),
      },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
});
