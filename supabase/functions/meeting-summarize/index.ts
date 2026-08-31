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
import { createAdminClient, createUserClient, requiredEnv } from "../_shared/supabase.ts";
import { timingSafeEqual } from "../_shared/security.ts";

// Não depender de um único alias: o `gemini-flash-latest` pode responder 503
// durante picos mesmo com chave e quota válidas. Os modelos abaixo foram
// escolhidos entre os modelos estáveis com generateContent disponíveis para o
// projeto; a função avança automaticamente quando um deles está indisponível.
const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash-lite",
] as const;
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_TRANSCRIPT_CHARS = 60_000;

interface Body {
  meeting_id?: string;
}

interface ActionItem {
  titulo: string;
  responsavel_sugerido: string;
  prazo_sugerido: string;
}

interface MeetingSummary {
  resumo: string;
  decisoes: string[];
  itens_acao: ActionItem[];
}

const responseSchema = {
  type: "OBJECT",
  properties: {
    resumo: { type: "STRING" },
    decisoes: { type: "ARRAY", items: { type: "STRING" }, maxItems: 20 },
    itens_acao: {
      type: "ARRAY",
      maxItems: 25,
      items: {
        type: "OBJECT",
        properties: {
          titulo: { type: "STRING" },
          responsavel_sugerido: { type: "STRING" },
          prazo_sugerido: { type: "STRING" },
        },
        required: ["titulo", "responsavel_sugerido", "prazo_sugerido"],
      },
    },
  },
  required: ["resumo", "decisoes", "itens_acao"],
};

function isActionItem(value: unknown): value is ActionItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.titulo === "string" &&
    typeof item.responsavel_sugerido === "string" &&
    typeof item.prazo_sugerido === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateSummary(value: unknown): MeetingSummary {
  if (!value || typeof value !== "object") {
    throw new HttpError(502, "gemini_invalid_response");
  }
  const item = value as Record<string, unknown>;
  if (
    typeof item.resumo !== "string" ||
    !isStringArray(item.decisoes) ||
    !Array.isArray(item.itens_acao) ||
    !item.itens_acao.every(isActionItem)
  ) {
    throw new HttpError(502, "gemini_invalid_response");
  }
  return {
    resumo: item.resumo.trim().slice(0, 4_000),
    decisoes: item.decisoes.map((text) => text.trim().slice(0, 500)).filter(
      Boolean,
    ).slice(0, 20),
    itens_acao: item.itens_acao.slice(0, 25).map((entry) => ({
      titulo: entry.titulo.trim().slice(0, 300),
      responsavel_sugerido: entry.responsavel_sugerido.trim().slice(0, 200),
      prazo_sugerido: entry.prazo_sugerido.trim().slice(0, 100),
    })).filter((entry) => entry.titulo.length > 0),
  };
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);
const ATTEMPTS_PER_MODEL = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function askGemini(transcript: string): Promise<unknown> {
  const key = requiredEnv("GEMINI_API_KEY");
  const systemInstruction = [
    "Você gera atas de reunião para agências de social media, a partir da transcrição bruta.",
    "Escreva em português do Brasil, direto e específico. Não invente nada que não esteja na transcrição.",
    "resumo: 2 a 5 frases sobre o que foi tratado e o encaminhamento geral.",
    "decisoes: lista curta de decisões/combinados concretos ditos na reunião. Vazio se não houver nenhuma.",
    "itens_acao: pendências que alguém assumiu fazer. responsavel_sugerido é só o nome citado na fala mais",
    "próxima do compromisso (ex.: quem disse 'eu faço isso') — é uma sugestão, não confirmação; o usuário",
    "revisa o responsável de verdade antes de virar tarefa. prazo_sugerido é o texto literal do prazo citado",
    "(ex.: 'até quarta', 'semana que vem') ou string vazia se não foi mencionado.",
    "A resposta deve obedecer estritamente ao schema JSON solicitado.",
  ].join("\n");

  // Um retry curto absorve oscilações; persistindo 429/5xx, troca de modelo.
  // Erros permanentes (400/401/403) encerram imediatamente, pois outro modelo
  // não corrige chave, restrição ou payload inválido.
  let lastStatus = 0;
  for (const [modelIndex, model] of GEMINI_MODELS.entries()) {
    const url = `${GEMINI_BASE_URL}/${model}:generateContent`;
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{
            role: "user",
            parts: [{ text: `TRANSCRIÇÃO DA REUNIÃO:\n${transcript}` }],
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4_000,
            responseMimeType: "application/json",
            responseSchema,
          },
        }),
      });
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text !== "string" || !text.trim()) {
          throw new HttpError(502, "gemini_empty_response");
        }
        try {
          return JSON.parse(text);
        } catch {
          throw new HttpError(502, "gemini_invalid_json");
        }
      }

      lastStatus = response.status;
      console.warn(JSON.stringify({
        event: "meeting_summary_gemini_retry",
        model,
        attempt,
        status: response.status,
      }));

      if (!RETRYABLE_STATUSES.has(response.status)) {
        throw new HttpError(502, "gemini_request_failed", response.status);
      }
      const hasAnotherAttempt = attempt < ATTEMPTS_PER_MODEL;
      const hasAnotherModel = modelIndex < GEMINI_MODELS.length - 1;
      if (hasAnotherAttempt) {
        await sleep(600 * attempt);
      } else if (hasAnotherModel) {
        await sleep(300);
      }
    }
  }
  throw new HttpError(502, "gemini_request_failed", lastStatus || undefined);
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  // deno-lint-ignore no-explicit-any
  let supabase: any = null;
  let meetingId: string | undefined;

  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    assertAllowedOrigin(request);
    if (request.method !== "POST") {
      return methodNotAllowed(headers, ["POST", "OPTIONS"]);
    }

    // Duas formas de chamar esta function: (a) usuário logado no app (Bearer
    // token, RLS aplicado, valida papel na organização); (b) chamada interna
    // do sistema (meeting-transcribe encadeando, ou o poll do bot Vexa.ai),
    // autenticada por um segredo compartilhado — usa admin client e pula a
    // checagem de papel porque não há usuário humano na requisição.
    const internalSecret = (request.headers.get("X-Internal-Secret") ?? "")
      .trim();
    const isInternalCall = internalSecret.length > 0 &&
      timingSafeEqual(internalSecret, requiredEnv("MEETINGS_INTERNAL_SECRET"));

    let userId: string | null = null;
    if (isInternalCall) {
      supabase = createAdminClient();
    } else {
      const token = (request.headers.get("Authorization") ?? "").replace(
        /^Bearer\s+/i,
        "",
      ).trim();
      if (!token) throw new HttpError(401, "unauthorized");
      supabase = createUserClient(token);
      const { data: userData, error: userError } = await supabase.auth
        .getUser();
      if (userError || !userData?.user) throw new HttpError(401, "unauthorized");
      userId = userData.user.id;
    }

    const body = await readJson<Body>(request);
    meetingId = body.meeting_id;
    if (typeof meetingId !== "string" || !meetingId.trim()) {
      throw new HttpError(400, "missing_meeting_id");
    }

    const meetingResult = await supabase.from("meetings").select(
      "id, organization_id, created_by, title, transcript_text",
    ).eq("id", meetingId).single();
    if (meetingResult.error || !meetingResult.data) {
      throw new HttpError(404, "meeting_not_found");
    }
    const meeting = meetingResult.data;
    const organizationId = meeting.organization_id as string;

    if (!isInternalCall) {
      const membershipResult = await supabase.from("organization_members")
        .select("role").eq("organization_id", organizationId).eq(
          "user_id",
          userId,
        ).eq("status", "active").maybeSingle();
      if (
        membershipResult.error || !membershipResult.data ||
        !["owner", "admin", "manager", "editor"].includes(
          membershipResult.data.role,
        )
      ) {
        throw new HttpError(403, "meeting_summarize_forbidden");
      }
    }

    const transcript = (meeting.transcript_text as string | null)?.trim();
    if (!transcript) {
      throw new HttpError(409, "missing_transcript");
    }

    await supabase.from("meetings").update({ status: "summarizing" }).eq(
      "id",
      meetingId,
    );

    const raw = await askGemini(transcript.slice(0, MAX_TRANSCRIPT_CHARS));
    const summary = validateSummary(raw);

    // Preserva o que ja virou tarefa. Antes a ata so podia ser gerada uma vez,
    // entao apagar tudo era inofensivo; agora que da para gerar de novo, um
    // delete cego destruiria o item que alguem ja converteu — a tarefa em si
    // sobreviveria (task_id e ON DELETE SET NULL na direcao oposta), mas o
    // vinculo com a reuniao sumiria em silencio.
    await supabase.from("meeting_action_items").delete()
      .eq("meeting_id", meetingId)
      .is("task_id", null);

    const preservados = await supabase.from("meeting_action_items")
      .select("id", { count: "exact", head: true })
      .eq("meeting_id", meetingId);
    const deslocamento = preservados.count ?? 0;

    if (summary.itens_acao.length > 0) {
      const rows = summary.itens_acao.map((item, index) => ({
        meeting_id: meetingId,
        title: item.titulo,
        // Os preservados ficam no topo; os novos entram depois deles.
        position: deslocamento + index,
      }));
      const insertResult = await supabase.from("meeting_action_items").insert(
        rows,
      );
      if (insertResult.error) throw new HttpError(502, "action_items_save_failed");
    }

    const { error: updateError } = await supabase.from("meetings").update({
      summary: summary.resumo,
      decisions: summary.decisoes,
      status: "ready",
      failure_reason: null,
    }).eq("id", meetingId);
    if (updateError) throw new HttpError(502, "meeting_save_failed");

    if (meeting.created_by) {
      await supabase.from("notifications").insert({
        organization_id: organizationId,
        user_id: meeting.created_by,
        title: `📝 Ata pronta: ${meeting.title}`,
        body: `${summary.itens_acao.length} item(ns) de ação identificados.`,
        type: "meeting_ready",
        read: false,
      }).then(() => {}, () => {});
    }

    return jsonResponse({ ok: true, summary }, 200, headers);
  } catch (error) {
    // 4xx (401/403/404/409/400) acontecem antes de qualquer geração de ata
    // ter começado — não há nada "em andamento" para marcar como falha, e
    // marcar mudaria o status da reunião pra todo mundo da organização só
    // porque UM chamador não tinha permissão (ou chamou cedo demais, sem
    // transcrição pronta). Só 5xx / erro inesperado é falha real de geração.
    const isHttpError = error instanceof HttpError;
    const isProcessingFailure = !isHttpError || error.status >= 500;
    if (supabase && meetingId && isProcessingFailure) {
      const reasonCode = isHttpError ? error.reasonCode : "internal_error";
      // Volta para 'transcribed', NAO para 'failed': a transcricao continua
      // salva e integra, e so a ata — que e derivada dela — nao saiu. Marcar
      // 'failed' aqui descartaria o trabalho que deu certo e tiraria da tela o
      // botao que permite tentar de novo. O motivo fica em failure_reason para
      // a tela mostrar, mesmo com a reuniao num estado saudavel.
      await supabase.from("meetings").update({
        status: "transcribed",
        failure_reason: reasonCode,
      }).eq("id", meetingId).then(() => {}, () => {});
      const meetingResult = await supabase.from("meetings").select(
        "organization_id, created_by, title",
      ).eq("id", meetingId).maybeSingle().then((r: { data: unknown }) => r, () => ({
        data: null,
      }));
      const meeting = meetingResult?.data as
        | { organization_id: string; created_by: string; title: string }
        | null;
      if (meeting?.created_by) {
        await supabase.from("notifications").insert({
          organization_id: meeting.organization_id,
          user_id: meeting.created_by,
          title: `⚠️ Não consegui gerar a ata: ${meeting.title}`,
          body: "Tente novamente em alguns minutos.",
          type: "meeting_failed",
          read: false,
        }).then(() => {}, () => {});
      }
    }
    return errorResponse(error, headers);
  }
});
