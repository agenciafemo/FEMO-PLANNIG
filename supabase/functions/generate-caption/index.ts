import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL_MAP: Record<string, string> = {
  gemini: "google/gemini-2.5-flash",
  gpt: "openai/gpt-5-mini",
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
{
  "caption": "texto da legenda aqui",
  "hashtags": "#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5"
}

As 5 hashtags devem ser relevantes para SEO no Google e Instagram, relacionadas ao conteúdo e ao nicho do cliente.`;

const CHAT_SYSTEM_PROMPT = `Você é um social media manager brasileiro especialista. O usuário está refinando uma legenda de Instagram com você.

REGRAS:
1. Seja sério, preciso e profissional. Baseie-se em fatos e informações confiáveis.
2. NUNCA invente dados ou estatísticas.
3. NUNCA use clichês de IA (jornada, descubra como, você sabia que, travessões, excesso de emojis).
4. Responda SEMPRE com JSON válido: {"caption": "...", "hashtags": "#... #... #... #... #..."}
5. Quando o usuário pedir mudanças, aplique sobre a versão anterior mantendo a essência.
6. Máximo 2-3 emojis por legenda. Parágrafos separados por linhas em branco.
7. 5 hashtags relevantes para SEO.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { contentType, clientNotes, model, currentCaption, imageUrl, videoUrl, topicBrief, messages } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const selectedModel = MODEL_MAP[model] || MODEL_MAP.gemini;

    let apiMessages: any[];

    if (messages && Array.isArray(messages) && messages.length > 0) {
      // Conversational mode: use chat history
      let contextInfo = `Contexto: post tipo "${contentType === "static" ? "arte estática" : contentType === "reels" ? "reels/vídeo" : contentType === "carousel" ? "carrossel" : contentType === "blog" ? "blog" : "story"}".`;
      if (topicBrief) contextInfo += ` Tema: ${topicBrief}.`;
      if (clientNotes) contextInfo += ` Notas do cliente: ${clientNotes}.`;
      if (currentCaption) contextInfo += ` Legenda atual: "${currentCaption}".`;

      apiMessages = [
        { role: "system", content: CHAT_SYSTEM_PROMPT + "\n\n" + contextInfo },
        ...messages.map((m: any) => ({ role: m.role, content: m.content })),
      ];
    } else {
      // Single-shot mode
      let textPrompt = `Crie uma legenda para um post de Instagram do tipo "${contentType === "static" ? "arte estática" : contentType === "reels" ? "reels/vídeo" : contentType === "carousel" ? "carrossel" : contentType === "blog" ? "blog" : "story"}".`;

      if (topicBrief) textPrompt += `\n\nTEMA/BRIEFING DO POST (use como base principal): ${topicBrief}`;
      if (clientNotes) textPrompt += `\n\nInformações sobre o cliente/marca: ${clientNotes}`;
      if (videoUrl) textPrompt += `\n\nEste post tem um vídeo associado: ${videoUrl}. Considere que é um conteúdo em vídeo ao criar a legenda.`;
      if (currentCaption) textPrompt += `\n\nA legenda atual é: "${currentCaption}". Melhore ela mantendo a essência mas tornando mais envolvente.`;
      else textPrompt += `\n\nCrie uma legenda original e criativa.`;
      if (imageUrl) textPrompt += `\n\nAnalise a imagem fornecida e crie a legenda baseada no que você vê nela.`;

      const userContent: any[] = [];
      if (imageUrl) userContent.push({ type: "image_url", image_url: { url: imageUrl } });
      userContent.push({ type: "text", text: textPrompt });

      apiMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ];
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: apiMessages,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições atingido. Tente novamente em alguns segundos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA esgotados. Adicione créditos em Configurações > Workspace > Uso." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "Erro ao gerar legenda" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || "";

    let caption = "";
    let hashtags = "";

    try {
      const cleaned = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      caption = parsed.caption || "";
      hashtags = parsed.hashtags || "";
    } catch {
      caption = rawContent;
      hashtags = "";
    }

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
