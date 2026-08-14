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
  safeLog,
  safeRequestId,
} from "../_shared/http.ts";
import {
  requireAuthenticatedActor,
  requireConnectionManager,
} from "../_shared/meta-auth.ts";
import { getPageAccessToken } from "../_shared/meta-client.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import {
  getConnectionToken,
  replaceConnectionToken,
} from "../_shared/meta-vault.ts";

// Backfill de estabilidade (Etapa D): converte as conexões que ainda usam o
// token de USUÁRIO (expira em ~60 dias) para o token de PÁGINA (permanente),
// sem exigir reconexão manual de cada cliente. Usa o token de usuário — ainda
// válido — para buscar o token de Página e trocá-lo.
//
// dry_run=true apenas LISTA o que seria convertido, sem alterar nada.
// Autorização: cada conexão só é processada se o ator autenticado a gerencia.

interface BackfillBody {
  dry_run?: boolean;
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  const requestId = safeRequestId(request);
  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    assertAllowedOrigin(request);
    if (request.method !== "POST") {
      return methodNotAllowed(headers, ["POST", "OPTIONS"]);
    }

    const actor = await requireAuthenticatedActor(request);
    const body = await readJson<BackfillBody>(request);
    const dryRun = body.dry_run === true;
    const admin = createAdminClient();

    // Conexões ativas ainda no token de usuário (token_expires_at não nulo).
    const { data: connections, error: connError } = await admin
      .from("meta_connections")
      .select("id")
      .eq("status", "active")
      .not("token_expires_at", "is", null);
    if (connError) throw new HttpError(500, "connections_lookup_failed");

    const rows = (connections ?? []) as Array<{ id: string }>;
    const converted: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const row of rows) {
      const connectionId = row.id;
      try {
        // Autorização por conexão (o ator precisa gerenciá-la).
        await requireConnectionManager(admin, connectionId, actor.userId, [
          "active",
        ]);

        // Página do Facebook desta conexão (fonte do token permanente).
        const { data: channel, error: channelError } = await admin
          .from("meta_connection_channels")
          .select("external_account_id")
          .eq("connection_id", connectionId)
          .eq("channel_type", "facebook_page")
          .limit(1)
          .maybeSingle();
        if (channelError) throw new HttpError(500, "channel_lookup_failed");
        const pageId =
          (channel as { external_account_id?: string } | null)
            ?.external_account_id;
        if (!pageId) {
          skipped.push({ id: connectionId, reason: "no_facebook_page_channel" });
          continue;
        }

        // Token de usuário (ainda válido) -> token de Página (permanente).
        const userToken = await getConnectionToken(admin, connectionId);
        const pageToken = await getPageAccessToken(pageId, userToken);

        if (dryRun) {
          converted.push(connectionId); // "seria convertida"
          continue;
        }

        await replaceConnectionToken(admin, {
          connectionId,
          actorUserId: actor.userId,
          accessToken: pageToken,
          tokenExpiresAt: null,
          requestId,
        });
        converted.push(connectionId);
      } catch (error) {
        failed.push({
          id: connectionId,
          reason: error instanceof HttpError
            ? error.reasonCode
            : "backfill_failed",
        });
      }
    }

    safeLog("meta_token_backfill", {
      function_name: "meta-token-backfill",
      request_id: requestId,
      reason_code: dryRun ? "dry_run" : "applied",
    });

    return jsonResponse(
      {
        mode: dryRun ? "dry_run" : "applied",
        total: rows.length,
        converted,
        skipped,
        failed,
      },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
});
