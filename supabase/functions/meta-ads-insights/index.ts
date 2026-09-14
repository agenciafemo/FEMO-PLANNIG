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
import { createAdminClient, createUserClient } from "../_shared/supabase.ts";
import { metaConfig } from "../_shared/meta-client.ts";
import { insightsFailure } from "../_shared/meta-insights.ts";
import {
  assertUuid,
  isMetaAuthorizationFailure,
  requireMetaAdsMember,
} from "../_shared/meta-ads.ts";

// Relatório de TRÁFEGO PAGO (Meta Ads).
//
// O token de leitura de anúncios vem da conexão Meta Ads DA AGÊNCIA
// (meta_ads_connections, token no Vault). Enquanto uma agência ainda não
// conectou, usa o token antigo do secret META_ADS_SYSTEM_TOKEN, para a troca
// não derrubar quem já funcionava. NÃO usa os tokens de publicação dos
// clientes — é totalmente separado (não afeta os posts programados).
//
// Modos:
//   "accounts"   -> lista as contas de anúncios que o token enxerga
//   "insights"   -> métricas do cliente no período + quebra por campanha
//   "disconnect" -> desconecta o Meta Ads da agência

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

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
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface Body {
  mode?: "accounts" | "insights" | "disconnect";
  organization_id?: string;
  client_id?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  date_preset?: string; // last_7d | last_14d | last_30d | this_month | last_month | maximum
}

// Presets aceitos (evita injeção — só passamos pro Meta o que está aqui).
const ALLOWED_PRESETS = new Set([
  "last_7d",
  "last_14d",
  "last_30d",
  "this_month",
  "last_month",
  "maximum",
]);

// deno-lint-ignore no-explicit-any
type Json = any;

type AdsToken = {
  token: string;
  proof: string;
  /** null = token antigo do secret, sem conexão no banco para marcar. */
  connectionId: string | null;
};

const RECONNECT_MESSAGE =
  "A Meta recusou o acesso de anúncios da agência (a autorização venceu ou foi revogada). Um ADM, Head ou quem tem a função Tráfego Pago precisa clicar em Reconectar Meta Ads, na seção de Tráfego Pago.";

/**
 * Qual token usar. A conexão pela tela tem prioridade; o secret antigo só vale
 * enquanto a agência NUNCA conectou. Se a conexão existe mas caiu, não volta
 * para o secret: ele é justamente o token que costuma estar morto, e o erro
 * certo é "reconecte".
 */
async function resolveAdsToken(
  admin: SupabaseAdmin,
  organizationId: string | null,
  appSecret: string,
): Promise<AdsToken> {
  if (organizationId) {
    const { data: connection, error } = await admin
      .from("meta_ads_connections")
      .select("status")
      .eq("organization_id", organizationId)
      .maybeSingle();
    // Erro aqui quase sempre é a migration ainda não aplicada neste ambiente:
    // cai para o token antigo em vez de derrubar o relatório.
    if (error) {
      console.error("meta_ads_connection_lookup_failed", error.code);
    } else if (connection) {
      if (connection.status === "disconnected") {
        throw new HttpError(
          409,
          "meta_ads_not_connected",
          undefined,
          "O Meta Ads da agência foi desconectado. Clique em Conectar Meta Ads, na seção de Tráfego Pago.",
        );
      }
      if (connection.status !== "active") {
        throw new HttpError(
          409,
          "meta_ads_reauthorization_required",
          undefined,
          RECONNECT_MESSAGE,
        );
      }
      const { data, error: credentialsError } = await admin.rpc(
        "meta_ads_server_get_credentials",
        { _organization_id: organizationId },
      );
      const row = data?.[0] as
        | { connection_id: string; access_token: string }
        | undefined;
      if (credentialsError || !row?.access_token) {
        throw new HttpError(500, "meta_ads_credentials_unavailable");
      }
      return {
        token: row.access_token,
        proof: await appSecretProof(row.access_token, appSecret),
        connectionId: row.connection_id,
      };
    }
  }

  const legacy = Deno.env.get("META_ADS_SYSTEM_TOKEN")?.trim();
  if (legacy) {
    return {
      token: legacy,
      proof: await appSecretProof(legacy, appSecret),
      connectionId: null,
    };
  }
  throw new HttpError(
    409,
    "meta_ads_not_connected",
    undefined,
    "O Meta Ads da agência ainda não está conectado. Um ADM, Head ou quem tem a função Tráfego Pago precisa clicar em Conectar Meta Ads, na seção de Tráfego Pago.",
  );
}

async function metaGet(
  admin: SupabaseAdmin,
  url: URL,
  ads: AdsToken,
): Promise<Json> {
  url.searchParams.set("appsecret_proof", ads.proof);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${ads.token}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(
      "meta_ads_error",
      res.status,
      json?.error?.code,
      json?.error?.error_subcode,
    );
    if (isMetaAuthorizationFailure(json, res.status)) {
      if (ads.connectionId) {
        // Marca a conexão: a tela passa a mostrar "Reconectar" sem precisar
        // que alguém tente puxar um relatório para descobrir.
        await admin.rpc("meta_ads_server_mark_result", {
          _connection_id: ads.connectionId,
          _status: "reauth_required",
          _reason_code: "meta_ads_token_invalid",
        });
        throw new HttpError(
          409,
          "meta_ads_reauthorization_required",
          res.status,
          RECONNECT_MESSAGE,
        );
      }
      throw new HttpError(
        409,
        "meta_ads_token_invalid",
        res.status,
        "O token antigo de Meta Ads da agência foi recusado pela Meta. Conecte o Meta Ads pelo botão Conectar Meta Ads, na seção de Tráfego Pago — reconectar apenas o Instagram não resolve.",
      );
    }
    throw insightsFailure(json, res.status, "ads_read");
  }
  return json;
}

async function markVerified(admin: SupabaseAdmin, ads: AdsToken) {
  if (!ads.connectionId) return;
  await admin.rpc("meta_ads_server_mark_result", {
    _connection_id: ads.connectionId,
    _status: "active",
    _reason_code: null,
  });
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

    // Autenticação: usuário logado (RLS-scoped). Só membros da org conseguem
    // resolver a conta do cliente.
    const authHeader = request.headers.get("Authorization") ?? "";
    const userToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!userToken) throw new HttpError(401, "unauthorized");
    const supabase = createUserClient(userToken);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) throw new HttpError(401, "unauthorized");
    const userId = userData.user.id;

    const admin = createAdminClient();
    const cfg = metaConfig();
    const base = `https://graph.facebook.com/${cfg.graphVersion}`;

    const body = (await request.json().catch(() => ({}))) as Body;
    const mode = body.mode ?? "insights";

    // ----- MODO: desconectar o Meta Ads da agência -----
    if (mode === "disconnect") {
      const organizationId = assertUuid(
        body.organization_id,
        "organization_id_invalid",
      );
      await requireMetaAdsMember(admin, organizationId, userId, true);
      const { error } = await admin.rpc("meta_ads_server_disconnect", {
        _organization_id: organizationId,
        _actor_user_id: userId,
      });
      if (error) throw new HttpError(500, "meta_ads_disconnect_failed");
      return jsonResponse({ ok: true }, 200, headers);
    }

    // ----- MODO: listar contas de anúncios (teste do token + mapa) -----
    if (mode === "accounts") {
      // Sem organization_id (frontend antigo em cache) só existe o token antigo.
      const organizationId = body.organization_id
        ? assertUuid(body.organization_id, "organization_id_invalid")
        : null;
      if (organizationId) {
        await requireMetaAdsMember(admin, organizationId, userId);
      }
      const ads = await resolveAdsToken(admin, organizationId, cfg.appSecret);
      const url = new URL(`${base}/me/adaccounts`);
      url.searchParams.set(
        "fields",
        "account_id,name,account_status,currency",
      );
      url.searchParams.set("limit", "500");
      const json = await metaGet(admin, url, ads);
      await markVerified(admin, ads);
      const accounts = ((json.data ?? []) as Json[]).map((a) => ({
        account_id: a.account_id, // numérico, sem "act_"
        name: a.name ?? null,
        currency: a.currency ?? null,
        status: a.account_status ?? null,
      }));
      return jsonResponse({ accounts }, 200, headers);
    }

    // ----- MODO: insights de um cliente no período -----
    const clientId = body.client_id;
    if (!clientId) throw new HttpError(400, "missing_client_id");

    // Resolve a conta de anúncios do cliente (RLS garante o acesso).
    // deno-lint-ignore no-explicit-any
    const { data: mapping } = await (supabase as any)
      .from("client_ad_accounts")
      .select("organization_id, ad_account_id, ad_account_name")
      .eq("client_id", clientId)
      .eq("status", "active")
      .maybeSingle();
    if (!mapping?.ad_account_id) {
      throw new HttpError(409, "client_sem_conta_de_anuncios");
    }
    const act = `act_${mapping.ad_account_id}`;
    const ads = await resolveAdsToken(
      admin,
      mapping.organization_id ?? null,
      cfg.appSecret,
    );

    // Período: por preset (últimos 7/14/30 dias, este mês, mês passado, todo)
    // OU intervalo personalizado (from/to). Preset tem prioridade.
    const preset = typeof body.date_preset === "string" &&
        ALLOWED_PRESETS.has(body.date_preset)
      ? body.date_preset
      : null;
    let applyPeriod: (u: URL) => void;
    let periodo: { de?: string; ate?: string; preset?: string };
    if (preset) {
      applyPeriod = (u) => u.searchParams.set("date_preset", preset);
      periodo = { preset };
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const to = body.to ?? today;
      const from = body.from ??
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(
          0,
          10,
        );
      const timeRange = JSON.stringify({ since: from, until: to });
      applyPeriod = (u) => u.searchParams.set("time_range", timeRange);
      periodo = { de: from, ate: to };
    }

    // Totais da conta no período.
    const totalsUrl = new URL(`${base}/${act}/insights`);
    totalsUrl.searchParams.set(
      "fields",
      "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type",
    );
    applyPeriod(totalsUrl);
    const totalsJson = await metaGet(admin, totalsUrl, ads);
    const totalsRow = (totalsJson.data ?? [])[0] ?? {};

    // Quebra por campanha (as que rodaram no período).
    const campUrl = new URL(`${base}/${act}/insights`);
    campUrl.searchParams.set("level", "campaign");
    campUrl.searchParams.set(
      "fields",
      "campaign_name,spend,impressions,reach,clicks,actions,cost_per_action_type,objective",
    );
    applyPeriod(campUrl);
    campUrl.searchParams.set("limit", "100");
    const campJson = await metaGet(admin, campUrl, ads);
    await markVerified(admin, ads);
    const campaigns = ((campJson.data ?? []) as Json[])
      .map((c) => ({
        nome: c.campaign_name ?? null,
        objetivo: c.objective ?? null,
        gasto: Number(c.spend ?? 0),
        impressoes: Number(c.impressions ?? 0),
        alcance: Number(c.reach ?? 0),
        cliques: Number(c.clicks ?? 0),
        acoes: c.actions ?? [],
        custo_por_acao: c.cost_per_action_type ?? [],
      }))
      .sort((a, b) => b.gasto - a.gasto);

    const totais = {
      gasto: Number(totalsRow.spend ?? 0),
      impressoes: Number(totalsRow.impressions ?? 0),
      alcance: Number(totalsRow.reach ?? 0),
      cliques: Number(totalsRow.clicks ?? 0),
      ctr: Number(totalsRow.ctr ?? 0),
      cpc: Number(totalsRow.cpc ?? 0),
      cpm: Number(totalsRow.cpm ?? 0),
      // Arrays cru: cada objetivo tem sua "ação" (compra, lead, mensagem...).
      acoes: totalsRow.actions ?? [],
      custo_por_acao: totalsRow.cost_per_action_type ?? [],
    };

    return jsonResponse(
      {
        conta: {
          id: mapping.ad_account_id,
          nome: mapping.ad_account_name ?? null,
        },
        periodo,
        totais,
        campanhas: campaigns,
      },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
});
