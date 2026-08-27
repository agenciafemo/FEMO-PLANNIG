import {
  errorResponse,
  HttpError,
  jsonResponse,
  methodNotAllowed,
  safeLog,
  safeRequestId,
} from "../_shared/http.ts";
import { timingSafeEqual } from "../_shared/security.ts";
import { createAdminClient, requiredEnv } from "../_shared/supabase.ts";

const FUNCTION_NAME = "frameio-zapier-webhook";
const MAX_BODY_BYTES = 64 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ConnectionConfig {
  organization_id: string;
  token: string;
  enabled?: boolean;
}

interface ZapierCommentBody {
  event_type?: unknown;
  comment_id?: unknown;
  file_id?: unknown;
  comment_text?: unknown;
  frame_timestamp_seconds?: unknown;
  author_id?: unknown;
  author_name?: unknown;
  completed_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

function cleanText(
  value: unknown,
  field: string,
  maxLength: number,
  required = false,
): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    if (required) throw new HttpError(400, `missing_${field}`);
    return null;
  }
  if (normalized.length > maxLength) {
    throw new HttpError(400, `${field}_too_long`);
  }
  return normalized;
}

function optionalTimestamp(value: unknown, field: string): string | null {
  const normalized = cleanText(value, field, 80);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `invalid_${field}`);
  }
  return parsed.toISOString();
}

function optionalSeconds(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 100_000_000) {
    throw new HttpError(400, "invalid_frame_timestamp_seconds");
  }
  return Math.round(seconds * 1000) / 1000;
}

function connectionConfigs(): ConnectionConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(requiredEnv("FRAMEIO_ZAPIER_CONNECTIONS"));
  } catch {
    throw new HttpError(500, "frameio_connections_config_invalid");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new HttpError(500, "frameio_connections_config_invalid");
  }

  const configs = parsed.filter((item): item is ConnectionConfig => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Record<string, unknown>;
    return typeof candidate.organization_id === "string" &&
      UUID_PATTERN.test(candidate.organization_id) &&
      typeof candidate.token === "string" &&
      candidate.token.length >= 32 &&
      candidate.token.length <= 256 &&
      candidate.enabled !== false;
  });

  if (configs.length === 0) {
    throw new HttpError(500, "frameio_connections_config_invalid");
  }
  return configs;
}

function organizationForToken(token: string): string | null {
  for (const config of connectionConfigs()) {
    if (timingSafeEqual(token, config.token)) return config.organization_id;
  }
  return null;
}

async function readBody(request: Request): Promise<ZapierCommentBody> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large");
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not_an_object");
    }
    return parsed as ZapierCommentBody;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

Deno.serve(async (request) => {
  const requestId = safeRequestId(request);
  const headers: HeadersInit = { "X-Request-Id": requestId };

  try {
    if (request.method !== "POST") {
      return methodNotAllowed(headers, ["POST"]);
    }

    const suppliedToken = request.headers.get("x-norteia-webhook-secret")
      ?.trim();
    if (!suppliedToken || suppliedToken.length > 256) {
      throw new HttpError(401, "invalid_webhook_secret");
    }
    const organizationId = organizationForToken(suppliedToken);
    if (!organizationId) {
      throw new HttpError(401, "invalid_webhook_secret");
    }

    const body = await readBody(request);
    const eventType = cleanText(body.event_type, "event_type", 120, true);
    if (eventType !== "comment.created") {
      throw new HttpError(422, "unsupported_event_type");
    }

    const commentId = cleanText(body.comment_id, "comment_id", 200, true)!;
    const fileId = cleanText(body.file_id, "file_id", 200, true)!;
    const commentText = cleanText(
      body.comment_text,
      "comment_text",
      20_000,
      true,
    )!;
    const frameTimestampSeconds = optionalSeconds(
      body.frame_timestamp_seconds,
    );
    const authorId = cleanText(body.author_id, "author_id", 200);
    const authorName = cleanText(body.author_name, "author_name", 500);
    const completedAt = optionalTimestamp(body.completed_at, "completed_at");
    const createdAt = optionalTimestamp(body.created_at, "created_at");
    const updatedAt = optionalTimestamp(body.updated_at, "updated_at");
    const eventKey = `${eventType}:${commentId}`;

    const admin = createAdminClient();
    const eventInsert = await admin.from("frameio_webhook_events").insert({
      organization_id: organizationId,
      event_key: eventKey,
      event_type: eventType,
      file_id: fileId,
      external_comment_id: commentId,
      processing_status: "received",
    }).select("id").maybeSingle();

    if (eventInsert.error?.code === "23505") {
      return jsonResponse(
        { ok: true, duplicate: true, request_id: requestId },
        200,
        headers,
      );
    }
    if (eventInsert.error || !eventInsert.data) {
      throw new HttpError(500, "event_registration_failed");
    }

    const eventId = eventInsert.data.id;
    const commentUpsert = await admin.from("frameio_comments").upsert({
      organization_id: organizationId,
      file_id: fileId,
      external_comment_id: commentId,
      comment_text: commentText,
      frame_timestamp_seconds: frameTimestampSeconds,
      author_external_id: authorId,
      author_name: authorName,
      is_completed: completedAt !== null,
      completed_at: completedAt,
      external_created_at: createdAt,
      external_updated_at: updatedAt,
      last_received_at: new Date().toISOString(),
    }, { onConflict: "organization_id,external_comment_id" }).select("id")
      .maybeSingle();

    if (commentUpsert.error || !commentUpsert.data) {
      await admin.from("frameio_webhook_events").update({
        processing_status: "failed",
        reason_code: "comment_upsert_failed",
        processed_at: new Date().toISOString(),
      }).eq("id", eventId).select("id");
      throw new HttpError(500, "comment_upsert_failed");
    }

    const linkResult = await admin.from("frameio_asset_links").select("id")
      .eq("organization_id", organizationId)
      .eq("file_id", fileId)
      .maybeSingle();
    if (linkResult.error) {
      throw new HttpError(500, "asset_link_lookup_failed");
    }

    const eventUpdate = await admin.from("frameio_webhook_events").update({
      processing_status: "processed",
      reason_code: linkResult.data ? null : "asset_not_linked",
      processed_at: new Date().toISOString(),
    }).eq("id", eventId).select("id");
    if (eventUpdate.error || !eventUpdate.data?.length) {
      throw new HttpError(500, "event_completion_failed");
    }

    safeLog("frameio_comment_received", {
      function_name: FUNCTION_NAME,
      request_id: requestId,
      step: linkResult.data ? "linked" : "unlinked",
    });

    return jsonResponse(
      {
        ok: true,
        duplicate: false,
        linked: Boolean(linkResult.data),
        request_id: requestId,
      },
      200,
      headers,
    );
  } catch (error) {
    safeLog("frameio_webhook_failure", {
      function_name: FUNCTION_NAME,
      request_id: requestId,
      reason_code: error instanceof HttpError
        ? error.reasonCode
        : "internal_error",
      status: error instanceof HttpError ? error.status : 500,
    });
    return errorResponse(error, headers);
  }
});
