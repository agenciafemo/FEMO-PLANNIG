// Camada de dados do relatório de TRÁFEGO PAGO (Meta Ads). Fala com a Edge
// Function meta-ads-insights, que lê anúncios com a conexão Meta Ads da
// agência (feita pela tela, token no Vault). O mapa cliente->conta vive na
// tabela client_ad_accounts (RLS por org).

import { supabase } from "@/integrations/supabase/client";
import { edgeDetail, edgeReasonCode, invokeEdge } from "@/lib/edgeInvoke";
import { metaReportError } from "@/lib/metaReportError";

export interface AdAccount {
  account_id: string; // numérico, sem "act_"
  name: string | null;
  currency: string | null;
  status: number | null;
}

// Cada "ação" do Meta: { action_type, value }. O tipo depende do objetivo.
export interface AdAction {
  action_type: string;
  value: string;
}

export interface AdsInsights {
  conta: { id: string; nome: string | null };
  periodo: { de?: string; ate?: string; preset?: string };
  totais: {
    gasto: number;
    impressoes: number;
    alcance: number;
    cliques: number;
    ctr: number;
    cpc: number;
    cpm: number;
    acoes: AdAction[];
    custo_por_acao: AdAction[];
  };
  campanhas: Array<{
    nome: string | null;
    objetivo: string | null;
    gasto: number;
    impressoes: number;
    alcance: number;
    cliques: number;
    acoes: AdAction[];
    custo_por_acao: AdAction[];
  }>;
}

// Lista as contas de anúncios que a conexão Meta Ads da agência enxerga.
export async function listAdAccounts(
  organizationId?: string | null,
): Promise<AdAccount[]> {
  const { data, error } = await invokeEdge("meta-ads-insights", {
    body: { mode: "accounts", organization_id: organizationId ?? undefined },
  });
  if (error) throw await metaReportError(error);
  return (data as { accounts: AdAccount[] }).accounts ?? [];
}

// Puxa as métricas de tráfego pago de um cliente no período. Use datePreset
// (últimos 7/14/30 dias, este mês, mês passado, maximum) OU from/to (custom).
export async function getAdsInsights(input: {
  clientId: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  datePreset?: string;
}): Promise<AdsInsights> {
  const { data, error } = await invokeEdge("meta-ads-insights", {
    body: {
      mode: "insights",
      client_id: input.clientId,
      from: input.from,
      to: input.to,
      date_preset: input.datePreset,
    },
  });
  if (error) throw await metaReportError(error);
  return data as AdsInsights;
}

export interface ClientAdAccountRow {
  client_id: string;
  ad_account_id: string;
  ad_account_name: string | null;
}

// Mapa cliente->conta da organização inteira (para preencher os selects).
export async function loadClientAdAccounts(
  organizationId: string,
): Promise<Record<string, ClientAdAccountRow>> {
  const { data, error } = await (supabase
    .from("client_ad_accounts" as never)
    .select("client_id, ad_account_id, ad_account_name")
    .eq("organization_id", organizationId)
    .eq("status", "active") as unknown as Promise<
      { data: ClientAdAccountRow[] | null; error: { message: string } | null }
    >);
  if (error) throw new Error(error.message);
  const map: Record<string, ClientAdAccountRow> = {};
  for (const row of data ?? []) map[row.client_id] = row;
  return map;
}

// Casa (ou atualiza) a conta de anúncios de um cliente.
export async function setClientAdAccount(input: {
  organizationId: string;
  clientId: string;
  adAccountId: string;
  adAccountName: string | null;
  userId: string;
}): Promise<void> {
  const { error } = await (supabase
    .from("client_ad_accounts" as never)
    .upsert(
      {
        organization_id: input.organizationId,
        client_id: input.clientId,
        ad_account_id: input.adAccountId,
        ad_account_name: input.adAccountName,
        status: "active",
        created_by: input.userId,
        updated_by: input.userId,
      } as never,
      { onConflict: "organization_id,client_id" },
    ) as unknown as Promise<{ error: { message: string } | null }>);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Conexão Meta Ads da agência
// ---------------------------------------------------------------------------

export type MetaAdsConnectionStatus = {
  can_manage: boolean;
  connection_status:
    | "not_connected"
    | "active"
    | "reauth_required"
    | "disconnected"
    | "error";
  meta_user_name: string | null;
  token_expires_at: string | null;
  connected_at: string | null;
  last_verified_at: string | null;
  last_error_code: string | null;
};

export async function getMetaAdsStatus(
  organizationId: string,
): Promise<MetaAdsConnectionStatus | null> {
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: MetaAdsConnectionStatus[] | null; error: Error | null }>)(
    "get_meta_ads_connection_status",
    { _organization_id: organizationId },
  );
  if (error) throw error;
  return data?.[0] ?? null;
}

const META_ADS_MESSAGES: Record<string, string> = {
  session_expired: "Sua sessão expirou. Entre novamente para continuar.",
  meta_ads_management_forbidden:
    "Somente ADM, Head ou quem tem a função Tráfego Pago pode conectar o Meta Ads da agência.",
  meta_ads_oauth_denied_by_user: "A conexão foi cancelada na tela da Meta.",
  meta_ads_permission_declined:
    "A permissão de ler anúncios foi desmarcada na tela da Meta. Conecte de novo e mantenha essa permissão marcada.",
  meta_ads_oauth_state_invalid_or_expired:
    "A tentativa de conexão expirou. Clique em Conectar Meta Ads de novo.",
  meta_ads_oauth_state_missing:
    "A volta da Meta chegou incompleta. Clique em Conectar Meta Ads de novo.",
  meta_ads_connection_save_failed:
    "A Meta autorizou, mas não foi possível salvar a conexão. Tente de novo.",
  meta_ads_oauth_state_create_failed:
    "Não foi possível iniciar a conexão. Confira se a migration do Meta Ads foi aplicada neste ambiente.",
};

export function metaAdsReasonMessage(reason: string): string {
  return META_ADS_MESSAGES[reason] ??
    `Não foi possível concluir a conexão do Meta Ads (${reason}).`;
}

async function metaAdsError(error: unknown): Promise<Error> {
  const detail = await edgeDetail(error);
  if (detail) return new Error(detail);
  const code = (await edgeReasonCode(error)) ??
    (error instanceof Error ? error.message : null);
  return new Error(
    code ? metaAdsReasonMessage(code) : "Não foi possível falar com o Meta Ads.",
  );
}

export async function startMetaAdsOAuth(
  organizationId: string,
  redirectPath: string,
): Promise<string> {
  const { data, error } = await invokeEdge<{ authorize_url: string }>(
    "meta-ads-oauth-start",
    { body: { organization_id: organizationId, redirect_path: redirectPath } },
  );
  if (error) throw await metaAdsError(error);
  return (data as { authorize_url: string }).authorize_url;
}

export async function disconnectMetaAds(organizationId: string): Promise<void> {
  const { error } = await invokeEdge("meta-ads-insights", {
    body: { mode: "disconnect", organization_id: organizationId },
  });
  if (error) throw await metaAdsError(error);
}

/** Dias inteiros até a data (negativo = já passou). null = sem data. */
export function daysUntil(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.floor((time - now) / 86_400_000);
}
