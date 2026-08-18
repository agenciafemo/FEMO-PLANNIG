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
const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function askGemini(prompt: string): Promise<string> {
  const key = requiredEnv("GEMINI_API_KEY");
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 1.1, maxOutputTokens: 120 },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("daily_quote_gemini_error", res.status, JSON.stringify(json).slice(0, 500));
    throw new HttpError(502, `gemini_${res.status}`);
  }
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new HttpError(502, "gemini_empty_response");
  }
  return text.trim().replace(/^["“”']+|["“”']+$/g, "");
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
