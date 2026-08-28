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
import { generateOAuthState, sha256Hex } from "../_shared/meta-auth.ts";
import {
  buildGoogleAuthorizeUrl,
  GOOGLE_CALENDAR_SCOPES,
} from "../_shared/google-calendar.ts";
import {
  requireGoogleCalendarActor,
  requireGoogleCalendarMembership,
} from "../_shared/google-calendar-auth.ts";
import { createAdminClient } from "../_shared/supabase.ts";

type StartBody = {
  organization_id?: string;
  redirect_path?: string;
};

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
    const body = await readJson<StartBody>(request);
    const organizationId = body.organization_id?.trim() ?? "";
    if (!UUID.test(organizationId)) {
      throw new HttpError(400, "organization_id_invalid");
    }
    const redirectPath = body.redirect_path ?? "/calendario";
    if (!redirectPath.startsWith("/") || redirectPath.startsWith("//")) {
      throw new HttpError(400, "redirect_path_invalid");
    }

    const admin = createAdminClient();
    await requireGoogleCalendarMembership(
      admin,
      organizationId,
      actor.userId,
      "manager",
    );

    const state = generateOAuthState();
    const { error } = await admin.rpc(
      "google_calendar_server_create_oauth_state",
      {
        _organization_id: organizationId,
        _requested_by: actor.userId,
        _state_hash: await sha256Hex(state),
        _requested_scopes: GOOGLE_CALENDAR_SCOPES,
        _redirect_path: redirectPath,
        _expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
    );
    if (error) throw new HttpError(500, "google_oauth_state_create_failed");

    return jsonResponse(
      { authorize_url: buildGoogleAuthorizeUrl(state) },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
});
