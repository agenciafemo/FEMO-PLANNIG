import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encodeBase64 } from "https://deno.land/std@0.182.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Você é um social media manager brasileiro especialista em criar legendas para Instagram.

REGRAS OBRIGATÓRIAS:
1. Seja sério, preciso e profissional. Baseie-se em fatos e informações confiáveis.
2. Use linguagem profissional mas acessível. Escreva com autoridade e clareza.
3. NUNCA invente dados, estatísticas ou informações. Se não tem certeza, não afirme.
4. NUNCA use estas palavras/padrões clichês de IA:
   - "jornada"
   - "não é sobre X, é sobre Y"
   - "cada etapa"
   - "descubra como"
   - "você sabia que"
   - "neste post"
   - "confira"
   - travessões (—)
   - excesso de emojis (máximo 2-3 por legenda)
5. Separe os parágrafos com linhas em branco para facilitar a leitura.
6. Seja direto e autêntico. A legenda deve soar humana, não robótica.
7. Adapte o tom de acordo com as observações do cliente quando fornecidas.
8. Se uma imagem for fornecida, analise o conteúdo visual e use como base para criar a legenda.

FORMATO DE RESPOSTA:
Responda APENAS com um JSON válido no seguinte formato (sem markdown, sem code blocks):
{"caption": "texto da legenda aqui", "hashtags": "#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5"}

As 5 hashtags devem ser relevantes para SEO no Google e Instagram, relacionadas ao conteúdo e ao nicho do cliente.`;

const CHAT_SYSTEM_PROMPT = `Você é um social media manager brasileiro especialista. O usuário está refinando uma legenda de Instagram com você.

REGRAS:
1. Seja sério, preciso e profissional.
2. NUNCA invente dados ou estatísticas.
3. NUNCA use clichês de IA (jornada, descubra como, você sabia que, travessões, excesso de emojis).
4. Responda SEMPRE com JSON válido: {"caption": "...", "hashtags": "#... #... #... #... #..."}
5. Quando o usuário pedir mudanças, aplique sobre a versão anterior mantendo a essência.
6. Máximo 2-3 emojis por legenda. Parágrafos separados por linhas em branco.
7. 5 hashtags relevantes para SEO.`;

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const mimeType = contentType.split(";")[0];
    const buffer = await res.arrayBuffer();
    const base64 = encodeBase64(new Uint8Array(buffer));
    return { data: base64, mimeType };
  } catch {
    return null;
  }
}

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  imageUrl?: string
): Promise<string> {
  const contents: any[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const isLastUser = msg.role === "user" && i === messages.length - 1;
    const parts: any[] = [];

    if (isLastUser && imageUrl) {
      const img = await fetchImageAsBase64(imageUrl);
      if (img) parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
    }
    parts.push({ text: msg.content });

    contents.push({ role: msg.role === "assistant" ? "model" : "user", parts });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function callOpenAI(
  apiKey: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  imageUrl?: string
): Promise<string> {
  const apiMessages: any[] = [{ role: "system", content: systemPrompt }];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const isLastUser = msg.role === "user" && i === messages.length - 1;

    if (isLastUser && imageUrl) {
      apiMessages.push({
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: msg.content },
        ],
      });
    } else {
      apiMessages.push({ role: msg.role, content: msg.content });
    }
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: apiMessages, max_tokens: 1024 }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function parseJsonResponse(raw: string): { caption: string; hashtags: string } {
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return { caption: parsed.caption || "", hashtags: parsed.hashtags || "" };
  } catch {
    return { caption: raw, hashtags: "" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { contentType, clientNotes, model, currentCaption, imageUrl, videoUrl, topicBrief, messages } =
      await req.json();

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    const useGemini = model !== "gpt";

    if (useGemini && !GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY não configurada. Adicione-a nas variáveis de ambiente do Supabase." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!useGemini && !OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY não configurada. Adicione-a nas variáveis de ambiente do Supabase." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const typeLabel =
      contentType === "static" ? "arte estática"
      : contentType === "reels" ? "reels/vídeo"
      : contentType === "carousel" ? "carrossel"
      : contentType === "blog" ? "blog"
      : "story";

    let apiMessages: { role: string; content: string }[];
    let systemPrompt: string;

    if (messages && Array.isArray(messages) && messages.length > 0) {
      systemPrompt = CHAT_SYSTEM_PROMPT;
      let ctx = `Contexto: post tipo "${typeLabel}".`;
      if (topicBrief) ctx += ` Tema: ${topicBrief}.`;
      if (clientNotes) ctx += ` Notas do cliente: ${clientNotes}.`;
      if (currentCaption) ctx += ` Legenda atual: "${currentCaption}".`;
      systemPrompt += "\n\n" + ctx;
      apiMessages = messages;
    } else {
      systemPrompt = SYSTEM_PROMPT;
      let prompt = `Crie uma legenda para um post de Instagram do tipo "${typeLabel}".`;
      if (topicBrief) prompt += `\n\nTEMA/BRIEFING: ${topicBrief}`;
      if (clientNotes) prompt += `\n\nInformações sobre o cliente/marca: ${clientNotes}`;
      if (videoUrl) prompt += `\n\nEste post tem um vídeo: ${videoUrl}. Considere que é um conteúdo em vídeo.`;
      if (currentCaption) prompt += `\n\nLegenda atual (melhore mantendo a essência): "${currentCaption}"`;
      else prompt += "\n\nCrie uma legenda original.";
      if (imageUrl) prompt += "\n\nAnálise a imagem fornecida e crie a legenda baseada no que você vê nela.";
      apiMessages = [{ role: "user", content: prompt }];
    }

    let raw: string;
    if (useGemini) {
      raw = await callGemini(GEMINI_API_KEY!, systemPrompt, apiMessages, imageUrl || undefined);
    } else {
      raw = await callOpenAI(OPENAI_API_KEY!, systemPrompt, apiMessages, imageUrl || undefined);
    }

    const { caption, hashtags } = parseJsonResponse(raw);

    return new Response(JSON.stringify({ caption, hashtags }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-caption error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
