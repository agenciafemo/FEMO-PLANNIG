// Camada de dados do TRÁFEGO PAGO NO GOOGLE (Google Ads).
//
// Vive ao lado de adsRpc.ts (Meta Ads) em vez de dentro dele: as duas fontes
// têm autenticação, unidade de custo e vocabulário diferentes, e misturá-las
// num módulo só transformaria cada mudança numa fonte em risco para a outra.

import { supabase } from "@/integrations/supabase/client";
import { edgeDetail, edgeReasonCode, invokeEdge } from "@/lib/edgeInvoke";

export type GoogleAdsStatus = {
  organization_id: string;
  client_id: string;
  can_manage: boolean;
  connection_status:
    | "not_connected"
    | "active"
    | "reauth_required"
    | "disconnected"
    | "error";
  google_account_email: string | null;
  customer_id: string | null;
  descriptive_name: string | null;
  currency_code: string | null;
  time_zone: string | null;
  selected_at: string | null;
  last_verified_at: string | null;
  last_error_code: string | null;
};

export type GoogleAdsAccount = {
  customerId: string;
  descriptiveName: string;
  currencyCode: string | null;
  timeZone: string | null;
  manager: boolean;
  testAccount: boolean;
};

export type GoogleAdsInsights = {
  account: {
    customer_id: string;
    name: string;
    currency: string | null;
    time_zone: string | null;
  };
  period: { from: string; to: string };
  totals: {
    cost: number;
    impressions: number;
    clicks: number;
    conversions: number;
    ctr: number;
    cpc: number;
    cpm: number;
    cost_per_conversion: number;
  };
  campaigns: Array<{
    name: string;
    status: string | null;
    channel: string | null;
    cost: number;
    impressions: number;
    clicks: number;
    conversions: number;
  }>;
  daily: Array<{
    date: string;
    cost: number;
    impressions: number;
    clicks: number;
    conversions: number;
  }>;
};

export class GoogleAdsFunctionError extends Error {
  constructor(
    public readonly reasonCode: string,
    /** O que a API do Google respondeu, quando a categoria não basta. */
    public readonly detail: string | null = null,
  ) {
    super(reasonCode);
    this.name = "GoogleAdsFunctionError";
  }
}

async function invokeGoogleAds<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeEdge<T>("google-ads", { body });
  if (error) {
    throw new GoogleAdsFunctionError(
      (await edgeReasonCode(error)) ?? error.message ?? "google_ads_request_failed",
      await edgeDetail(error),
    );
  }
  return data as T;
}

export async function getGoogleAdsStatus(
  organizationId: string,
  clientId: string,
): Promise<GoogleAdsStatus | null> {
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: GoogleAdsStatus[] | null; error: Error | null }>)(
    "get_google_ads_connection_status",
    { _organization_id: organizationId, _client_id: clientId },
  );
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function startGoogleAdsOAuth(
  organizationId: string,
  redirectPath: string,
): Promise<string> {
  const { data, error } = await invokeEdge<{ authorize_url: string }>(
    "google-ads-oauth-start",
    { body: { organization_id: organizationId, redirect_path: redirectPath } },
  );
  if (error) {
    throw new GoogleAdsFunctionError(
      (await edgeReasonCode(error)) ?? error.message ?? "google_ads_request_failed",
    );
  }
  return (data as { authorize_url: string }).authorize_url;
}

export async function listGoogleAdsAccounts(
  organizationId: string,
): Promise<GoogleAdsAccount[]> {
  const data = await invokeGoogleAds<{ ok: true; accounts: GoogleAdsAccount[] }>({
    mode: "accounts",
    organization_id: organizationId,
  });
  return data.accounts ?? [];
}

export async function selectGoogleAdsAccount(input: {
  organizationId: string;
  clientId: string;
  customerId: string;
}): Promise<GoogleAdsAccount> {
  const data = await invokeGoogleAds<{ ok: true; account: GoogleAdsAccount }>({
    mode: "select",
    organization_id: input.organizationId,
    client_id: input.clientId,
    customer_id: input.customerId,
  });
  return data.account;
}

export async function getGoogleAdsInsights(input: {
  organizationId: string;
  clientId: string;
  from: string;
  to: string;
}): Promise<GoogleAdsInsights> {
  return invokeGoogleAds<GoogleAdsInsights>({
    mode: "insights",
    organization_id: input.organizationId,
    client_id: input.clientId,
    from: input.from,
    to: input.to,
  });
}

export async function disconnectGoogleAds(organizationId: string): Promise<void> {
  await invokeGoogleAds({ mode: "disconnect", organization_id: organizationId });
}

/**
 * Texto por código de erro.
 *
 * `google_ads_developer_token_missing` é o mais importante da lista: é o estado
 * em que a integração NASCE. Sem uma frase própria, a agência conecta a conta
 * com sucesso, vê um erro genérico ao puxar métricas e vai procurar defeito na
 * conexão — que está certa. O que falta é aprovação do Google, não código.
 */
export function googleAdsErrorMessage(reasonCode: string): string {
  const messages: Record<string, string> = {
    session_expired: "Sua sessão expirou. Entre novamente para continuar.",
    google_ads_management_forbidden:
      "Somente ADM ou Head pode gerenciar a conexão do Google Ads.",
    google_ads_not_connected:
      "Conecte a conta Google da agência antes de vincular uma conta de anúncios.",
    google_ads_developer_token_not_approved:
      "O token de desenvolvedor da agência só tem acesso a contas de TESTE. Para ler contas reais, solicite o acesso básico em Central de API → Nível de acesso, no Google Ads. A conexão e a conta vinculada estão certas.",
    google_ads_developer_token_invalid:
      "O Google não aceitou o token de desenvolvedor. Confira o valor na Central de API da conta de administrador.",
    google_ads_customer_not_enabled:
      "Esta conta de anúncios está desativada ou cancelada no Google Ads.",
    google_ads_developer_token_missing:
      "Falta o token de desenvolvedor do Google Ads. Ele é gerado na conta de administrador (MCC) e precisa de aprovação do Google — a conexão está certa, o que falta é esse acesso.",
    google_ads_accounts_unreadable:
      "O Google recusou a leitura de todas as contas. Normalmente é o nível de acesso do token de desenvolvedor — confira em Central de API → Nível de acesso.",
    google_ads_account_not_linked:
      "Vincule a conta de anúncios deste cliente antes de puxar métricas.",
    google_ads_customer_not_found:
      "A conta de anúncios não foi encontrada. Confira se ela está vinculada à conta de administrador da agência.",
    google_ads_permission_denied:
      "A conta Google conectada não tem acesso a esta conta de anúncios.",
    google_ads_reauthorization_required:
      "O acesso do Google expirou. Reconecte a conta da agência.",
    google_ads_refresh_token_missing:
      "O Google não forneceu acesso permanente. Reconecte e aceite as permissões.",
    google_ads_oauth_denied_by_user:
      "A conexão foi cancelada na tela do Google.",
    google_ads_rate_limited:
      "O Google limitou as consultas por alguns instantes. Tente novamente em breve.",
    google_ads_period_invalid: "A data inicial precisa vir antes da final.",
  };
  return messages[reasonCode] ??
    "Não foi possível concluir a ação no Google Ads.";
}

/**
 * Mensagem para a tela a partir do erro, já com o detalhe técnico quando ele
 * existe. O detalhe vem por último e em outra frase: quem só quer saber o que
 * fazer lê a primeira, quem vai diagnosticar lê as duas.
 */
export function googleAdsErrorText(erro: unknown): string {
  const reason = erro instanceof GoogleAdsFunctionError
    ? erro.reasonCode
    : erro instanceof Error
      ? erro.message
      : "google_ads_request_failed";
  const base = googleAdsErrorMessage(reason);
  const detail = erro instanceof GoogleAdsFunctionError ? erro.detail : null;
  return detail ? `${base} (${detail})` : base;
}

/** Formata na moeda DA CONTA — não no BRL da agência. */
export function formatGoogleAdsMoney(
  value: number,
  currency: string | null,
): string {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency || "BRL",
    }).format(value);
  } catch {
    // Moeda desconhecida não pode derrubar o relatório inteiro.
    return `${currency ?? ""} ${value.toFixed(2)}`.trim();
  }
}
