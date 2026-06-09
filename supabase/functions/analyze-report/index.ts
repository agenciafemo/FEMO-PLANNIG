import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Você é um consultor de marketing digital brasileiro especialista em análise de relatórios de performance de redes sociais.

REGRAS:
1. Analise o relatório e destaque os PONTOS POSITIVOS e conquistas de forma clara.
2. Para métricas que caíram ou resultados abaixo do esperado, contextualize de forma construtiva: explique possíveis motivos e sugira oportunidades de melhoria.
3. NUNCA use tom negativo ou alarmista. Sempre mantenha uma visão otimista e profissional.
4. Use linguagem acessível, sem jargões técnicos desnecessários.
5. Organize a análise em seções claras com parágrafos separados por linhas em branco.
6. Finalize com uma conclusão motivacional e próximos passos sugeridos.
7. Escreva em português brasileiro.

FORMATO: Texto corrido organizado em parágrafos. NÃO use JSON. Apenas texto limpo e bem formatado.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pdfUrl } = await req.json();

    if (!pdfUrl) {
      return new Response(JSON.stringify({ error: "pdfUrl é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch PDF content
    let pdfText = "";
    try {
      const pdfResponse = await fetch(pdfUrl);
      if (pdfResponse.ok) {
        const contentType = pdfResponse.headers.get("content-type") || "";
        if (contentType.includes("text")) {
          pdfText = await pdfResponse.text();
        }
      }
    } catch {
      // If we can't fetch the PDF text, we'll send the URL to the model
    }

    const userContent: any[] = [];

    if (pdfText) {
      userContent.push({
        type: "text",
        text: `Analise este relatório de performance de redes sociais e gere um resumo positivo e construtivo:\n\n${pdfText}`,
      });
    } else {
      // Send PDF URL for multimodal analysis
      userContent.push({
        type: "image_url",
        image_url: { url: pdfUrl },
      });
      userContent.push({
        type: "text",
        text: "Analise este relatório/documento de performance de redes sociais e gere um resumo positivo e construtivo destacando conquistas e oportunidades.",
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições atingido. Tente novamente." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "Erro ao analisar relatório" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const aiSummary = data.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ aiSummary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-report error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
