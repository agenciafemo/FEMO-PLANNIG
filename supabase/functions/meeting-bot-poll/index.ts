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
import {
  buildTranscript,
  fetchVexaBots,
  fetchVexaTranscript,
  VEXA_FAILED_STATUSES,
} from "../_shared/vexa.ts";

// Chamada por um cron (pg_cron -> pg_net, mesmo mecanismo já usado no projeto
// para o robô de notificações do calendário) a cada poucos minutos. Não tem
// usuário logado, por isso autentica via segredo compartilhado em vez de JWT.
// Consulta o status de cada reunião com bot ativo na Vexa.ai; quando a
// reunião termina, busca a transcrição e dispara a geração da ata.
//
// A Vexa separa a API em duas chaves com escopos diferentes (confirmado
// testando ao vivo em 2026-08-25): a "Bot Key" (VEXA_API_KEY, mesma usada em
// meeting-bot-start) só acessa GET /bots (lista todos os bots, rodando ou
// não, com status/completion_reason) — NÃO acessa GET /meetings/{id} nem
// GET /transcripts/... (ambos devolvem 403 "Insufficient scope"). Buscar a
// transcrição pronta exige a "Transcription Key" separada
// (VEXA_TRANSCRIPTION_API_KEY) — se esse secret não estiver configurado
// ainda, a reunião fica marcada como "aguardando transcrição" em vez de
// falhar.
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
    const transcriptionKey = Deno.env.get("VEXA_TRANSCRIPTION_API_KEY")
      ?.trim();

    const pendingResult = await supabase.from("meetings").select(
      "id, organization_id, created_by, title, vexa_bot_id",
    ).eq("source", "bot").eq("status", "recording").not(
      "vexa_bot_id",
      "is",
      null,
    );
    if (pendingResult.error) throw new HttpError(502, "meetings_read_failed");

    const bots = await fetchVexaBots(vexaKey);
    const results: Array<{ meeting_id: string; outcome: string }> = [];

    for (const meeting of pendingResult.data ?? []) {
      const vexaMeetingId = meeting.vexa_bot_id as string;
      const vexaMeeting = bots.find((bot) => String(bot.id) === vexaMeetingId);
      if (!vexaMeeting) {
        results.push({ meeting_id: meeting.id, outcome: "vexa_bot_not_found" });
        continue;
      }

      if (VEXA_FAILED_STATUSES.has(vexaMeeting.status ?? "")) {
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

      if (!transcriptionKey) {
        // VEXA_TRANSCRIPTION_API_KEY ainda não configurado — a reunião fica
        // "recording" (o próximo poll tenta de novo) até o secret existir.
        results.push({
          meeting_id: meeting.id,
          outcome: "missing_transcription_key",
        });
        continue;
      }

      const platform = vexaMeeting.platform ?? "google_meet";
      const nativeMeetingId = vexaMeeting.native_meeting_id;
      if (!nativeMeetingId) {
        results.push({ meeting_id: meeting.id, outcome: "missing_native_id" });
        continue;
      }
      const segments = await fetchVexaTranscript(
        transcriptionKey,
        platform,
        nativeMeetingId,
      );
      const built = buildTranscript(vexaMeeting, segments);
      if (!built) {
        results.push({ meeting_id: meeting.id, outcome: "empty_transcript" });
        continue;
      }

      // Sai do status "recording" assim que a transcricao esta salva: o filtro
      // do cron e status='recording', entao deixar a reuniao nesse estado faria
      // a proxima rodada pegar a mesma reuniao e reprocessar tudo de novo.
      //
      // Para em 'transcribed'. A ata por IA deixou de ser encadeada aqui — ela
      // virou acao do usuario, no botao "Gerar ata com IA". O cron nao precisa
      // mais carregar a parte fragil (Gemini) da cadeia, e uma ata que nao sai
      // nao derruba mais a transcricao junto.
      const saveResult = await supabase.from("meetings").update({
        status: "transcribed",
        failure_reason: null,
        transcript_text: built.transcriptText,
        transcript_raw: built.transcriptRaw,
        duration_seconds: built.durationSeconds,
      }).eq("id", meeting.id);

      results.push({
        meeting_id: meeting.id,
        outcome: saveResult.error ? "meeting_save_failed" : "transcribed",
      });
    }

    return jsonResponse({ ok: true, processed: results }, 200, headers);
  } catch (error) {
    return errorResponse(error, headers);
  }
});
