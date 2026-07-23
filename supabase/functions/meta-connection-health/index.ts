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
  sanitizeReasonCode,
} from "../_shared/http.ts";
import {
  requireAuthenticatedActor,
  requireConnectionManager,
} from "../_shared/meta-auth.ts";
import { checkConnection } from "../_shared/meta-client.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { getConnectionToken, recordAudit } from "../_shared/meta-vault.ts";

interface HealthBody {
  connection_id?: string;
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  const requestId = safeRequestId(request);
  let auditContext:
    | { clientId: string; connectionId: string; actorId: string }
    | null = null;
  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    assertAllowedOrigin(request);
    if (request.method !== "POST") {
      return methodNotAllowed(headers, ["POST", "OPTIONS"]);
    }
    const actor = await requireAuthenticatedActor(request);
    const body = await readJson<HealthBody>(request);
    if (!body.connection_id) throw new HttpError(400, "connection_id_invalid");
    const admin = createAdminClient();
    const connection = await requireConnectionManager(
      admin,
      body.connection_id,
      actor.userId,
      ["active", "reauth_required", "error"],
    );
    auditContext = {
      clientId: connection.client_id,
      connectionId: connection.id,
      actorId: actor.userId,
    };
    await checkConnection(await getConnectionToken(admin, connection.id));
    await recordAudit(admin, {
      clientId: connection.client_id,
      connectionId: connection.id,
      actorUserId: actor.userId,
      action: "health_checked",
      result: "success",
      reasonCode: "connection_healthy",
      requestId,
    });
    return jsonResponse(
      { status: "healthy", checked_at: new Date().toISOString() },
      200,
      headers,
    );
  } catch (error) {
    if (auditContext) {
      try {
        await recordAudit(createAdminClient(), {
          clientId: auditContext.clientId,
          connectionId: auditContext.connectionId,
          actorUserId: auditContext.actorId,
          action: "health_checked",
          result: "failure",
          reasonCode: sanitizeReasonCode(
            error instanceof HttpError ? error.reasonCode : "health_failed",
          ),
          requestId,
        });
      } catch { /* Keep the original sanitized response. */ }
    }
    return errorResponse(error, headers);
  }
});
