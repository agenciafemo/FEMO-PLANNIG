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
import { createUserClient } from "../_shared/supabase.ts";

// Geração de ARTE com IA (Fase 3b). Reusa o padrão de chamada Gemini que já
// funciona no projeto (generateContent + X-goog-api-key), mas com um modelo de
// IMAGEM e lendo a imagem de candidates[].content.parts[].inlineData.
//
// O modelo fica em env (GEMINI_IMAGE_MODEL) para ajuste sem redeploy caso o
// nome mude. Referências de design do cliente entram como inlineData (o modelo
// é multimodal) para a arte seguir o estilo da marca.
const IMAGE_MODEL = Deno.env.get("GEMINI_IMAGE_MODEL") ?? "gemini-2.5-flash-image";
const IMAGE_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`;
const BUCKET = "content-design-refs";
const MAX_REFS = 3;

const ASPECTS: Record<string, string> = {
  "1:1": "quadrado (1:1)",
  "4:5": "retrato de feed (4:5)",
  "9:16": "story vertical (9:16)",
  "16:9": "paisagem (16:9)",
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(500, `missing_${name.toLowerCase()}`);
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface GenerateImageBody {
  client_id?: string;
  prompt?: string;
  aspect_ratio?: string;
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

    const token = (request.headers.get("Authorization") ?? "")
      .replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new HttpError(401, "unauthorized");
    const supabase = createUserClient(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) throw new HttpError(401, "unauthorized");

    const body = await readJson<GenerateImageBody>(request);
    const clientId = (body.client_id ?? "").trim();
    const userPrompt = (body.prompt ?? "").trim().slice(0, 4000);
    if (!clientId) throw new HttpError(400, "missing_client_id");
    if (!userPrompt) throw new HttpError(400, "missing_prompt");
    const aspectKey = ASPECTS[body.aspect_ratio ?? ""] ? body.aspect_ratio! : "1:1";

    // Cliente + org (RLS garante acesso só à própria org).
    const { data: client, error: clientError } = await supabase
      .from("clients").select("id, name, organization_id").eq("id", clientId)
      .single();
    if (clientError || !client) throw new HttpError(404, "client_not_found");
    const organizationId = (client as { organization_id: string }).organization_id;

    // Referências de design + perfil (estilo da marca).
    const [refsResult, profileResult] = await Promise.all([
      supabase.from("client_design_references")
        .select("image_url, description")
        .eq("organization_id", organizationId).eq("client_id", clientId)
        .order("created_at", { ascending: false }).limit(MAX_REFS),
      supabase.from("client_content_profiles")
        .select("brand_summary, segment, voice_personality")
        .eq("organization_id", organizationId).eq("client_id", clientId)
        .maybeSingle(),
    ]);
    const refs = (refsResult.data ?? []) as Array<{ image_url: string; description: string | null }>;
    const profile = (profileResult.data ?? null) as
      | { brand_summary: string | null; segment: string | null; voice_personality: string | null }
      | null;

    const styleNotes = refs.map((r) => r.description).filter(Boolean).join("; ");
    const promptText = [
      "Gere uma ARTE para publicação no Instagram, alta qualidade, pronta para publicar.",
      `Formato: ${ASPECTS[aspectKey]}.`,
      profile?.brand_summary ? `Marca: ${profile.brand_summary}` : "",
      profile?.segment ? `Segmento do cliente: ${profile.segment}` : "",
      refs.length > 0
        ? `Siga o ESTILO VISUAL das imagens de referência anexadas${styleNotes ? ` (${styleNotes})` : ""}.`
        : "",
      `Direção da arte: ${userPrompt}`,
    ].filter(Boolean).join("\n");

    // deno-lint-ignore no-explicit-any
    const parts: any[] = [{ text: promptText }];
    // Anexa até MAX_REFS imagens de referência como inlineData (base64).
    for (const ref of refs) {
      try {
        const imgResp = await fetch(ref.image_url);
        if (!imgResp.ok) continue;
        const bytes = new Uint8Array(await imgResp.arrayBuffer());
        const mime = imgResp.headers.get("content-type") ?? "image/png";
        parts.push({ inlineData: { mimeType: mime, data: bytesToBase64(bytes) } });
      } catch {
        // ignora referência que falhar ao baixar
      }
    }

    const geminiResp = await fetch(IMAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": requiredEnv("GEMINI_API_KEY"),
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    });
    const payload = await geminiResp.json().catch(() => ({}));
    if (!geminiResp.ok) {
      throw new HttpError(502, "gemini_image_failed", geminiResp.status);
    }
    // deno-lint-ignore no-explicit-any
    const outParts: any[] = payload?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = outParts.find((p) => p?.inlineData?.data);
    const imageB64: string | undefined = imagePart?.inlineData?.data;
    const imageMime: string = imagePart?.inlineData?.mimeType ?? "image/png";
    if (!imageB64) throw new HttpError(502, "gemini_no_image");

    // Upload no Storage (mesmo bucket das referências, subpasta generated).
    const ext = imageMime.includes("jpeg")
      ? "jpg"
      : imageMime.includes("webp")
      ? "webp"
      : "png";
    const path = `${organizationId}/${clientId}/generated/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, base64ToBytes(imageB64), {
        contentType: imageMime,
        upsert: false,
      });
    if (uploadError) throw new HttpError(502, "image_upload_failed");
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

    return jsonResponse({ image_url: pub.publicUrl }, 200, headers);
  } catch (error) {
    return errorResponse(error, headers);
  }
});
