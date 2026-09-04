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
  activeGoogleBusinessCredentials,
  GoogleBusinessApiError,
  listGoogleBusinessLocations,
  type GoogleBusinessLocation,
} from "../_shared/google-business.ts";
import {
  requireGoogleBusinessActor,
  requireGoogleBusinessMembership,
} from "../_shared/google-business-auth.ts";
import { createAdminClient } from "../_shared/supabase.ts";

type Body = {
  organization_id?: string;
  client_id?: string;
  action?: "list" | "select";
  location?: GoogleBusinessLocation;
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

    const actor = await requireGoogleBusinessActor(request);
    const body = await readJson<Body>(request);
    const organizationId = body.organization_id?.trim() ?? "";
    const clientId = body.client_id?.trim() ?? "";
    if (!UUID.test(organizationId) || !UUID.test(clientId)) {
      throw new HttpError(400, "google_business_context_invalid");
    }

    const admin = createAdminClient();
    await requireGoogleBusinessMembership(
      admin,
      organizationId,
      actor.userId,
      true,
    );
    const { data: client, error: clientError } = await admin
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (clientError || !client) {
      throw new HttpError(404, "google_business_client_not_found");
    }

    const credentials = await activeGoogleBusinessCredentials(
      admin,
      organizationId,
    );
    let locations: GoogleBusinessLocation[];
    try {
      locations = await listGoogleBusinessLocations(credentials.access_token);
    } catch (error) {
      if (error instanceof GoogleBusinessApiError) {
        await admin.rpc("google_business_server_mark_result", {
          _connection_id: credentials.connection_id,
          _status: error.status === 401 ? "reauth_required" : "error",
          _reason_code: error.reasonCode,
        });
      }
      throw error;
    }

    if ((body.action ?? "list") === "select") {
      const requestedLocation = body.location;
      if (
        !requestedLocation ||
        !/^locations\/[0-9]+$/.test(requestedLocation.name)
      ) {
        throw new HttpError(400, "google_business_location_invalid");
      }
      const location = locations.find(
        (candidate) => candidate.name === requestedLocation.name,
      );
      if (!location) {
        throw new HttpError(404, "google_business_location_not_found");
      }
      const { error } = await admin.rpc(
        "google_business_server_select_location",
        {
          _organization_id: organizationId,
          _client_id: clientId,
          _actor_user_id: actor.userId,
          _google_location_name: location.name,
          _location_title: location.title,
          _store_code: location.storeCode,
          _place_id: location.placeId,
          _storefront_address: location.storefrontAddress,
        },
      );
      if (error) {
        const reason = error.message.includes("google_business_client_location_google_unique")
          ? "google_business_location_already_linked"
          : "google_business_location_save_failed";
        throw new HttpError(409, reason);
      }
      return jsonResponse({ ok: true }, 200, headers);
    }
    await admin.rpc("google_business_server_mark_result", {
      _connection_id: credentials.connection_id,
      _status: "active",
      _reason_code: null,
    });
    return jsonResponse({ ok: true, locations }, 200, headers);
  } catch (error) {
    if (error instanceof GoogleBusinessApiError) {
      return errorResponse(
        new HttpError(error.status, error.reasonCode, error.status),
        headers,
      );
    }
    return errorResponse(error, headers);
  }
});
