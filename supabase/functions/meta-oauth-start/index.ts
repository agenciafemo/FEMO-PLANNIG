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
  safeRequestId,
} from "../_shared/http.ts";
import {
  generateOAuthState,
  requireAuthenticatedActor,
  requireClientManager,
  sha256Hex,
} from "../_shared/meta-auth.ts";
import {
  buildAuthorizeUrl,
  buildInstagramAuthorizeUrl,
  instagramOAuthConfig,
  metaOAuthStartConfig,
} from "../_shared/meta-client.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { createOAuthState } from "../_shared/meta-vault.ts";

interface StartBody {
  client_id?: string;
  redirect_path?: string;
  /** Obriga o Facebook a pedir a conta de novo, em vez de reaproveitar a
   *  sessão aberta. É como se conecta um cliente com a conta dele numa máquina
   *  já logada na conta da agência. */
  force_account?: boolean;
  /** Porta da autorização. Ausente = facebook, que é o comportamento antigo. */
  provider?: "facebook" | "instagram";
}

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
    const body = await readJson<StartBody>(request);
    if (!body.client_id || !/^[0-9a-f-]{36}$/i.test(body.client_id)) {
      throw new HttpError(400, "client_id_invalid");
    }
    const redirectPath = body.redirect_path ?? `/clients/${body.client_id}`;
    if (!redirectPath.startsWith("/") || redirectPath.startsWith("//")) {
      throw new HttpError(400, "redirect_path_invalid");
    }

    const admin = createAdminClient();
    await requireClientManager(admin, body.client_id, actor.userId);
    // A porta do Instagram tem credenciais e escopos próprios — por isso a
    // configuração é escolhida antes de gerar o state.
    const provider = body.provider === "instagram" ? "instagram" : "facebook";
    const igConfig = provider === "instagram" ? instagramOAuthConfig() : null;
    const config = metaOAuthStartConfig();
    const rawState = generateOAuthState();
    const stateHash = await sha256Hex(rawState);
    const requestId = safeRequestId(request);

    await createOAuthState(admin, {
      clientId: body.client_id,
      requestedBy: actor.userId,
      stateHash,
      scopes: igConfig ? igConfig.scopes : config.scopes,
      redirectPath,
      expiresAt: new Date(Date.now() + config.stateTtlSeconds * 1000)
        .toISOString(),
      requestId,
      // Sem isto o state grava 'facebook' mesmo tendo mandado o usuario para a
      // porta do Instagram, e o callback (que decide a troca de token por este
      // campo) tenta trocar o codigo contra o graph.facebook.com — falhando
      // depois de o cliente ja ter autorizado.
      provider,
    });

    // The opaque state travels only inside the OAuth URL; persistence uses its SHA-256 hash above.
    return jsonResponse(
      {
        authorize_url: igConfig
          ? buildInstagramAuthorizeUrl(rawState, igConfig)
          : buildAuthorizeUrl(rawState, config, body.force_account === true),
      },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
});
