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
import { createUserClient, requiredEnv } from "../_shared/supabase.ts";

// Frase do dia para o Dashboard — uma reflexão curta para a equipe da agência.
// Gerada pelo Gemini (chave só no secret GEMINI_API_KEY). O frontend guarda a
// frase por dia (localStorage), então isto roda no máximo 1x por dia por pessoa.
//
// O Gemini às vezes devolve 503 ("modelo com alta demanda") — é transitório.
// Por isso tentamos com retry + fallback de modelo antes de desistir.
const GEMINI_MODELS = ["gemini-flash-latest", "gemini-2.0-flash", "gemini-1.5-flash"];
const RETRYABLE = new Set([429, 500, 502, 503]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callGemini(model: string, key: string, prompt: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.1, maxOutputTokens: 120 },
      }),
    },
  );
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function askGemini(prompt: string): Promise<string> {
  const key = requiredEnv("GEMINI_API_KEY");
  let lastStatus = 0;
  // 3 tentativas; a cada tentativa troca de modelo (fallback) e espera mais.
  for (let attempt = 0; attempt < GEMINI_MODELS.length; attempt++) {
    const model = GEMINI_MODELS[attempt];
    const res = await callGemini(model, key, prompt);
    if (res.ok) {
      const text = res.json?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text === "string" && text.trim()) {
        return text.trim().replace(/^["“”']+|["“”']+$/g, "");
      }
    }
    lastStatus = res.status;
    console.error("daily_quote_gemini_error", model, res.status, JSON.stringify(res.json).slice(0, 300));
    // Se não for um erro transitório, não adianta insistir.
    if (res.ok || !RETRYABLE.has(res.status)) break;
    await sleep(600 * (attempt + 1));
  }
  throw new HttpError(502, `gemini_${lastStatus || "empty"}`);
}

// Frases de reserva (curadas) — usadas quando o Gemini está indisponível, para
// o card SEMPRE aparecer. Rotacionam por dia do ano.
const FALLBACK_QUOTES = [
  "Consistência não é fazer muito num dia; é não sumir nos outros.",
  "Marca forte é a soma de pequenos cuidados repetidos com paciência.",
  "Antes de criar mais, entenda melhor para quem você está criando.",
  "O cliente não compra o post; compra a confiança que ele transmite.",
  "Criatividade gosta de prazo, mas floresce com clareza de objetivo.",
  "Um bom conteúdo responde uma dúvida real antes de pedir atenção.",
  "Estratégia é decidir o que NÃO fazer para o essencial brilhar.",
  "Feito com atenção hoje evita retrabalho apressado amanhã.",
  "A melhor ideia perde valor se a execução não for cuidadosa.",
  "Escute o cliente com a mesma energia com que você fala com ele.",
  "Constância vence talento quando o talento não aparece todo dia.",
  "Cada entrega é uma amostra de como a agência trata quem confia nela.",
  "Simplicidade é o resultado de muito trabalho, não de pressa.",
  "Dados mostram o caminho; sensibilidade mostra o tom certo de andar nele.",
  "Reputação se constrói no detalhe que ninguém pediu, mas todo mundo nota.",
];

function fallbackQuote(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0).getTime();
  const dayOfYear = Math.floor((now.getTime() - start) / 86_400_000);
  return FALLBACK_QUOTES[dayOfYear % FALLBACK_QUOTES.length];
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

    // Só para usuário logado.
    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new HttpError(401, "unauthorized");
    const supabase = createUserClient(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) throw new HttpError(401, "unauthorized");

    const hoje = new Date().toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    });

    const prompt = [
      "Você escreve a 'frase do dia' para o painel de uma agência de social media (a Norteia, da Agência Femo).",
      "Gere UMA frase curta (no máximo 22 palavras), original e reflexiva, para a equipe começar o dia.",
      "Tema: criatividade, consistência, cuidado com o cliente, construção de marca, foco ou constância — algo do dia a dia de uma agência.",
      "Tom: inspirador, humano e direto. EVITE clichês batidos e frases de autoajuda genéricas. Nada de emojis.",
      `Hoje é ${hoje} — pode variar o ângulo conforme o dia, mas NÃO cite a data na frase.`,
      "Responda SOMENTE com a frase, sem aspas, sem autor, sem introdução.",
    ].join("\n");

    // Se o Gemini falhar (ex.: 503 alta demanda), cai na lista curada — o card
    // sempre aparece. "source" só para diagnóstico.
    let quote: string;
    let source = "ia";
    try {
      quote = await askGemini(prompt);
    } catch (e) {
      console.error("daily_quote_fallback", (e as Error)?.message);
      quote = fallbackQuote();
      source = "curada";
    }
    return jsonResponse({ quote, source }, 200, headers);
  } catch (error) {
    return errorResponse(error, headers);
  }
});
