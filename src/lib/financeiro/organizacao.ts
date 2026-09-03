import { supabase } from "@/integrations/supabase/client";

// De qual agência é o dinheiro que está sendo lançado.
//
// Enquanto o financeiro foi um app separado, ele tinha seletor próprio. Dentro
// do Norteia isso seria uma segunda verdade: o app inteiro já trabalha sobre
// uma organização ativa, guardada em `profiles.active_organization_id` e
// trocada pelo seletor do Norteia. Duas noções de "agência atual" na mesma tela
// terminam em folha de pagamento lançada na empresa errada.
//
// Este módulo lê a mesma coluna. Ele existe porque `comOrganizacao()` é chamada
// de dentro de mutations, fora da árvore do React, onde não há hook.
//
// As tabelas ligadas a um cliente nem passam por aqui: o banco deriva a
// organização do próprio cliente (`fin_org_do_cliente`).

/**
 * Carimba a organização ativa no que vai ser gravado.
 *
 * Envolver o argumento inteiro do insert, em vez de acrescentar o campo em
 * cada payload, mantém os pontos de gravação com a mesma cara — e faz o
 * esquecimento aparecer como erro de tipo, não como linha na agência errada.
 */
export async function comOrganizacao<T extends Record<string, unknown>>(
  dados: T,
): Promise<T & { organization_id: string }>;
export async function comOrganizacao<T extends Record<string, unknown>>(
  dados: T[],
): Promise<Array<T & { organization_id: string }>>;
export async function comOrganizacao<T extends Record<string, unknown>>(
  dados: T | T[],
): Promise<unknown> {
  const organization_id = await organizacaoAtiva();
  return Array.isArray(dados)
    ? dados.map((linha) => ({ ...linha, organization_id }))
    : { ...dados, organization_id };
}

/**
 * A organização em que gravar: a ativa do Norteia, se ainda for uma das suas.
 *
 * A revalidação contra as memberships não é zelo excessivo — perder acesso a
 * uma agência e continuar lançando nela seria pior do que um erro na tela.
 */
export async function organizacaoAtiva(): Promise<string> {
  const { data: sessao } = await supabase.auth.getUser();
  const userId = sessao.user?.id;
  if (!userId) throw new Error("Sessão expirada. Entre de novo.");

  const [{ data: membros, error: erroMembros }, { data: perfil }] = await Promise.all([
    supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .eq("status", "active"),
    supabase
      .from("profiles")
      .select("active_organization_id")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  if (erroMembros) throw new Error(erroMembros.message);

  const minhas = (membros ?? []).map((linha) => linha.organization_id as string);
  if (minhas.length === 0) {
    throw new Error("Sua conta não está vinculada a nenhuma organização ativa.");
  }

  const ativa = (perfil as { active_organization_id?: string | null } | null)
    ?.active_organization_id ?? null;
  if (ativa && minhas.includes(ativa)) return ativa;

  if (minhas.length === 1) return minhas[0];

  throw new Error("Escolha a agência no topo da barra lateral antes de lançar.");
}
