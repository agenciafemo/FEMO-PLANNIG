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
import {
  createAdminClient,
  createUserClient,
  requiredEnv,
} from "../_shared/supabase.ts";
import { metaGraphApiVersion } from "../_shared/meta-client.ts";
import {
  insightsFailure,
  insightsRoute,
  requireReadableProfile,
} from "../_shared/meta-insights.ts";

// appsecret_proof (HMAC-SHA256 do token com o App Secret) — exigido nas chamadas.
async function appSecretProof(
  token: string,
  appSecret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface Body {
  client_id?: string;
  from?: string; // ISO
  to?: string; // ISO
  compare_from?: string; // ISO — período anterior para comparação (opcional)
  compare_to?: string; // ISO
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

    // 1) Autenticação do usuário + verificação de acesso ao cliente (via RLS).
    const token = (request.headers.get("Authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    ).trim();
    if (!token) throw new HttpError(401, "unauthorized");
    const userClient = createUserClient(token);
    const { data: userData, error: userError } = await userClient.auth
      .getUser();
    if (userError || !userData?.user) throw new HttpError(401, "unauthorized");

    const body = (await request.json().catch(() => ({}))) as Body;
    const clientId = body.client_id;
    if (!clientId) throw new HttpError(400, "missing_client_id");

    const { data: client, error: clientError } = await userClient
      .from("clients")
      .select("id, name")
      .eq("id", clientId)
      .single();
    if (clientError || !client) throw new HttpError(404, "client_not_found");

    // 2) Conexão + conta do Instagram + token (admin; já validamos o acesso acima).
    const admin = createAdminClient();
    const { data: conn, error: connectionError } = await admin
      .from("meta_connections")
      .select("id, provider")
      .eq("client_id", clientId)
      .eq("status", "active")
      .maybeSingle();
    if (connectionError) {
      throw new HttpError(500, "meta_connection_lookup_failed");
    }
    if (!conn?.id) {
      throw new HttpError(
        409,
        "no_active_connection",
        undefined,
        "Este cliente não tem uma conexão Meta ativa. Conecte a conta no perfil do cliente.",
      );
    }

    const { data: channel } = await admin
      .from("meta_connection_channels")
      .select("external_account_id")
      .eq("connection_id", conn.id)
      .eq("channel_type", "instagram")
      .eq("status", "active")
      .maybeSingle();
    const igId = channel?.external_account_id;
    if (!igId) throw new HttpError(409, "no_instagram_account");

    const { data: igToken, error: tokenError } = await admin.rpc(
      "meta_server_get_connection_token",
      { _connection_id: conn.id },
    );
    if (tokenError || typeof igToken !== "string" || !igToken) {
      throw new HttpError(409, "connection_token_unavailable");
    }

    // 3) Chamadas à Graph API.
    const route = insightsRoute(conn.provider);
    const base = `${route.host}/${metaGraphApiVersion()}`;
    const proof = await appSecretProof(igToken, requiredEnv(route.secretName));
    const auth = { Authorization: `Bearer ${igToken}` };

    const to = body.to ? new Date(body.to) : new Date();
    const from = body.from
      ? new Date(body.from)
      : new Date(to.getTime() - 30 * 864e5);
    if (
      !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) ||
      from > to
    ) {
      throw new HttpError(
        400,
        "meta_period_invalid",
        undefined,
        "Selecione um período válido para o relatório.",
      );
    }
    const since = Math.floor(from.getTime() / 1000);
    const until = Math.floor(to.getTime() / 1000);
    const hasCompare = !!(body.compare_from && body.compare_to);
    const compareSince = hasCompare
      ? Math.floor(new Date(body.compare_from!).getTime() / 1000)
      : 0;
    const compareUntil = hasCompare
      ? Math.floor(new Date(body.compare_to!).getTime() / 1000)
      : 0;
    if (
      hasCompare &&
      (!Number.isFinite(compareSince) || !Number.isFinite(compareUntil) ||
        compareSince > compareUntil)
    ) {
      throw new HttpError(
        400,
        "meta_period_invalid",
        undefined,
        "Selecione um período de comparação válido.",
      );
    }

    const call = async (path: string, params: Record<string, string>) => {
      const url = new URL(`${base}/${path}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      url.searchParams.set("appsecret_proof", proof);
      const res = await fetch(url, {
        headers: auth,
        signal: AbortSignal.timeout(10000),
      });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok && !json?.error, status: res.status, json };
    };

    // 3a) Perfil (instagram_basic — sempre disponível).
    const profileRes = await call(encodeURIComponent(igId), {
      fields: "username,followers_count,media_count,name,profile_picture_url",
    });
    // A rejected token is a failed report, not a successful empty profile.
    requireReadableProfile(
      profileRes.ok,
      profileRes.json,
      profileRes.status,
      route.insightsPermission,
    );
    if (!profileRes.json?.id) {
      throw new HttpError(
        502,
        "meta_profile_unavailable",
        undefined,
        "A Meta retornou um perfil incompleto. Tente novamente antes de gerar o relatório.",
      );
    }

    // 3b) Posts recentes com curtidas/comentários + imagem (instagram_basic).
    // thumbnail_url é a capa (vídeos/reels); media_url é a imagem (fotos).
    const mediaRes = await call(`${encodeURIComponent(igId)}/media`, {
      fields:
        "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,media_url,thumbnail_url",
      limit: "25",
    });

    // 3c) Insights de conta (exige instagram_manage_insights) — best-effort.
    // Alcance TOTAL do período (deduplicado) via metric_type=total_value — este
    // é o número certo para o card. Somar o alcance diário distorce (conta a
    // mesma pessoa em dias diferentes). "reach" é a métrica atual (pós-2025).
    const reachTotalRes = await call(`${encodeURIComponent(igId)}/insights`, {
      metric: "reach",
      metric_type: "total_value",
      period: "day",
      since: String(since),
      until: String(until),
    });
    // Série diária de alcance (para o gráfico de alcance no tempo) — best-effort.
    const reachDailyRes = await call(`${encodeURIComponent(igId)}/insights`, {
      metric: "reach",
      period: "day",
      since: String(since),
      until: String(until),
    });
    // Visualizações totais do período (views, sem deduplicar) — o número "cheio",
    // complementa o alcance (que é único). best-effort.
    const viewsRes = await call(`${encodeURIComponent(igId)}/insights`, {
      metric: "views",
      metric_type: "total_value",
      period: "day",
      since: String(since),
      until: String(until),
    });

    // Novos seguidores por dia (série) — best-effort.
    const followerCountRes = await call(
      `${encodeURIComponent(igId)}/insights`,
      {
        metric: "follower_count",
        period: "day",
        since: String(since),
        until: String(until),
      },
    );

    // Demografia dos seguidores (idade, gênero, cidade) — lifetime, best-effort.
    // Exige 100+ seguidores. Extrai os pares {chave, valor} de cada breakdown.
    const demo = async (breakdown: string) => {
      const r = await call(`${encodeURIComponent(igId)}/insights`, {
        metric: "follower_demographics",
        period: "lifetime",
        metric_type: "total_value",
        breakdown,
      });
      const results = r.ok
        ? (r.json?.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [])
        : [];
      return (results as Array<{ dimension_values?: string[]; value?: number }>)
        .map((x) => ({
          chave: x.dimension_values?.[0] ?? "?",
          valor: x.value ?? 0,
        }))
        .sort((a, b) => b.valor - a.valor);
    };
    const [demoGenero, demoIdade, demoCidade] = await Promise.all([
      demo("gender"),
      demo("age"),
      demo("city"),
    ]);

    const insightsAvailable = reachTotalRes.ok || reachDailyRes.ok;
    const reachTotal = reachTotalRes.ok
      ? (reachTotalRes.json?.data?.[0]?.total_value?.value ?? null)
      : null;
    const viewsTotal = viewsRes.ok
      ? (viewsRes.json?.data?.[0]?.total_value?.value ?? null)
      : null;

    // Período de comparação (opcional): só os totais de alcance e visualizações,
    // que são cleanly comparáveis (totais do período). best-effort.
    let previousReach: number | null = null;
    let previousViews: number | null = null;
    if (hasCompare) {
      const [pReach, pViews] = await Promise.all([
        call(`${encodeURIComponent(igId)}/insights`, {
          metric: "reach",
          metric_type: "total_value",
          period: "day",
          since: String(compareSince),
          until: String(compareUntil),
        }),
        call(`${encodeURIComponent(igId)}/insights`, {
          metric: "views",
          metric_type: "total_value",
          period: "day",
          since: String(compareSince),
          until: String(compareUntil),
        }),
      ]);
      previousReach = pReach.ok
        ? (pReach.json?.data?.[0]?.total_value?.value ?? null)
        : null;
      previousViews = pViews.ok
        ? (pViews.json?.data?.[0]?.total_value?.value ?? null)
        : null;
    }
    const insightsError = insightsAvailable ? null : insightsFailure(
      reachTotalRes.json,
      reachTotalRes.status,
      route.insightsPermission,
    ).detail;

    // 3f) FACEBOOK orgânico — best-effort, NÃO quebra o relatório do Instagram.
    // Usa o MESMO token de Página (só leitura de insights); não toca em publicação.
    let facebook:
      | {
        name: string | null;
        followers: number | null;
        reach: number | null;
        views: number | null;
        engagement: number | null;
        note: string;
      }
      | null = null;
    try {
      // Instagram Login cannot authorize Facebook Page reads.
      if (route.supportsFacebook) {
        const { data: fbChannel } = await admin
          .from("meta_connection_channels")
          .select("external_account_id")
          .eq("connection_id", conn.id)
          .eq("channel_type", "facebook_page")
          .eq("status", "active")
          .maybeSingle();
        const pageId = fbChannel?.external_account_id;
        if (pageId) {
          // Cada métrica é buscada em separado: se uma estiver depreciada na
          // versão da Graph API, as outras ainda voltam.
          const fbMetric = async (metric: string): Promise<number | null> => {
            const r = await call(`${encodeURIComponent(pageId)}/insights`, {
              metric,
              period: "day",
              since: String(since),
              until: String(until),
            });
            if (!r.ok) return null;
            const m = (r.json?.data ?? [])[0] as {
              values?: Array<{ value?: number }>;
            } | undefined;
            if (!m) return null;
            return (m.values ?? []).reduce(
              (s: number, v) => s + (v.value ?? 0),
              0,
            );
          };
          const [fbProfile, engagement, views] = await Promise.all([
            call(encodeURIComponent(pageId), {
              fields: "name,followers_count,fan_count",
            }),
            fbMetric("page_post_engagements"),
            fbMetric("page_views_total"),
          ]);
          facebook = {
            name: fbProfile.ok ? (fbProfile.json?.name ?? null) : null,
            followers: fbProfile.ok
              ? (fbProfile.json?.followers_count ?? fbProfile.json?.fan_count ??
                null)
              : null,
            // Daily unique audiences overlap; summing them is not period reach.
            reach: null,
            views,
            engagement,
            note:
              "Alcance único do período indisponível. Alcances diários não são somados para evitar contar pessoas repetidas.",
          };
        }
      }
    } catch (_e) {
      facebook = null; // best-effort: erro no FB não afeta o Instagram
    }

    return jsonResponse(
      {
        client: client.name,
        instagram_id: igId,
        period: {
          from: from.toISOString().slice(0, 10),
          to: to.toISOString().slice(0, 10),
        },
        profile: profileRes.json,
        media: mediaRes.ok ? (mediaRes.json?.data ?? []) : {
          error: insightsFailure(
            mediaRes.json,
            mediaRes.status,
            route.insightsPermission,
          ).detail,
        },
        insights_available: insightsAvailable,
        insights_note: insightsAvailable
          ? "Dados de alcance disponíveis. Outros indicadores dependem da disponibilidade na Meta."
          : insightsError,
        reach_total: reachTotal,
        views_total: viewsTotal,
        previous_reach_total: previousReach,
        previous_views_total: previousViews,
        account_insights: reachDailyRes.ok
          ? (reachDailyRes.json?.data ?? [])
          : null,
        new_followers: followerCountRes.ok
          ? (followerCountRes.json?.data?.[0]?.values ?? [])
          : null,
        demographics: {
          genero: demoGenero,
          idade: demoIdade,
          cidade: demoCidade,
        },
        facebook,
      },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
});
