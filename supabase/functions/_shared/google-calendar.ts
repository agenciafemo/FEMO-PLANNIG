import { HttpError, sanitizeReasonCode } from "./http.ts";
import { requiredEnv } from "./supabase.ts";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
];

export type GoogleCalendarConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleTokenResult = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scopes: string[];
};

export type GoogleUserInfo = {
  sub: string;
  email: string;
};

export type NorteiaCalendarEvent = {
  id: string;
  organization_id: string;
  client_id: string | null;
  title: string;
  event_date: string | null;
  event_type: string | null;
  note: string | null;
  all_day: boolean | null;
  start_time: string | null;
  end_time: string | null;
};

export type GoogleEventResource = {
  id?: string;
  summary: string;
  description: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
  extendedProperties: {
    private: Record<string, string>;
  };
};

export class GoogleCalendarApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly reasonCode: string,
  ) {
    super(reasonCode);
  }
}

export function googleCalendarConfig(): GoogleCalendarConfig {
  return {
    clientId: requiredEnv("GOOGLE_CALENDAR_CLIENT_ID"),
    clientSecret: requiredEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
    redirectUri: requiredEnv("GOOGLE_CALENDAR_REDIRECT_URI"),
  };
}

export function buildGoogleAuthorizeUrl(
  state: string,
  config = googleCalendarConfig(),
): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

function parseScopes(value: unknown): string[] {
  return typeof value === "string"
    ? value.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
    : [...GOOGLE_CALENDAR_SCOPES];
}

async function tokenRequest(
  fields: Record<string, string>,
  fallbackReason: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const payload = await response.json().catch(() => ({})) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const upstream = sanitizeReasonCode(payload.error, fallbackReason);
    const reason = upstream === "invalid_grant"
      ? "google_reauthorization_required"
      : fallbackReason;
    throw new GoogleCalendarApiError(response.status, reason);
  }
  return payload;
}

export async function exchangeGoogleCode(
  code: string,
  config = googleCalendarConfig(),
): Promise<GoogleTokenResult> {
  const payload = await tokenRequest({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  }, "google_token_exchange_failed");
  const accessToken = typeof payload.access_token === "string"
    ? payload.access_token
    : "";
  const refreshToken = typeof payload.refresh_token === "string"
    ? payload.refresh_token
    : null;
  const expiresIn = Number(payload.expires_in ?? 3600);
  if (!accessToken) throw new HttpError(502, "google_access_token_missing");
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + Math.max(60, expiresIn) * 1000)
      .toISOString(),
    scopes: parseScopes(payload.scope),
  };
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
  config = googleCalendarConfig(),
): Promise<GoogleTokenResult> {
  const payload = await tokenRequest({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  }, "google_token_refresh_failed");
  const accessToken = typeof payload.access_token === "string"
    ? payload.access_token
    : "";
  const expiresIn = Number(payload.expires_in ?? 3600);
  if (!accessToken) {
    throw new GoogleCalendarApiError(502, "google_access_token_missing");
  }
  return {
    accessToken,
    refreshToken: null,
    expiresAt: new Date(Date.now() + Math.max(60, expiresIn) * 1000)
      .toISOString(),
    scopes: parseScopes(payload.scope),
  };
}

export async function getGoogleUserInfo(
  accessToken: string,
): Promise<GoogleUserInfo> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({})) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new GoogleCalendarApiError(
      response.status,
      "google_account_lookup_failed",
    );
  }
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email : "";
  if (!sub || !email) {
    throw new GoogleCalendarApiError(502, "google_account_identity_missing");
  }
  return { sub, email };
}

function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return value.toISOString().slice(0, 10);
}

function timeParts(value: string | null): [number, number] {
  const match = value?.match(/^(\d{2}):(\d{2})/);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

function localDateTime(date: string, time: string): string {
  const normalized = time.match(/^\d{2}:\d{2}/)?.[0] ?? "00:00";
  return `${date}T${normalized}:00-03:00`;
}

function defaultEnd(
  date: string,
  startTime: string,
): { date: string; time: string } {
  const [hours, minutes] = timeParts(startTime);
  const total = hours * 60 + minutes + 60;
  const nextDate = total >= 24 * 60 ? addDays(date, 1) : date;
  const withinDay = total % (24 * 60);
  return {
    date: nextDate,
    time: `${String(Math.floor(withinDay / 60)).padStart(2, "0")}:${
      String(withinDay % 60).padStart(2, "0")
    }`,
  };
}

export function googleEventId(calendarEventId: string): string {
  const compact = calendarEventId.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (compact.length !== 32) throw new Error("calendar_event_id_invalid");
  return `norteia${compact}`;
}

export function toGoogleEventResource(
  event: NorteiaCalendarEvent,
  clientName: string,
  includeId: boolean,
): GoogleEventResource {
  if (!event.event_date) throw new Error("calendar_event_date_missing");
  const allDay = event.all_day !== false;
  const summary = clientName.trim()
    ? `${clientName.trim()} · ${event.title.trim()}`
    : event.title.trim();
  const details = [
    event.note?.trim() ?? "",
    clientName.trim() ? `Cliente: ${clientName.trim()}` : "",
    "Origem: Norteia",
  ].filter(Boolean).join("\n\n");

  let start: GoogleEventResource["start"];
  let end: GoogleEventResource["end"];
  if (allDay) {
    start = { date: event.event_date };
    end = { date: addDays(event.event_date, 1) };
  } else {
    const startTime = event.start_time?.slice(0, 5) || "09:00";
    let endDate = event.event_date;
    let endTime = event.end_time?.slice(0, 5) ?? "";
    if (!endTime) {
      const fallback = defaultEnd(event.event_date, startTime);
      endDate = fallback.date;
      endTime = fallback.time;
    } else {
      const [startHour, startMinute] = timeParts(startTime);
      const [endHour, endMinute] = timeParts(endTime);
      if (endHour * 60 + endMinute <= startHour * 60 + startMinute) {
        endDate = addDays(event.event_date, 1);
      }
    }
    start = {
      dateTime: localDateTime(event.event_date, startTime),
      timeZone: "America/Sao_Paulo",
    };
    end = {
      dateTime: localDateTime(endDate, endTime),
      timeZone: "America/Sao_Paulo",
    };
  }

  return {
    ...(includeId ? { id: googleEventId(event.id) } : {}),
    summary,
    description: details,
    start,
    end,
    extendedProperties: {
      private: {
        norteia_event_id: event.id,
        norteia_organization_id: event.organization_id,
        norteia_client_id: event.client_id ?? "",
      },
    },
  };
}

function googleReason(status: number): string {
  if (status === 401) return "google_reauthorization_required";
  if (status === 403) return "google_calendar_forbidden";
  if (status === 404 || status === 410) return "google_event_not_found";
  if (status === 409) return "google_event_conflict";
  if (status === 429) return "google_rate_limited";
  return `google_calendar_http_${status}`;
}

export async function googleCalendarRequest<T>(input: {
  accessToken: string;
  calendarId: string;
  method: "POST" | "PUT" | "DELETE";
  eventId?: string;
  body?: GoogleEventResource;
}): Promise<T | null> {
  const calendar = encodeURIComponent(input.calendarId);
  const eventPath = input.eventId
    ? `/${encodeURIComponent(input.eventId)}`
    : "";
  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${calendar}/events${eventPath}`,
    {
      method: input.method,
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    },
  );
  if (response.ok) {
    if (response.status === 204) return null;
    return await response.json() as T;
  }
  throw new GoogleCalendarApiError(
    response.status,
    googleReason(response.status),
  );
}
