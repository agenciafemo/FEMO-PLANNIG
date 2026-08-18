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
import { metaConfig } from "../_shared/meta-client.ts";

// Relatório de TRÁFEGO PAGO (Meta Ads).
//
// Usa um token de leitura de anúncios da agência (secret META_ADS_SYSTEM_TOKEN)
// para chamar o Marketing API. NÃO usa os tokens de publicação/conexão dos
// clientes — é totalmente separado (não afeta os posts programados).
//
// Modos:
//   "accounts" -> lista as contas de anúncios que o token enxerga (teste + mapa)
//   "insights" -> métricas do cliente no período (resolve a conta via
//                 client_ad_accounts) + quebra por campanha.

// appsecret_proof (HMAC-SHA256 do token com o App Secret) — exigido nas chamadas.
async function appSecretProof(token: string, appSecret: string): Promise<string> {
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
  mode?: "accounts" | "insights";
  client_id?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
}

// deno-lint-ignore no-explicit-any
type Json = any;

async function metaGet(
  url: URL,
  token: string,
  proof: string,
): Promise<Json> {
  url.searchParams.set("appsecret_proof", proof);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Loga o erro real do Meta (aparece nos logs) e devolve o status no code.
    console.error("meta_ads_error", res.status, JSON.stringify(json).slice(0, 800));
    throw new HttpError(502, `meta_${res.status}`);
  }
  return json;
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
    // resolver a conta do cliente; o token de Ads em si vem do secret.
    const authHeader = request.headers.get("Authorization") ?? "";
    const userToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!userToken) throw new HttpError(401, "unauthorized");
    const supabase = createUserClient(userToken);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) throw new HttpError(401, "unauthorized");

    const adsToken = requiredEnv("META_ADS_SYSTEM_TOKEN");
    const cfg = metaConfig();
    const base = `https://graph.facebook.com/${cfg.graphVersion}`;
    const proof = await appSecretProof(adsToken, cfg.appSecret);

    const body = (await request.json().catch(() => ({}))) as Body;
    const mode = body.mode ?? "insights";

    // ----- MODO: listar contas de anúncios (teste do token + mapa) -----
    if (mode === "accounts") {
      const url = new URL(`${base}/me/adaccounts`);
      url.searchParams.set(
        "fields",
        "account_id,name,account_status,currency",
      );
      url.searchParams.set("limit", "500");
      const json = await metaGet(url, adsToken, proof);
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
      .select("ad_account_id, ad_account_name")
      .eq("client_id", clientId)
      .eq("status", "active")
      .maybeSingle();
    if (!mapping?.ad_account_id) {
      throw new HttpError(409, "client_sem_conta_de_anuncios");
    }
    const act = `act_${mapping.ad_account_id}`;

    // Período (default: últimos 30 dias).
    const today = new Date().toISOString().slice(0, 10);
    const to = body.to ?? today;
    const from = body.from ??
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const timeRange = JSON.stringify({ since: from, until: to });

    // Totais da conta no período.
    const totalsUrl = new URL(`${base}/${act}/insights`);
    totalsUrl.searchParams.set(
      "fields",
      "spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type",
    );
    totalsUrl.searchParams.set("time_range", timeRange);
    const totalsJson = await metaGet(totalsUrl, adsToken, proof);
    const totalsRow = (totalsJson.data ?? [])[0] ?? {};

    // Quebra por campanha (as que rodaram no período).
    const campUrl = new URL(`${base}/${act}/insights`);
    campUrl.searchParams.set("level", "campaign");
    campUrl.searchParams.set(
      "fields",
      "campaign_name,spend,impressions,reach,clicks,actions,cost_per_action_type,objective",
    );
    campUrl.searchParams.set("time_range", timeRange);
    campUrl.searchParams.set("limit", "100");
    const campJson = await metaGet(campUrl, adsToken, proof);
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
        conta: { id: mapping.ad_account_id, nome: mapping.ad_account_name ?? null },
        periodo: { de: from, ate: to },
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
