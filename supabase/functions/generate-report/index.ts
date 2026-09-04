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

// Modelos (com fallback): o Gemini às vezes devolve 503 "modelo com alta
// demanda" — transitório. Tentamos o próximo modelo com espera crescente.
const GEMINI_MODELS = ["gemini-flash-latest", "gemini-2.0-flash", "gemini-1.5-flash"];
const RETRYABLE = new Set([429, 500, 502, 503]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ReportBody {
  client_id?: string;
  from?: string; // ISO
  to?: string; // ISO
  // Métricas reais do Instagram já buscadas no frontend (meta-insights).
  // Opcional: se vier, a IA analisa os números reais em vez de só a atividade.
  insights?: unknown;
  // Métricas normalizadas do Perfil da Empresa no Google, já obtidas pela
  // Edge Function autenticada google-business-insights.
  google_business?: unknown;
}

// Chama o Gemini com o prompt e devolve o texto. A chave vem SÓ do env
// (secret GEMINI_API_KEY). Tenta modelos em sequência com retry para o 503
// "modelo com alta demanda" (transitório) — assim o relatório não falha à toa.
async function askGemini(prompt: string): Promise<string> {
  const key = requiredEnv("GEMINI_API_KEY");
  let lastStatus = 0;
  for (let attempt = 0; attempt < GEMINI_MODELS.length; attempt++) {
    const model = GEMINI_MODELS[attempt];
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": key },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text === "string" && text.trim()) return text.trim();
    }
    lastStatus = res.status;
    console.error("gemini_error", model, res.status, JSON.stringify(json).slice(0, 500));
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

    // Cliente (nome + org) — RLS garante o acesso.
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, name, organization_id")
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

    const googleInput = body.google_business as {
      location?: { location_title?: string };
      insights?: {
        totals?: {
          search_impressions?: number;
          maps_impressions?: number;
          total_impressions?: number;
          calls?: number;
          directions?: number;
          website_clicks?: number;
          total_actions?: number;
        };
      };
    } | undefined;
    const googleTotals = googleInput?.insights?.totals;
    const metricasGoogle = googleTotals
      ? {
        unidade: googleInput?.location?.location_title ?? "Unidade vinculada",
        visualizacoes_na_busca: Number(googleTotals.search_impressions ?? 0),
        visualizacoes_no_maps: Number(googleTotals.maps_impressions ?? 0),
        visualizacoes_totais: Number(googleTotals.total_impressions ?? 0),
        ligacoes: Number(googleTotals.calls ?? 0),
        rotas_solicitadas: Number(googleTotals.directions ?? 0),
        cliques_no_site: Number(googleTotals.website_clicks ?? 0),
        acoes_totais: Number(googleTotals.total_actions ?? 0),
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
      metricasGoogle
        ? "Inclua uma seção curta sobre presença local no Google. Diferencie visualizações na Busca e no Maps de ações de intenção (ligações, rotas e cliques no site). Não trate esses dados orgânicos como tráfego pago e não invente conversões."
        : "Não mencione métricas do Perfil da Empresa no Google, pois elas não foram fornecidas.",
      "Estruture com títulos curtos. Não use tabelas. Tom encorajador, mas honesto.",
      "",
      metricas ? "Métricas reais do Instagram (JSON):" : "",
      metricas ? JSON.stringify(metricas, null, 2) : "",
      metricasGoogle ? "Métricas reais do Perfil da Empresa no Google (JSON):" : "",
      metricasGoogle ? JSON.stringify(metricasGoogle, null, 2) : "",
      "Atividade de produção no Norteia (JSON):",
      JSON.stringify(dados, null, 2),
    ].filter(Boolean).join("\n");

    const analysis = await askGemini(prompt);

    // Persiste no historico do cliente (best-effort: se falhar, nao quebra a
    // geracao — o relatorio ainda e retornado normalmente).
    const clientOrg = (client as { organization_id?: string }).organization_id;
    if (clientOrg) {
      try {
        // deno-lint-ignore no-explicit-any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: histError } = await (supabase as any)
          .from("client_report_history")
          .insert({
            organization_id: clientOrg,
            client_id: clientId,
            period_from: dados.periodo.de,
            period_to: dados.periodo.ate,
            analysis,
            dados,
            // Mantém as chaves históricas do Instagram no nível raiz para não
            // quebrar relatórios antigos e acrescenta o Google como seção.
            metricas: metricas || metricasGoogle
              ? { ...(metricas ?? {}), google_business: metricasGoogle }
              : null,
            created_by: userData.user.id,
          });
        // Nao derruba a geracao: se a tabela nao existir ou o RLS barrar, o
        // relatorio ainda e devolvido. So registra nos logs para diagnostico.
        if (histError) console.error("report_history_insert_failed", histError.message);
      } catch (e) {
        console.error("report_history_insert_threw", (e as Error)?.message);
      }
    }

    return jsonResponse(
      { analysis, dados, metricas, metricas_google: googleTotals ?? null },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
});
