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

    const quote = await askGemini(prompt);
    return jsonResponse({ quote }, 200, headers);
  } catch (error) {
    return errorResponse(error, headers);
  }
});
