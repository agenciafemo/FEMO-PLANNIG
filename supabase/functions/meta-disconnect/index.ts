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
  requireAuthenticatedActor,
  requireConnectionManager,
} from "../_shared/meta-auth.ts";
import { revokeMetaPermissions } from "../_shared/meta-client.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import {
  disconnectConnection,
  getConnectionToken,
} from "../_shared/meta-vault.ts";

interface DisconnectBody {
  connection_id?: string;
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
    const body = await readJson<DisconnectBody>(request);
    if (!body.connection_id) throw new HttpError(400, "connection_id_invalid");
    const admin = createAdminClient();
    const connection = await requireConnectionManager(
      admin,
      body.connection_id,
      actor.userId,
      ["pending", "active", "reauth_required", "error"],
    );

    let remoteRevoked = false;
    try {
      remoteRevoked = await revokeMetaPermissions(
        await getConnectionToken(admin, connection.id),
      );
    } catch {
      remoteRevoked = false;
    }
    await disconnectConnection(admin, {
      connectionId: connection.id,
      actorUserId: actor.userId,
      reasonCode: remoteRevoked ? "user_requested" : "remote_revoke_failed",
      requestId: safeRequestId(request),
    });
    return jsonResponse(
      { status: "disconnected", remote_revoked: remoteRevoked },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
});
