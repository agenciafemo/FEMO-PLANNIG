import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, sanitizeReasonCode } from "./http.ts";
import { requiredEnv } from "./supabase.ts";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const BUSINESS_INFORMATION_URL =
  "https://mybusinessbusinessinformation.googleapis.com/v1";
const PERFORMANCE_URL =
  "https://businessprofileperformance.googleapis.com/v1";

export const GOOGLE_BUSINESS_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/business.manage",
];

type Config = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleBusinessCredentials = {
  connection_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
};

export type GoogleBusinessLocation = {
  name: string;
  title: string;
  storeCode: string | null;
  placeId: string | null;
  storefrontAddress: Record<string, unknown> | null;
};

export type GoogleBusinessDailyInsights = {
  date: string;
  search_impressions: number;
  maps_impressions: number;
  calls: number;
  directions: number;
  website_clicks: number;
};

export type GoogleBusinessNormalizedInsights = {
  totals: {
    search_impressions: number;
    maps_impressions: number;
    total_impressions: number;
    calls: number;
    directions: number;
    website_clicks: number;
    total_actions: number;
  };
  daily: GoogleBusinessDailyInsights[];
};

export class GoogleBusinessApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly reasonCode: string,
  ) {
    super(reasonCode);
  }
}

function config(): Config {
  const businessClientId = Deno.env.get("GOOGLE_BUSINESS_CLIENT_ID")?.trim();
  const businessClientSecret = Deno.env.get("GOOGLE_BUSINESS_CLIENT_SECRET")
    ?.trim();
  const businessRedirectUri = Deno.env.get("GOOGLE_BUSINESS_REDIRECT_URI")
    ?.trim();
  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  return {
    // A mesma credencial OAuth pode atender Calendar e Business Profile desde
    // que o callback abaixo esteja cadastrado no Google Cloud. Secrets
    // dedicados continuam tendo prioridade quando forem configurados.
    clientId: businessClientId || requiredEnv("GOOGLE_CALENDAR_CLIENT_ID"),
    clientSecret: businessClientSecret ||
      requiredEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
    redirectUri: businessRedirectUri ||
      `${supabaseUrl}/functions/v1/google-business-oauth-callback`,
  };
}

export function buildGoogleBusinessAuthorizeUrl(state: string): string {
  const current = config();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", current.clientId);
  url.searchParams.set("redirect_uri", current.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_BUSINESS_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

async function tokenRequest(fields: Record<string, string>) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const upstream = sanitizeReasonCode(payload.error, "google_business_token_failed");
    throw new GoogleBusinessApiError(
      response.status,
      upstream === "invalid_grant"
        ? "google_business_reauthorization_required"
        : "google_business_token_failed",
    );
  }
  return payload;
}

function tokenResult(payload: Record<string, unknown>) {
  const accessToken = typeof payload.access_token === "string"
    ? payload.access_token
    : "";
  if (!accessToken) {
    throw new GoogleBusinessApiError(502, "google_business_access_token_missing");
  }
  const expiresIn = Number(payload.expires_in ?? 3600);
  return {
    accessToken,
    refreshToken: typeof payload.refresh_token === "string"
      ? payload.refresh_token
      : null,
    expiresAt: new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString(),
    scopes: typeof payload.scope === "string"
      ? payload.scope.split(/\s+/).filter(Boolean)
      : [...GOOGLE_BUSINESS_SCOPES],
  };
}

export async function exchangeGoogleBusinessCode(code: string) {
  const current = config();
  return tokenResult(await tokenRequest({
    code,
    client_id: current.clientId,
    client_secret: current.clientSecret,
    redirect_uri: current.redirectUri,
    grant_type: "authorization_code",
  }));
}

async function refreshGoogleBusinessToken(refreshToken: string) {
  const current = config();
  return tokenResult(await tokenRequest({
    refresh_token: refreshToken,
    client_id: current.clientId,
    client_secret: current.clientSecret,
    grant_type: "refresh_token",
  }));
}

export async function getGoogleBusinessIdentity(accessToken: string) {
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email : "";
  if (!response.ok || !sub || !email) {
    throw new GoogleBusinessApiError(
      response.status || 502,
      "google_business_account_lookup_failed",
    );
  }
  return { sub, email };
}

export async function activeGoogleBusinessCredentials(
  admin: SupabaseClient,
  organizationId: string,
): Promise<GoogleBusinessCredentials> {
  const { data, error } = await admin.rpc(
    "google_business_server_get_credentials",
    { _organization_id: organizationId },
  );
  const current = data?.[0] as GoogleBusinessCredentials | undefined;
  if (error || !current) throw new HttpError(409, "google_business_not_connected");

  const expiresAt = current.token_expires_at
    ? new Date(current.token_expires_at).getTime()
    : 0;
  if (expiresAt > Date.now() + 2 * 60 * 1000) return current;

  try {
    const refreshed = await refreshGoogleBusinessToken(current.refresh_token);
    const { error: persistError } = await admin.rpc(
      "google_business_server_refresh_access_token",
      {
        _connection_id: current.connection_id,
        _access_token: refreshed.accessToken,
        _token_expires_at: refreshed.expiresAt,
      },
    );
    if (persistError) throw new HttpError(500, "google_business_token_persist_failed");
    return {
      ...current,
      access_token: refreshed.accessToken,
      token_expires_at: refreshed.expiresAt,
    };
  } catch (error) {
    const reason = error instanceof GoogleBusinessApiError
      ? error.reasonCode
      : "google_business_token_refresh_failed";
    await admin.rpc("google_business_server_mark_result", {
      _connection_id: current.connection_id,
      _status: "reauth_required",
      _reason_code: sanitizeReasonCode(reason),
    });
    throw new HttpError(401, reason);
  }
}

function apiReason(status: number): string {
  if (status === 401) return "google_business_reauthorization_required";
  if (status === 403) return "google_business_permission_denied";
  if (status === 404) return "google_business_location_not_found";
  if (status === 429) return "google_business_rate_limited";
  return `google_business_http_${status}`;
}

async function googleGet(
  url: URL,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-GOOG-API-FORMAT-VERSION": "2",
    },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new GoogleBusinessApiError(response.status, apiReason(response.status));
  }
  return payload;
}

export async function listGoogleBusinessLocations(
  accessToken: string,
): Promise<GoogleBusinessLocation[]> {
  const locations: GoogleBusinessLocation[] = [];
  let pageToken = "";
  const seenPageTokens = new Set<string>();
  do {
    const url = new URL(`${BUSINESS_INFORMATION_URL}/accounts/-/locations`);
    url.searchParams.set(
      "readMask",
      "name,title,storeCode,metadata,storefrontAddress",
    );
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const payload = await googleGet(url, accessToken);
    for (const raw of (payload.locations ?? []) as Array<Record<string, unknown>>) {
      const metadata = (raw.metadata ?? {}) as Record<string, unknown>;
      const name = typeof raw.name === "string" ? raw.name : "";
      const title = typeof raw.title === "string" ? raw.title : "";
      if (!/^locations\/[0-9]+$/.test(name) || !title) continue;
      locations.push({
        name,
        title,
        storeCode: typeof raw.storeCode === "string" ? raw.storeCode : null,
        placeId: typeof metadata.placeId === "string" ? metadata.placeId : null,
        storefrontAddress: raw.storefrontAddress &&
            typeof raw.storefrontAddress === "object"
          ? raw.storefrontAddress as Record<string, unknown>
          : null,
      });
    }
    const nextPageToken = typeof payload.nextPageToken === "string"
      ? payload.nextPageToken
      : "";
    if (nextPageToken && seenPageTokens.has(nextPageToken)) {
      throw new GoogleBusinessApiError(502, "google_business_pagination_invalid");
    }
    if (nextPageToken) seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  } while (pageToken);
  return locations.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
}

export const GOOGLE_BUSINESS_DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_DIRECTION_REQUESTS",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
] as const;

const METRIC_FIELD = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "maps_impressions",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "search_impressions",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "maps_impressions",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "search_impressions",
  BUSINESS_DIRECTION_REQUESTS: "directions",
  CALL_CLICKS: "calls",
  WEBSITE_CLICKS: "website_clicks",
} as const satisfies Record<
  typeof GOOGLE_BUSINESS_DAILY_METRICS[number],
  Exclude<keyof GoogleBusinessDailyInsights, "date">
>;

function googleDate(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const year = Number(raw.year);
  const month = Number(raw.month);
  const day = Number(raw.day);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const result = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${result}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === result
    ? result
    : null;
}

export function normalizeGoogleBusinessInsights(
  payload: Record<string, unknown>,
): GoogleBusinessNormalizedInsights {
  const daily = new Map<string, GoogleBusinessDailyInsights>();
  const series = Array.isArray(payload.multiDailyMetricTimeSeries)
    ? payload.multiDailyMetricTimeSeries
    : [];

  for (const rawSeries of series) {
    if (!rawSeries || typeof rawSeries !== "object") continue;
    const metricSeries = rawSeries as Record<string, unknown>;
    const metric = metricSeries.dailyMetric;
    if (typeof metric !== "string" || !(metric in METRIC_FIELD)) continue;
    const field = METRIC_FIELD[metric as keyof typeof METRIC_FIELD];
    const timeSeries = metricSeries.timeSeries;
    if (!timeSeries || typeof timeSeries !== "object") continue;
    const datedValues = (timeSeries as Record<string, unknown>).datedValues;
    if (!Array.isArray(datedValues)) continue;

    for (const rawValue of datedValues) {
      if (!rawValue || typeof rawValue !== "object") continue;
      const datedValue = rawValue as Record<string, unknown>;
      const date = googleDate(datedValue.date);
      const value = Number(datedValue.value ?? 0);
      if (!date || !Number.isFinite(value)) continue;
      const current = daily.get(date) ?? {
        date,
        search_impressions: 0,
        maps_impressions: 0,
        calls: 0,
        directions: 0,
        website_clicks: 0,
      };
      current[field] += value;
      daily.set(date, current);
    }
  }

  const ordered = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  const totals = ordered.reduce(
    (sum, day) => ({
      search_impressions: sum.search_impressions + day.search_impressions,
      maps_impressions: sum.maps_impressions + day.maps_impressions,
      calls: sum.calls + day.calls,
      directions: sum.directions + day.directions,
      website_clicks: sum.website_clicks + day.website_clicks,
    }),
    {
      search_impressions: 0,
      maps_impressions: 0,
      calls: 0,
      directions: 0,
      website_clicks: 0,
    },
  );
  return {
    totals: {
      ...totals,
      total_impressions: totals.search_impressions + totals.maps_impressions,
      total_actions: totals.calls + totals.directions + totals.website_clicks,
    },
    daily: ordered,
  };
}

function dateParams(prefix: string, value: string, url: URL): void {
  const [year, month, day] = value.split("-").map(Number);
  url.searchParams.set(`${prefix}.year`, String(year));
  url.searchParams.set(`${prefix}.month`, String(month));
  url.searchParams.set(`${prefix}.day`, String(day));
}

export async function fetchGoogleBusinessInsights(input: {
  accessToken: string;
  locationName: string;
  startDate: string;
  endDate: string;
}): Promise<Record<string, unknown>> {
  const url = new URL(
    `${PERFORMANCE_URL}/${input.locationName}:fetchMultiDailyMetricsTimeSeries`,
  );
  for (const metric of GOOGLE_BUSINESS_DAILY_METRICS) {
    url.searchParams.append("dailyMetrics", metric);
  }
  // O endpoint REST usa snake_case nos campos aninhados da query, conforme o
  // exemplo oficial da Performance API.
  dateParams("dailyRange.start_date", input.startDate, url);
  dateParams("dailyRange.end_date", input.endDate, url);
  return googleGet(url, input.accessToken);
}
