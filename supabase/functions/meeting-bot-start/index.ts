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

// API da Vexa.ai: a "Bot Key" (escopo usado aqui) só tem permissão no
// endpoint POST /bots (confirmado testando ao vivo em 2026-08-25 — POST
// /meetings devolve 403 "Insufficient scope for this endpoint" com esse tipo
// de chave). /bots entra na chamada IMEDIATAMENTE: não aceita scheduled_at.
// Por isso, se vier um scheduled_at no futuro (ex.: evento do Calendário de
// Equipe criado com antecedência), NÃO chamamos a Vexa agora — só guardamos a
// reunião como "pending". Disparar o bot na hora certa exige um cron próprio
// (ainda não construído) que rode meeting-bot-start perto do horário.
const VEXA_BASE_URL = "https://api.cloud.vexa.ai";
const SCHEDULE_TOLERANCE_MS = 2 * 60 * 1000; // até 2min no futuro = "agora"

interface Body {
  organization_id?: string;
  client_id?: string | null;
  team_event_id?: string | null;
  meeting_link?: string;
  title?: string;
  scheduled_at?: string | null; // ISO-8601; omitido = entra imediatamente
}

function parseMeetingUrl(
  url: string,
): { platform: string; nativeMeetingId: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "meet.google.com") {
      const nativeMeetingId = parsed.pathname.replace(/^\/+/, "").split(
        "/",
      )[0];
      if (nativeMeetingId) return { platform: "google_meet", nativeMeetingId };
    }
    return null;
  } catch {
    return null;
  }
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

    const parsedMeeting = parseMeetingUrl(meetingLink);
    if (!parsedMeeting) throw new HttpError(400, "unsupported_meeting_link");

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

    const scheduledAtMs = body.scheduled_at
      ? Date.parse(body.scheduled_at)
      : NaN;
    const isFutureSchedule = !Number.isNaN(scheduledAtMs) &&
      scheduledAtMs - Date.now() > SCHEDULE_TOLERANCE_MS;
    if (isFutureSchedule) {
      // Ainda não há cron que dispare o bot na hora certa — a reunião fica
      // "pending" e precisa ser iniciada manualmente perto do horário (ou
      // quando o cron de agendamento for construído).
      return jsonResponse(
        { ok: true, meeting_id: meetingId, scheduled: true },
        200,
        headers,
      );
    }

    const vexaKey = requiredEnv("VEXA_API_KEY");
    const vexaResponse = await fetch(`${VEXA_BASE_URL}/bots`, {
      method: "POST",
      headers: {
        "X-API-Key": vexaKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        platform: parsedMeeting.platform,
        native_meeting_id: parsedMeeting.nativeMeetingId,
        bot_name: "Norteia",
        language: "pt",
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
