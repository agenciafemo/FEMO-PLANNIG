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
import {
  buildTranscript,
  fetchVexaBots,
  fetchVexaTranscriptResult,
  parseMeetingUrl,
  stopVexaBot,
  type TranscriptSegment,
  type VexaBot,
} from "../_shared/vexa.ts";

// A transcrição já é produzida durante a reunião. Depois de pedir a saída do
// bot, damos uma janela curta para a Vexa confirmar os últimos segmentos.
const TRANSCRIPT_ATTEMPTS = 6;
const TRANSCRIPT_DELAY_MS = 1_500;

interface Body {
  meeting_id?: string;
  /** Encerra a reuniao mesmo sem transcricao. E a saida para o caso em que a
   *  Vexa nunca vai devolver nada: bot nao admitido, reuniao que nao
   *  aconteceu, ninguem falou. Sem isto a reuniao fica em 'recording' para
   *  sempre e o usuario tenta "de novo em alguns segundos" indefinidamente. */
  force_end?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) throw new HttpError(401, "unauthorized");

    const body = await readJson<Body>(request);
    const forcarEncerramento = body.force_end === true;
    const meetingId = body.meeting_id?.trim();
    if (!meetingId) throw new HttpError(400, "missing_meeting_id");

    const meetingResult = await supabase.from("meetings").select(
      "id, organization_id, meeting_link, vexa_bot_id, status, source",
    ).eq("id", meetingId).single();
    if (meetingResult.error || !meetingResult.data) {
      throw new HttpError(404, "meeting_not_found");
    }
    const meeting = meetingResult.data;

    /**
     * Fecha a reuniao assumindo que nao havera transcricao.
     *
     * 'failed' e o status honesto aqui: a transcricao — o ativo da reuniao —
     * de fato nao existe. Nao e 'transcribed', que promete um texto que nao
     * esta la, nem 'recording', que e o buraco de onde estamos saindo.
     */
    const encerrarSemTranscricao = async () => {
      const { data, error } = await supabase.from("meetings").update({
        status: "failed",
        failure_reason: "no_transcript",
      }).eq("id", meetingId).select("id");
      if (error) throw new HttpError(502, "meeting_save_failed");
      // UPDATE barrado por RLS devolve zero linhas SEM erro neste projeto.
      if (!data || data.length === 0) {
        throw new HttpError(403, "meeting_update_forbidden");
      }
      return jsonResponse(
        { ok: true, status: "no_transcript", meeting_id: meetingId },
        200,
        headers,
      );
    };

    if (meeting.source !== "bot" || !meeting.vexa_bot_id) {
      throw new HttpError(409, "not_a_bot_meeting");
    }
    if (!["recording", "pending"].includes(meeting.status)) {
      return jsonResponse(
        { ok: true, status: meeting.status, already_finished: true },
        200,
        headers,
      );
    }

    const membershipResult = await supabase.from("organization_members")
      .select("role")
      .eq("organization_id", meeting.organization_id)
      .eq("user_id", userData.user.id)
      .eq("status", "active")
      .maybeSingle();
    if (
      membershipResult.error || !membershipResult.data ||
      !["owner", "admin", "manager", "editor"].includes(
        membershipResult.data.role,
      )
    ) {
      throw new HttpError(403, "meeting_bot_stop_forbidden");
    }

    const parsedMeeting = parseMeetingUrl(meeting.meeting_link ?? "");
    if (!parsedMeeting) throw new HttpError(409, "unsupported_meeting_link");

    // Valida as duas chaves antes de encerrar a captura. Assim uma configuração
    // incompleta nunca para o bot sem termos como recuperar a transcrição.
    const vexaKey = requiredEnv("VEXA_API_KEY");
    const transcriptionKey = Deno.env.get("VEXA_TRANSCRIPTION_API_KEY")
      ?.trim();
    if (!transcriptionKey) {
      throw new HttpError(409, "missing_transcription_key");
    }

    const botsBeforeStop = await fetchVexaBots(vexaKey);
    const storedBot = botsBeforeStop.find((item) =>
      String(item.id) === String(meeting.vexa_bot_id)
    );

    const stopResult = await stopVexaBot(
      vexaKey,
      parsedMeeting.platform,
      parsedMeeting.nativeMeetingId,
    );
    // 404 é idempotente: o bot já pode ter saído sozinho ou por um clique
    // anterior. Ainda tentamos recuperar a transcrição existente.
    if (!stopResult.ok && stopResult.status !== 404) {
      throw new HttpError(502, "vexa_stop_failed", stopResult.status);
    }

    let segments: TranscriptSegment[] = [];
    for (let attempt = 0; attempt < TRANSCRIPT_ATTEMPTS; attempt++) {
      await sleep(TRANSCRIPT_DELAY_MS);
      const transcriptResult = await fetchVexaTranscriptResult(
        transcriptionKey,
        parsedMeeting.platform,
        parsedMeeting.nativeMeetingId,
      );
      if (transcriptResult.ok) {
        segments = transcriptResult.segments;
        if (segments.some((segment) => segment.text?.trim())) break;
        continue;
      }
      if ([401, 403].includes(transcriptResult.status)) {
        throw new HttpError(
          502,
          "vexa_transcript_forbidden",
          transcriptResult.status,
        );
      }
      // 404 e falhas temporárias podem ocorrer enquanto a Vexa fecha a sessão.
      if (
        transcriptResult.status >= 400 && transcriptResult.status < 500 &&
        transcriptResult.status !== 404
      ) {
        throw new HttpError(
          502,
          "vexa_transcript_failed",
          transcriptResult.status,
        );
      }
    }

    if (!segments.some((segment) => segment.text?.trim())) {
      if (forcarEncerramento) return await encerrarSemTranscricao();
      return jsonResponse(
        { ok: true, status: "transcript_pending", meeting_id: meetingId },
        200,
        headers,
      );
    }

    const botsAfterStop = await fetchVexaBots(vexaKey);
    const finalBot: VexaBot = botsAfterStop.find((item) =>
      String(item.id) === String(meeting.vexa_bot_id)
    ) ?? storedBot ?? {
      id: Number(meeting.vexa_bot_id) || 0,
      platform: parsedMeeting.platform,
      native_meeting_id: parsedMeeting.nativeMeetingId,
    };
    const built = buildTranscript(finalBot, segments);
    if (!built) {
      if (forcarEncerramento) return await encerrarSemTranscricao();
      return jsonResponse(
        { ok: true, status: "transcript_pending", meeting_id: meetingId },
        200,
        headers,
      );
    }

    // Para aqui, em 'transcribed'. A ata por IA deixou de ser encadeada: ela
    // e uma acao do usuario, no botao "Gerar ata com IA".
    //
    // Antes, esta funcao chamava meeting-summarize logo em seguida e, se o
    // Gemini nao respondesse, marcava a reuniao inteira como 'failed' — mesmo
    // com a transcricao salva e integra. A transcricao e o ativo; a ata e
    // derivada dela e pode ser refeita a qualquer momento.
    const saveResult = await supabase.from("meetings").update({
      status: "transcribed",
      failure_reason: null,
      transcript_text: built.transcriptText,
      transcript_raw: built.transcriptRaw,
      duration_seconds: built.durationSeconds,
    }).eq("id", meetingId);
    if (saveResult.error) {
      throw new HttpError(502, "meeting_save_failed");
    }

    return jsonResponse(
      { ok: true, status: "transcribed", meeting_id: meetingId },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
});
