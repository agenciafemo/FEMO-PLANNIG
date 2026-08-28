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
  requireGoogleCalendarActor,
  requireGoogleCalendarMembership,
} from "../_shared/google-calendar-auth.ts";
import { createAdminClient } from "../_shared/supabase.ts";

type DisconnectBody = { organization_id?: string };
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    assertAllowedOrigin(request);
    if (request.method !== "POST") {
      return methodNotAllowed(headers, ["POST", "OPTIONS"]);
    }
    const actor = await requireGoogleCalendarActor(request);
    const body = await readJson<DisconnectBody>(request);
    const organizationId = body.organization_id?.trim() ?? "";
    if (!UUID.test(organizationId)) {
      throw new HttpError(400, "organization_id_invalid");
    }

    const admin = createAdminClient();
    await requireGoogleCalendarMembership(
      admin,
      organizationId,
      actor.userId,
      "manager",
    );
    const { error } = await admin.rpc("google_calendar_server_disconnect", {
      _organization_id: organizationId,
      _actor_user_id: actor.userId,
    });
    if (error) throw new HttpError(500, "google_calendar_disconnect_failed");
    return jsonResponse({ ok: true }, 200, headers);
  } catch (error) {
    return errorResponse(error, headers);
  }
});
