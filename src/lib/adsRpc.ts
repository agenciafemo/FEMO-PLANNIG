// Camada de dados do relatório de TRÁFEGO PAGO (Meta Ads). Fala só com a Edge
// Function meta-ads-insights (que usa o token de Ads da agência via secret).
// O mapa cliente->conta vive na tabela client_ad_accounts (RLS por org).

import { supabase } from "@/integrations/supabase/client";

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

// Lista as contas de anúncios que o token da agência enxerga (teste + mapa).
export async function listAdAccounts(): Promise<AdAccount[]> {
  const { data, error } = await supabase.functions.invoke("meta-ads-insights", {
    body: { mode: "accounts" },
  });
  if (error) throw error;
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
  const { data, error } = await supabase.functions.invoke("meta-ads-insights", {
    body: {
      mode: "insights",
      client_id: input.clientId,
      from: input.from,
      to: input.to,
      date_preset: input.datePreset,
    },
  });
  if (error) throw error;
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
