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

const DEEPGRAM_URL =
  "https://api.deepgram.com/v1/listen?model=nova-2&language=pt-BR&diarize=true&punctuate=true&utterances=true&smart_format=true";
const SIGNED_URL_TTL_SECONDS = 600;

interface Body {
  meeting_id?: string;
}

interface Utterance {
  speaker: number;
  text: string;
  start_ms: number;
  end_ms: number;
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  // deno-lint-ignore no-explicit-any
  let supabase: any = null;
  let meetingId: string | undefined;
  let token = "";

  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    assertAllowedOrigin(request);
    if (request.method !== "POST") {
      return methodNotAllowed(headers, ["POST", "OPTIONS"]);
    }

    token = (request.headers.get("Authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    ).trim();
    if (!token) throw new HttpError(401, "unauthorized");
    supabase = createUserClient(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) throw new HttpError(401, "unauthorized");

    const body = await readJson<Body>(request);
    meetingId = body.meeting_id;
    if (typeof meetingId !== "string" || !meetingId.trim()) {
      throw new HttpError(400, "missing_meeting_id");
    }

    const meetingResult = await supabase.from("meetings").select(
      "id, organization_id, created_by, title, audio_storage_path, status",
    ).eq("id", meetingId).single();
    if (meetingResult.error || !meetingResult.data) {
      throw new HttpError(404, "meeting_not_found");
    }
    const meeting = meetingResult.data;
    const organizationId = meeting.organization_id as string;
    const storagePath = meeting.audio_storage_path as string | null;
    if (!storagePath) {
      throw new HttpError(409, "missing_audio_file");
    }

    const membershipResult = await supabase.from("organization_members").select(
      "role",
    ).eq("organization_id", organizationId).eq("user_id", userData.user.id).eq(
      "status",
      "active",
    ).maybeSingle();
    if (
      membershipResult.error || !membershipResult.data ||
      !["owner", "admin", "manager", "editor"].includes(
        membershipResult.data.role,
      )
    ) {
      throw new HttpError(403, "meeting_transcribe_forbidden");
    }

    await supabase.from("meetings").update({ status: "transcribing" }).eq(
      "id",
      meetingId,
    );

    const signedResult = await supabase.storage.from("meeting-recordings")
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (signedResult.error || !signedResult.data?.signedUrl) {
      throw new HttpError(502, "signed_url_failed");
    }

    const deepgramKey = requiredEnv("DEEPGRAM_API_KEY");
    const dgResponse = await fetch(DEEPGRAM_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${deepgramKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: signedResult.data.signedUrl }),
    });
    const dgPayload = await dgResponse.json().catch(() => ({}));
    if (!dgResponse.ok) {
      throw new HttpError(502, "transcription_request_failed", dgResponse.status);
    }

    const channel = dgPayload?.results?.channels?.[0];
    const transcriptText = channel?.alternatives?.[0]?.transcript;
    if (typeof transcriptText !== "string" || !transcriptText.trim()) {
      throw new HttpError(502, "transcription_empty");
    }
    const utterances: Utterance[] = Array.isArray(dgPayload?.results?.utterances)
      ? dgPayload.results.utterances.map((entry: Record<string, unknown>) => ({
        speaker: typeof entry.speaker === "number" ? entry.speaker : 0,
        text: typeof entry.transcript === "string" ? entry.transcript : "",
        start_ms: Math.round((Number(entry.start) || 0) * 1000),
        end_ms: Math.round((Number(entry.end) || 0) * 1000),
      }))
      : [];
    const durationSeconds = Number(dgPayload?.metadata?.duration) || null;

    // Para em 'transcribed'. A ata por IA deixou de ser encadeada: virou ação
    // do usuário, no botão "Gerar ata com IA". Assim um upload transcrito com
    // sucesso não é mais descartado como falha só porque o Gemini não
    // respondeu — a transcrição é o ativo, a ata é derivada dela.
    const { error: updateError } = await supabase.from("meetings").update({
      status: "transcribed",
      failure_reason: null,
      transcript_text: transcriptText.trim(),
      transcript_raw: utterances,
      duration_seconds: durationSeconds,
    }).eq("id", meetingId);
    if (updateError) throw new HttpError(502, "meeting_save_failed");

    return jsonResponse(
      { ok: true, status: "transcribed", transcript_text: transcriptText },
      200,
      headers,
    );
  } catch (error) {
    if (supabase && meetingId) {
      const isHttpError = error instanceof HttpError;
      const reasonCode = isHttpError ? error.reasonCode : "internal_error";
      // 4xx (401/403/404/409/400) acontecem antes de qualquer processamento
      // começar — não há "transcrição em andamento" para marcar como falha,
      // e o usuário nem tem permissão de ver essa reunião necessariamente.
      // Só 5xx (ou erro inesperado sem HttpError) é falha real de processamento.
      //
      // Não existe mais o caso "o erro veio de dentro do meeting-summarize":
      // esta função não o chama mais, então todo erro que chega aqui é falha
      // de transcrição de verdade — e aí 'failed' é o status correto.
      const isProcessingFailure = !isHttpError || error.status >= 500;
      if (isProcessingFailure) {
        await supabase.from("meetings").update({
          status: "failed",
          failure_reason: reasonCode,
        }).eq("id", meetingId).then(() => {}, () => {});
        const meetingResult = await supabase.from("meetings").select(
          "organization_id, created_by, title",
        ).eq("id", meetingId).maybeSingle().then(
          (r: { data: unknown }) => r,
          () => ({ data: null }),
        );
        const meeting = meetingResult?.data as
          | { organization_id: string; created_by: string; title: string }
          | null;
        if (meeting?.created_by) {
          await supabase.from("notifications").insert({
            organization_id: meeting.organization_id,
            user_id: meeting.created_by,
            title: `⚠️ Não consegui transcrever: ${meeting.title}`,
            body: "Verifique o arquivo de áudio e tente novamente.",
            type: "meeting_failed",
            read: false,
          }).then(() => {}, () => {});
        }
      }
    }
    return errorResponse(error, headers);
  }
});
