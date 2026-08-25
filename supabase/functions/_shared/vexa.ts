// Helpers compartilhados para a API da Vexa.ai (bot no Google Meet).
// A Bot Key gerencia os bots. A Transcription Key separada lê transcrições.
export const VEXA_BASE_URL = "https://api.cloud.vexa.ai";
export const VEXA_FAILED_STATUSES = new Set(["failed", "needs_help"]);

export interface VexaBot {
  id: number;
  status?: string;
  platform?: string;
  native_meeting_id?: string;
  start_time?: string | null;
  end_time?: string | null;
}

export interface TranscriptSegment {
  speaker?: string;
  text?: string;
  start?: number;
  end?: number;
}

export interface VexaTranscriptResult {
  ok: boolean;
  status: number;
  segments: TranscriptSegment[];
}

export interface BuiltTranscript {
  transcriptText: string;
  transcriptRaw: Array<
    { speaker: string; text: string; start_ms: number; end_ms: number }
  >;
  durationSeconds: number | null;
}

export function parseMeetingUrl(
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

export async function fetchVexaBots(vexaKey: string): Promise<VexaBot[]> {
  const response = await fetch(`${VEXA_BASE_URL}/bots`, {
    headers: { "X-API-Key": vexaKey },
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => ({}));
  return Array.isArray(payload?.meetings) ? payload.meetings : [];
}

export async function stopVexaBot(
  vexaKey: string,
  platform: string,
  nativeMeetingId: string,
): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(
    `${VEXA_BASE_URL}/bots/${platform}/${nativeMeetingId}`,
    { method: "DELETE", headers: { "X-API-Key": vexaKey } },
  );
  return { ok: response.ok, status: response.status };
}

export async function fetchVexaTranscriptResult(
  transcriptionKey: string,
  platform: string,
  nativeMeetingId: string,
): Promise<VexaTranscriptResult> {
  const response = await fetch(
    `${VEXA_BASE_URL}/transcripts/${platform}/${nativeMeetingId}`,
    { headers: { "X-API-Key": transcriptionKey } },
  );
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    segments: Array.isArray(payload?.segments) ? payload.segments : [],
  };
}

export async function fetchVexaTranscript(
  transcriptionKey: string,
  platform: string,
  nativeMeetingId: string,
): Promise<TranscriptSegment[]> {
  const result = await fetchVexaTranscriptResult(
    transcriptionKey,
    platform,
    nativeMeetingId,
  );
  return result.ok ? result.segments : [];
}

// A conta hospedada usada pelo Norteia devolveu timestamps epoch; versões
// atuais da API também podem devolver segundos relativos à sessão. Aceitamos
// os dois formatos para não distorcer a duração nem os tempos da transcrição.
export function buildTranscript(
  vexaMeeting: VexaBot,
  segments: TranscriptSegment[],
): BuiltTranscript | null {
  const transcriptText = segments.map((segment) => segment.text ?? "")
    .filter(Boolean).join("\n").trim();
  if (!transcriptText) return null;

  const meetingStartMs = vexaMeeting.start_time
    ? Date.parse(vexaMeeting.start_time)
    : NaN;
  const toRelativeMs = (value: number | undefined): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    const valueMs = value * 1_000;
    if (value > 100_000_000) {
      return Number.isNaN(meetingStartMs)
        ? 0
        : Math.max(0, Math.round(valueMs - meetingStartMs));
    }
    return Math.max(0, Math.round(valueMs));
  };
  const transcriptRaw = segments.map((segment) => ({
    speaker: segment.speaker?.trim() || "Participante",
    text: segment.text ?? "",
    start_ms: toRelativeMs(segment.start),
    end_ms: toRelativeMs(segment.end),
  }));

  let durationSeconds: number | null = null;
  if (vexaMeeting.start_time && vexaMeeting.end_time) {
    const duration = Math.round(
      (Date.parse(vexaMeeting.end_time) - Date.parse(vexaMeeting.start_time)) /
        1_000,
    );
    durationSeconds = Number.isFinite(duration) && duration >= 0
      ? duration
      : null;
  } else {
    const maxEndMs = Math.max(
      0,
      ...transcriptRaw.map((segment) => segment.end_ms),
    );
    durationSeconds = maxEndMs > 0 ? Math.round(maxEndMs / 1_000) : null;
  }

  return { transcriptText, transcriptRaw, durationSeconds };
}
