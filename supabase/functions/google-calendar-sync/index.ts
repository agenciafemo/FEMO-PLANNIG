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
  sanitizeReasonCode,
} from "../_shared/http.ts";
import {
  GoogleCalendarApiError,
  googleCalendarRequest,
  googleEventId,
  type NorteiaCalendarEvent,
  refreshGoogleAccessToken,
  toGoogleEventResource,
} from "../_shared/google-calendar.ts";
import {
  requireGoogleCalendarActor,
  requireGoogleCalendarMembership,
} from "../_shared/google-calendar-auth.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

type SyncOperation = "upsert" | "delete" | "reconcile";

type SyncBody = {
  organization_id?: string;
  event_id?: string;
  operation?: SyncOperation;
};

type Credentials = {
  connection_id: string;
  calendar_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
};

type EventLink = {
  id: string;
  organization_id: string;
  connection_id: string;
  calendar_event_id: string;
  google_calendar_id: string;
  google_event_id: string;
  sync_status: string;
};

type GoogleEventResult = { id: string; etag?: string };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function markConnection(
  admin: SupabaseClient,
  connectionId: string,
  status: "active" | "reauth_required" | "error",
  reasonCode: string | null,
  synced: boolean,
): Promise<void> {
  await admin.rpc("google_calendar_server_mark_result", {
    _connection_id: connectionId,
    _status: status,
    _reason_code: reasonCode,
    _synced: synced,
  });
}

async function activeCredentials(
  admin: SupabaseClient,
  organizationId: string,
): Promise<Credentials> {
  const { data, error } = await admin.rpc(
    "google_calendar_server_get_credentials",
    {
      _organization_id: organizationId,
    },
  );
  const current = data?.[0] as Credentials | undefined;
  if (error || !current) {
    throw new HttpError(409, "google_calendar_not_connected");
  }

  const expiresAt = current.token_expires_at
    ? new Date(current.token_expires_at).getTime()
    : 0;
  if (expiresAt > Date.now() + 2 * 60 * 1000) return current;

  try {
    const refreshed = await refreshGoogleAccessToken(current.refresh_token);
    const { error: updateError } = await admin.rpc(
      "google_calendar_server_refresh_access_token",
      {
        _connection_id: current.connection_id,
        _access_token: refreshed.accessToken,
        _token_expires_at: refreshed.expiresAt,
      },
    );
    if (updateError) throw new HttpError(500, "google_token_persist_failed");
    return {
      ...current,
      access_token: refreshed.accessToken,
      token_expires_at: refreshed.expiresAt,
    };
  } catch (error) {
    const reason = error instanceof GoogleCalendarApiError
      ? error.reasonCode
      : error instanceof HttpError
      ? error.reasonCode
      : "google_token_refresh_failed";
    await markConnection(
      admin,
      current.connection_id,
      "reauth_required",
      reason,
      false,
    );
    throw new HttpError(401, reason);
  }
}

async function getLink(
  admin: SupabaseClient,
  organizationId: string,
  eventId: string,
): Promise<EventLink | null> {
  const { data, error } = await admin
    .from("google_calendar_event_links")
    .select(
      "id, organization_id, connection_id, calendar_event_id, google_calendar_id, google_event_id, sync_status",
    )
    .eq("organization_id", organizationId)
    .eq("calendar_event_id", eventId)
    .maybeSingle();
  if (error) throw new HttpError(500, "google_event_link_lookup_failed");
  return data as EventLink | null;
}

async function loadEvent(
  admin: SupabaseClient,
  organizationId: string,
  eventId: string,
): Promise<NorteiaCalendarEvent | null> {
  const { data, error } = await admin
    .from("calendar_events")
    .select(
      "id, organization_id, client_id, title, event_date, event_type, note, all_day, start_time, end_time",
    )
    .eq("organization_id", organizationId)
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new HttpError(500, "calendar_event_lookup_failed");
  return data as NorteiaCalendarEvent | null;
}

function shouldSync(event: NorteiaCalendarEvent): boolean {
  return event.event_type === "personalizado" ||
    event.event_type === "campanha" ||
    event.event_type === "campaign" ||
    event.event_type === "other";
}

async function clientName(
  admin: SupabaseClient,
  organizationId: string,
  clientId: string | null,
): Promise<string> {
  if (!clientId) return "";
  const { data, error } = await admin
    .from("clients")
    .select("name")
    .eq("organization_id", organizationId)
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new HttpError(500, "calendar_client_lookup_failed");
  return typeof data?.name === "string" ? data.name : "";
}

async function saveLinkError(
  admin: SupabaseClient,
  link: EventLink | null,
  reasonCode: string,
): Promise<void> {
  if (!link) return;
  await admin.from("google_calendar_event_links").update({
    sync_status: "error",
    last_error_code: sanitizeReasonCode(reasonCode),
  }).eq("id", link.id);
}

async function upsertOne(
  admin: SupabaseClient,
  credentials: Credentials,
  organizationId: string,
  eventId: string,
): Promise<"synced" | "skipped" | "missing"> {
  const event = await loadEvent(admin, organizationId, eventId);
  if (!event) return "missing";
  if (!shouldSync(event)) return "skipped";
  const link = await getLink(admin, organizationId, eventId);
  const name = await clientName(admin, organizationId, event.client_id);

  try {
    let googleEvent: GoogleEventResult | null;
    if (link) {
      googleEvent = await googleCalendarRequest<GoogleEventResult>({
        accessToken: credentials.access_token,
        calendarId: credentials.calendar_id,
        eventId: link.google_event_id,
        method: "PUT",
        body: toGoogleEventResource(event, name, false),
      });
    } else {
      const deterministicId = googleEventId(event.id);
      try {
        googleEvent = await googleCalendarRequest<GoogleEventResult>({
          accessToken: credentials.access_token,
          calendarId: credentials.calendar_id,
          method: "POST",
          body: toGoogleEventResource(event, name, true),
        });
      } catch (error) {
        if (
          !(error instanceof GoogleCalendarApiError) || error.status !== 409
        ) throw error;
        googleEvent = await googleCalendarRequest<GoogleEventResult>({
          accessToken: credentials.access_token,
          calendarId: credentials.calendar_id,
          eventId: deterministicId,
          method: "PUT",
          body: toGoogleEventResource(event, name, false),
        });
      }
    }
    if (!googleEvent?.id) {
      throw new GoogleCalendarApiError(502, "google_event_response_invalid");
    }

    const { error: linkError } = await admin.from("google_calendar_event_links")
      .upsert({
        organization_id: organizationId,
        connection_id: credentials.connection_id,
        calendar_event_id: event.id,
        google_calendar_id: credentials.calendar_id,
        google_event_id: googleEvent.id,
        google_etag: googleEvent.etag ?? null,
        sync_status: "synced",
        last_synced_at: new Date().toISOString(),
        last_error_code: null,
      }, { onConflict: "organization_id,calendar_event_id" });
    if (linkError) throw new HttpError(500, "google_event_link_save_failed");
    return "synced";
  } catch (error) {
    const reason = error instanceof GoogleCalendarApiError
      ? error.reasonCode
      : error instanceof HttpError
      ? error.reasonCode
      : "google_event_sync_failed";
    await saveLinkError(admin, link, reason);
    if (error instanceof GoogleCalendarApiError && error.status === 401) {
      await markConnection(
        admin,
        credentials.connection_id,
        "reauth_required",
        reason,
        false,
      );
    }
    throw error;
  }
}

async function deleteOne(
  admin: SupabaseClient,
  credentials: Credentials,
  organizationId: string,
  eventId: string,
): Promise<"deleted" | "not_linked"> {
  const link = await getLink(admin, organizationId, eventId);
  if (!link) return "not_linked";
  try {
    await googleCalendarRequest<never>({
      accessToken: credentials.access_token,
      calendarId: link.google_calendar_id,
      eventId: link.google_event_id,
      method: "DELETE",
    });
  } catch (error) {
    if (
      !(error instanceof GoogleCalendarApiError) ||
      ![404, 410].includes(error.status)
    ) {
      const reason = error instanceof GoogleCalendarApiError
        ? error.reasonCode
        : "google_event_delete_failed";
      await saveLinkError(admin, link, reason);
      if (error instanceof GoogleCalendarApiError && error.status === 401) {
        await markConnection(
          admin,
          credentials.connection_id,
          "reauth_required",
          reason,
          false,
        );
      }
      throw error;
    }
  }
  const { error } = await admin.from("google_calendar_event_links").update({
    sync_status: "deleted",
    last_synced_at: new Date().toISOString(),
    last_error_code: null,
  }).eq("id", link.id);
  if (error) throw new HttpError(500, "google_event_link_delete_mark_failed");
  return "deleted";
}

async function reconcileAll(
  admin: SupabaseClient,
  credentials: Credentials,
  organizationId: string,
): Promise<
  { synced: number; deleted: number; skipped: number; failed: number }
> {
  const { data: events, error: eventsError } = await admin
    .from("calendar_events")
    .select("id")
    .eq("organization_id", organizationId);
  if (eventsError) throw new HttpError(500, "calendar_events_list_failed");

  const currentIds = new Set(
    (events ?? []).map((event: { id: string }) => event.id),
  );
  let synced = 0;
  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  for (const event of events ?? []) {
    try {
      const result = await upsertOne(
        admin,
        credentials,
        organizationId,
        event.id,
      );
      if (result === "synced") synced++;
      else skipped++;
    } catch (error) {
      if (error instanceof GoogleCalendarApiError && error.status === 401) {
        throw error;
      }
      failed++;
    }
  }

  const { data: links, error: linksError } = await admin
    .from("google_calendar_event_links")
    .select("calendar_event_id, sync_status")
    .eq("organization_id", organizationId)
    .neq("sync_status", "deleted");
  if (linksError) throw new HttpError(500, "google_event_links_list_failed");

  for (const link of links ?? []) {
    if (currentIds.has(link.calendar_event_id)) continue;
    try {
      const result = await deleteOne(
        admin,
        credentials,
        organizationId,
        link.calendar_event_id,
      );
      if (result === "deleted") deleted++;
    } catch (error) {
      if (error instanceof GoogleCalendarApiError && error.status === 401) {
        throw error;
      }
      failed++;
    }
  }
  return { synced, deleted, skipped, failed };
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

    const actor = await requireGoogleCalendarActor(request);
    const body = await readJson<SyncBody>(request);
    const organizationId = body.organization_id?.trim() ?? "";
    const operation = body.operation ?? "upsert";
    if (!UUID.test(organizationId)) {
      throw new HttpError(400, "organization_id_invalid");
    }
    if (!(["upsert", "delete", "reconcile"] as string[]).includes(operation)) {
      throw new HttpError(400, "google_sync_operation_invalid");
    }
    if (operation !== "reconcile" && !UUID.test(body.event_id ?? "")) {
      throw new HttpError(400, "calendar_event_id_invalid");
    }

    const admin = createAdminClient();
    await requireGoogleCalendarMembership(
      admin,
      organizationId,
      actor.userId,
      operation === "reconcile" ? "manager" : "editor",
    );
    const credentials = await activeCredentials(admin, organizationId);

    const result = operation === "reconcile"
      ? await reconcileAll(admin, credentials, organizationId)
      : operation === "delete"
      ? await deleteOne(admin, credentials, organizationId, body.event_id!)
      : await upsertOne(admin, credentials, organizationId, body.event_id!);

    const failed = typeof result === "object" && "failed" in result
      ? result.failed
      : 0;
    await markConnection(
      admin,
      credentials.connection_id,
      "active",
      failed > 0 ? "google_partial_sync_failed" : null,
      true,
    );
    return jsonResponse({ ok: true, result }, 200, headers);
  } catch (error) {
    if (error instanceof GoogleCalendarApiError) {
      return errorResponse(
        new HttpError(
          error.status === 401 ? 401 : 502,
          error.reasonCode,
          error.status,
        ),
        headers,
      );
    }
    return errorResponse(error, headers);
  }
});
