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

// Modelo rápido e barato — suficiente para escrever a análise do relatório.
const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

interface ReportBody {
  client_id?: string;
  from?: string; // ISO
  to?: string; // ISO
  // Métricas reais do Instagram já buscadas no frontend (meta-insights).
  // Opcional: se vier, a IA analisa os números reais em vez de só a atividade.
  insights?: unknown;
}

// Chama o Gemini com o prompt e devolve o texto. A chave vem SÓ do env
// (secret GEMINI_API_KEY) — nunca do código nem do frontend.
async function askGemini(prompt: string): Promise<string> {
  const key = requiredEnv("GEMINI_API_KEY");
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(502, "gemini_request_failed");
  }
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new HttpError(502, "gemini_empty_response");
  }
  return text.trim();
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

    // Autenticação: token do usuário logado. O cliente RLS-scoped garante que
    // ele só lê dados da própria organização.
    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new HttpError(401, "unauthorized");
    const supabase = createUserClient(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) throw new HttpError(401, "unauthorized");

    const body = (await request.json().catch(() => ({}))) as ReportBody;
    const clientId = body.client_id;
    if (!clientId) throw new HttpError(400, "missing_client_id");

    // Período: default últimos 30 dias.
    const to = body.to ? new Date(body.to) : new Date();
    const from = body.from
      ? new Date(body.from)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    // Cliente (nome) — RLS garante o acesso.
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, name")
      .eq("id", clientId)
      .single();
    if (clientError || !client) throw new HttpError(404, "client_not_found");

    // Posts do período (por data de publicação).
    const { data: posts } = await supabase
      .from("posts")
      .select("status, content_type, publish_date, plannings!inner(client_id)")
      .eq("plannings.client_id", clientId)
      .gte("publish_date", fromIso.slice(0, 10))
      .lte("publish_date", toIso.slice(0, 10));

    // Publicações efetivadas no Instagram via Norteia (fila).
    const { data: scheduled } = await supabase.rpc("get_scheduled_posts", {
      _from: fromIso,
      _to: toIso,
      _client_id: clientId,
    });

    // Agrega os números que a IA vai analisar (nada de inventar engajamento).
    const list = (posts ?? []) as Array<{ status: string | null; content_type: string | null }>;
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const p of list) {
      byStatus[p.status ?? "sem_status"] = (byStatus[p.status ?? "sem_status"] ?? 0) + 1;
      byType[p.content_type ?? "sem_tipo"] = (byType[p.content_type ?? "sem_tipo"] ?? 0) + 1;
    }
    const published = ((scheduled ?? []) as Array<{ status: string }>).filter(
      (s) => s.status === "published",
    ).length;

    const dados = {
      cliente: client.name,
      periodo: { de: fromIso.slice(0, 10), ate: toIso.slice(0, 10) },
      total_posts_no_periodo: list.length,
      posts_por_status: byStatus,
      posts_por_formato: byType,
      publicados_no_instagram_via_norteia: published,
    };

    // Métricas REAIS do Instagram (se o frontend as enviou via meta-insights).
    const ins = body.insights as {
      profile?: { followers_count?: number; media_count?: number };
      media?: Array<{ caption?: string; like_count?: number; comments_count?: number; media_product_type?: string; media_type?: string }>;
      reach_total?: number | null;
    } | undefined;
    const igMedia = Array.isArray(ins?.media) ? ins!.media! : [];
    const engagement = igMedia.reduce((a, m) => a + (m.like_count ?? 0) + (m.comments_count ?? 0), 0);
    const topPosts = [...igMedia]
      .sort((a, b) => ((b.like_count ?? 0) + (b.comments_count ?? 0)) - ((a.like_count ?? 0) + (a.comments_count ?? 0)))
      .slice(0, 5)
      .map((m) => ({
        legenda: (m.caption ?? "").slice(0, 80),
        curtidas: m.like_count ?? 0,
        comentarios: m.comments_count ?? 0,
        tipo: m.media_product_type ?? m.media_type ?? "post",
      }));
    const metricas = ins
      ? {
        seguidores: ins.profile?.followers_count ?? null,
        total_de_posts_na_conta: ins.profile?.media_count ?? null,
        alcance_no_periodo: ins.reach_total ?? null,
        engajamento_total_dos_posts_recentes: engagement,
        posts_recentes_analisados: igMedia.length,
        posts_com_mais_engajamento: topPosts,
      }
      : null;

    const prompt = [
      "Você é um analista de social media da agência Norteia.",
      "Escreva uma análise de relatório mensal, em português do Brasil, clara, objetiva e",
      "profissional, para o gestor apresentar ao cliente. Use SOMENTE os dados fornecidos —",
      "não invente números.",
      metricas
        ? "Foque nas MÉTRICAS reais do Instagram (seguidores, alcance no período, engajamento e os posts que mais engajaram). Comente destaques, o que funcionou e dê 2 a 3 recomendações práticas."
        : "Foque na atividade de produção (volume, formatos, status do fluxo) e dê 2 a 3 recomendações. NÃO invente engajamento — não está disponível.",
      "Estruture com títulos curtos. Não use tabelas. Tom encorajador, mas honesto.",
      "",
      metricas ? "Métricas reais do Instagram (JSON):" : "",
      metricas ? JSON.stringify(metricas, null, 2) : "",
      "Atividade de produção no Norteia (JSON):",
      JSON.stringify(dados, null, 2),
    ].filter(Boolean).join("\n");

    const analysis = await askGemini(prompt);

    return jsonResponse({ analysis, dados, metricas }, 200, headers);
  } catch (error) {
    return errorResponse(error, headers);
  }
});
