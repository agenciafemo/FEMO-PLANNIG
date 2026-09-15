import { HttpError } from "./http.ts";
import { requiredEnv } from "./supabase.ts";

// Chamada ao Gemini com resposta JSON e troca automática de modelo.
//
// Mesmo desenho do `meeting-summarize` (que continua com a própria cópia para
// não mexer numa função em produção): um alias pode responder 503 em pico mesmo
// com chave e cota válidas, então tenta de novo e depois troca de modelo. Erro
// permanente (400/401/403) encerra na hora — outro modelo não conserta chave.

const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash-lite",
] as const;
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const ATTEMPTS_PER_MODEL = 2;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function askGeminiJson(input: {
  systemInstruction: string;
  userText: string;
  schema: unknown;
  maxOutputTokens: number;
  operation: string;
}): Promise<unknown> {
  const key = requiredEnv("GEMINI_API_KEY");
  let lastStatus = 0;
  for (const [modelIndex, model] of GEMINI_MODELS.entries()) {
    const url = `${GEMINI_BASE_URL}/${model}:generateContent`;
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: input.userText }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: input.maxOutputTokens,
            responseMimeType: "application/json",
            responseSchema: input.schema,
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
        event: "gemini_retry",
        operation: input.operation,
        model,
        attempt,
        status: response.status,
      }));
      if (!RETRYABLE_STATUSES.has(response.status)) {
        throw new HttpError(502, "gemini_request_failed", response.status);
      }
      if (attempt < ATTEMPTS_PER_MODEL) await sleep(600 * attempt);
      else if (modelIndex < GEMINI_MODELS.length - 1) await sleep(300);
    }
  }
  throw new HttpError(502, "gemini_request_failed", lastStatus || undefined);
}
