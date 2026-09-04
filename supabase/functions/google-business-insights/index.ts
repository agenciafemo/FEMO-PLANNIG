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
  fetchGoogleBusinessInsights,
  GoogleBusinessApiError,
  normalizeGoogleBusinessInsights,
} from "../_shared/google-business.ts";
import {
  requireGoogleBusinessActor,
  requireGoogleBusinessMembership,
} from "../_shared/google-business-auth.ts";
import { createAdminClient } from "../_shared/supabase.ts";

type Body = {
  organization_id?: string;
  client_id?: string;
  start_date?: string;
  end_date?: string;
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
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

    const actor = await requireGoogleBusinessActor(request);
    const body = await readJson<Body>(request);
    const organizationId = body.organization_id?.trim() ?? "";
    const clientId = body.client_id?.trim() ?? "";
    const startDate = body.start_date?.trim() ?? "";
    const endDate = body.end_date?.trim() ?? "";
    if (
      !UUID.test(organizationId) || !UUID.test(clientId) ||
      !validDate(startDate) || !validDate(endDate) ||
      startDate > endDate
    ) {
      throw new HttpError(400, "google_business_insights_input_invalid");
    }

    const admin = createAdminClient();
    await requireGoogleBusinessMembership(
      admin,
      organizationId,
      actor.userId,
    );
    const { data: location, error: locationError } = await admin
      .from("google_business_client_locations")
      .select("google_location_name, location_title, store_code, place_id")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .maybeSingle();
    if (locationError) {
      throw new HttpError(500, "google_business_location_lookup_failed");
    }
    if (!location) throw new HttpError(409, "google_business_location_not_selected");

    const credentials = await activeGoogleBusinessCredentials(
      admin,
      organizationId,
    );
    let insights: Record<string, unknown>;
    try {
      insights = await fetchGoogleBusinessInsights({
        accessToken: credentials.access_token,
        locationName: location.google_location_name,
        startDate,
        endDate,
      });
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
    await admin.rpc("google_business_server_mark_result", {
      _connection_id: credentials.connection_id,
      _status: "active",
      _reason_code: null,
    });
    return jsonResponse(
      {
        ok: true,
        period: { from: startDate, to: endDate },
        location,
        insights: normalizeGoogleBusinessInsights(insights),
      },
      200,
      headers,
    );
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
