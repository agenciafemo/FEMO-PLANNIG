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
} from "../_shared/http.ts";
import { createAdminClient, requiredEnv } from "../_shared/supabase.ts";
import { timingSafeEqual } from "../_shared/security.ts";

// Chamada por um cron (pg_cron -> pg_net, mesmo mecanismo já usado no projeto
// para o robô de notificações do calendário) a cada poucos minutos. Não tem
// usuário logado, por isso autentica via segredo compartilhado em vez de JWT.
// Consulta o status de cada reunião com bot ativo na Vexa.ai; quando a
// reunião termina, busca a transcrição e dispara a geração da ata.
const VEXA_BASE_URL = "https://api.cloud.vexa.ai";
const FAILED_STATUSES = new Set(["failed", "needs_help"]);

interface VexaMeeting {
  status?: string;
  platform?: string;
  native_meeting_id?: string;
}

interface TranscriptSegment {
  speaker?: string;
  text?: string;
  start?: number;
  end?: number;
}

async function fetchVexaMeeting(
  vexaKey: string,
  vexaMeetingId: string,
): Promise<VexaMeeting | null> {
  const response = await fetch(`${VEXA_BASE_URL}/meetings/${vexaMeetingId}`, {
    headers: { "X-API-Key": vexaKey },
  });
  if (!response.ok) return null;
  return await response.json().catch(() => null);
}

async function fetchVexaTranscript(
  vexaKey: string,
  platform: string,
  nativeMeetingId: string,
): Promise<TranscriptSegment[]> {
  const response = await fetch(
    `${VEXA_BASE_URL}/transcripts/${platform}/${nativeMeetingId}`,
    { headers: { "X-API-Key": vexaKey } },
  );
  if (!response.ok) return [];
  const payload = await response.json().catch(() => ({}));
  return Array.isArray(payload?.segments) ? payload.segments : [];
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

    const internalSecret = (request.headers.get("X-Internal-Secret") ?? "")
      .trim();
    if (
      !internalSecret ||
      !timingSafeEqual(internalSecret, requiredEnv("MEETINGS_INTERNAL_SECRET"))
    ) {
      throw new HttpError(401, "unauthorized");
    }

    const supabase = createAdminClient();
    const vexaKey = requiredEnv("VEXA_API_KEY");

    const pendingResult = await supabase.from("meetings").select(
      "id, organization_id, created_by, title, vexa_bot_id",
    ).eq("source", "bot").eq("status", "recording").not(
      "vexa_bot_id",
      "is",
      null,
    );
    if (pendingResult.error) throw new HttpError(502, "meetings_read_failed");

    const results: Array<{ meeting_id: string; outcome: string }> = [];

    for (const meeting of pendingResult.data ?? []) {
      const vexaMeetingId = meeting.vexa_bot_id as string;
      const vexaMeeting = await fetchVexaMeeting(vexaKey, vexaMeetingId);
      if (!vexaMeeting) {
        results.push({ meeting_id: meeting.id, outcome: "vexa_unreachable" });
        continue;
      }

      if (FAILED_STATUSES.has(vexaMeeting.status ?? "")) {
        await supabase.from("meetings").update({
          status: "failed",
          failure_reason: `vexa_${vexaMeeting.status}`,
        }).eq("id", meeting.id);
        await supabase.from("notifications").insert({
          organization_id: meeting.organization_id,
          user_id: meeting.created_by,
          title: `⚠️ Não consegui entrar em "${meeting.title}"`,
          body: "O anfitrião pode não ter admitido o bot na chamada.",
          type: "meeting_failed",
          read: false,
        }).then(() => {}, () => {});
        results.push({ meeting_id: meeting.id, outcome: "failed" });
        continue;
      }

      if (vexaMeeting.status !== "completed") {
        results.push({ meeting_id: meeting.id, outcome: "in_progress" });
        continue;
      }

      const platform = vexaMeeting.platform ?? "google_meet";
      const nativeMeetingId = vexaMeeting.native_meeting_id;
      if (!nativeMeetingId) {
        results.push({ meeting_id: meeting.id, outcome: "missing_native_id" });
        continue;
      }
      const segments = await fetchVexaTranscript(
        vexaKey,
        platform,
        nativeMeetingId,
      );
      const transcriptText = segments.map((segment) => segment.text ?? "")
        .filter(Boolean).join("\n").trim();
      if (!transcriptText) {
        results.push({ meeting_id: meeting.id, outcome: "empty_transcript" });
        continue;
      }
      const transcriptRaw = segments.map((segment) => ({
        speaker: segment.speaker ?? "desconhecido",
        text: segment.text ?? "",
        start_ms: Math.round((segment.start ?? 0) * 1000),
        end_ms: Math.round((segment.end ?? 0) * 1000),
      }));
      const durationSeconds = transcriptRaw.length > 0
        ? Math.round((transcriptRaw[transcriptRaw.length - 1].end_ms) / 1000)
        : null;

      // Sai do status "recording" ANTES de chamar meeting-summarize: se não
      // fizer isso e a chamada abaixo falhar/for cortada, a próxima rodada do
      // cron pegaria esta mesma reunião de novo (filtro é status='recording')
      // e reprocessaria a transcrição e o Gemini à toa a cada ciclo.
      await supabase.from("meetings").update({
        status: "summarizing",
        transcript_text: transcriptText,
        transcript_raw: transcriptRaw,
        duration_seconds: durationSeconds,
      }).eq("id", meeting.id);

      // Aguarda a resposta (não fire-and-forget): numa Edge Function, nada
      // garante que um fetch disparado sem await sobreviva ao retorno desta
      // resposta — a instância pode ser encerrada antes dele completar.
      const summarizeUrl =
        `${requiredEnv("SUPABASE_URL")}/functions/v1/meeting-summarize`;
      const summarizeResponse = await fetch(summarizeUrl, {
        method: "POST",
        headers: {
          "X-Internal-Secret": internalSecret,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ meeting_id: meeting.id }),
      }).catch(() => null);

      results.push({
        meeting_id: meeting.id,
        outcome: summarizeResponse?.ok ? "summarized" : "summarize_call_failed",
      });
    }

    return jsonResponse({ ok: true, processed: results }, 200, headers);
  } catch (error) {
    return errorResponse(error, headers);
  }
});
