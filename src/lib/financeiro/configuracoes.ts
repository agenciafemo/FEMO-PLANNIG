import { supabase } from "@/integrations/supabase/client";

// A configuração deixou de ser uma linha fixa `id = 1` e passou a ser uma por
// organização — com `id` fixo, a segunda agência sobrescreveria os percentuais
// da primeira. As telas não precisam saber disso: pedem e salvam por aqui.
//
// Cores e logo saíram: a identidade visual é do Norteia, e um segundo lugar
// para trocar a mesma cor garante que uma hora as duas telas divergem.

export interface ConfigFinanceiro {
  pct_rotativa: number;
  pct_reserva: number;
  pct_penalidade_atraso: number;
  pct_penalidade_churn: number;
}

/** Usado enquanto a agência ainda não salvou nada. A soma tem que dar 100:
 *  é a mesma regra que o banco cobra num CHECK. */
export const CONFIG_PADRAO: ConfigFinanceiro = {
  pct_rotativa: 50,
  pct_reserva: 50,
  pct_penalidade_atraso: 0,
  pct_penalidade_churn: 0,
};

/** A organização de quem está usando. O app financeiro nasceu para uma agência
 *  só e não carrega esse conceito; aqui ele é resolvido uma vez e escondido. */
async function organizacaoAtual(): Promise<string> {
  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.organization_id) {
    throw new Error("Sua conta não está vinculada a nenhuma organização ativa.");
  }
  return data.organization_id;
}

export async function carregarConfig(): Promise<ConfigFinanceiro> {
  const { data, error } = await supabase
    .from("configuracoes_financeiro")
    .select("pct_rotativa, pct_reserva, pct_penalidade_atraso, pct_penalidade_churn")
    .maybeSingle();
  if (error) throw new Error(error.message);
  // Sem linha ainda não é erro: é a agência que nunca abriu esta tela.
  if (!data) return CONFIG_PADRAO;
  return {
    pct_rotativa: Number(data.pct_rotativa),
    pct_reserva: Number(data.pct_reserva),
    pct_penalidade_atraso: Number(data.pct_penalidade_atraso),
    pct_penalidade_churn: Number(data.pct_penalidade_churn),
  };
}

/**
 * Grava a configuração da organização, criando a linha na primeira vez.
 *
 * Sempre manda os quatro campos: o banco exige que rotativa + reserva feche em
 * 100, e um upsert parcial montaria uma linha nova com os defaults do outro
 * par — passando no CHECK, mas gravando um número que ninguém escolheu.
 */
export async function salvarConfig(patch: Partial<ConfigFinanceiro>): Promise<void> {
  const [organizationId, atual] = await Promise.all([organizacaoAtual(), carregarConfig()]);
  const completo: ConfigFinanceiro = { ...atual, ...patch };

  const { data, error } = await supabase
    .from("configuracoes_financeiro")
    .upsert({ organization_id: organizationId, ...completo }, { onConflict: "organization_id" })
    .select("organization_id");
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new Error("Sem permissão para salvar a configuração financeira.");
  }
}
