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
import { createUserClient, requiredEnv } from "../_shared/supabase.ts";

// API da Vexa.ai (docs.vexa.ai/api/meetings.md): POST /meetings recebe
// meeting_url e resolve plataforma/id nativo no servidor deles. scheduled_at
// + auto_join fazem a própria Vexa colocar o bot na hora certa — não
// precisamos de cron próprio para agendar.
const VEXA_BASE_URL = "https://api.cloud.vexa.ai";

interface Body {
  organization_id?: string;
  client_id?: string | null;
  team_event_id?: string | null;
  meeting_link?: string;
  title?: string;
  scheduled_at?: string | null; // ISO-8601; omitido = entra imediatamente
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

    const token = (request.headers.get("Authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    ).trim();
    if (!token) throw new HttpError(401, "unauthorized");
    const supabase = createUserClient(token);
    const { data: userData, error: userError } = await supabase.auth
      .getUser();
    if (userError || !userData?.user) throw new HttpError(401, "unauthorized");

    const body = await readJson<Body>(request);
    const organizationId = body.organization_id?.trim();
    const meetingLink = body.meeting_link?.trim();
    if (!organizationId) throw new HttpError(400, "missing_organization_id");
    if (!meetingLink) throw new HttpError(400, "missing_meeting_link");

    const membershipResult = await supabase.from("organization_members")
      .select("role").eq("organization_id", organizationId).eq(
        "user_id",
        userData.user.id,
      ).eq("status", "active").maybeSingle();
    if (
      membershipResult.error || !membershipResult.data ||
      !["owner", "admin", "manager", "editor"].includes(
        membershipResult.data.role,
      )
    ) {
      throw new HttpError(403, "meeting_bot_forbidden");
    }

    const title = body.title?.trim() || "Reunião";
    const insertResult = await supabase.from("meetings").insert({
      organization_id: organizationId,
      client_id: body.client_id ?? null,
      team_event_id: body.team_event_id ?? null,
      title,
      source: "bot",
      status: "pending",
      meeting_link: meetingLink,
      created_by: userData.user.id,
    }).select("id").single();
    if (insertResult.error || !insertResult.data) {
      throw new HttpError(502, "meeting_create_failed");
    }
    const meetingId = insertResult.data.id as string;

    const vexaKey = requiredEnv("VEXA_API_KEY");
    const vexaResponse = await fetch(`${VEXA_BASE_URL}/meetings`, {
      method: "POST",
      headers: {
        "X-API-Key": vexaKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        meeting_url: meetingLink,
        auto_join: true,
        ...(body.scheduled_at ? { scheduled_at: body.scheduled_at } : {}),
      }),
    });
    const vexaPayload = await vexaResponse.json().catch(() => ({}));

    if (!vexaResponse.ok) {
      await supabase.from("meetings").update({
        status: "failed",
        failure_reason: "vexa_join_failed",
      }).eq("id", meetingId);
      await supabase.from("notifications").insert({
        organization_id: organizationId,
        user_id: userData.user.id,
        title: `⚠️ Não consegui entrar em "${title}"`,
        body: "Confira o link da reunião e tente novamente.",
        type: "meeting_failed",
        read: false,
      }).then(() => {}, () => {});
      throw new HttpError(502, "vexa_join_failed", vexaResponse.status);
    }

    await supabase.from("meetings").update({
      status: "recording",
      vexa_bot_id: String(vexaPayload?.id ?? ""),
    }).eq("id", meetingId);

    return jsonResponse({ ok: true, meeting_id: meetingId }, 200, headers);
  } catch (error) {
    return errorResponse(error, headers);
  }
});
