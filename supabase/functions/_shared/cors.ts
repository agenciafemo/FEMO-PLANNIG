import { HttpError } from "./http.ts";

const ALLOWED_HEADERS = [
  "authorization",
  "apikey",
  "content-type",
  "x-client-info",
  "x-request-id",
].join(", ");

function configuredOrigins(): Set<string> {
  const values = [
    ...(Deno.env.get("META_ALLOWED_ORIGINS") ?? "").split(","),
    Deno.env.get("META_APP_RETURN_ORIGIN") ?? "",
  ];
  return new Set(
    values.map((value) => value.trim()).filter(Boolean).map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        throw new Error("invalid_server_configuration:meta_allowed_origins");
      }
    }),
  );
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && configuredOrigins().has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function assertAllowedOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (origin && !configuredOrigins().has(origin)) {
    throw new HttpError(403, "origin_not_allowed");
  }
}

export function handlePreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  assertAllowedOrigin(request);
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
