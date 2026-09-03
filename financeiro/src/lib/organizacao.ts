import { supabase } from "@/integrations/supabase/client";

// O Norteia atende mais de uma agência, e a mesma pessoa pode administrar duas.
// O financeiro precisa saber de QUAL agência é o dinheiro que está sendo
// lançado — e o banco se recusa a adivinhar, de propósito: gravar folha de
// pagamento na organização errada é o tipo de erro que ninguém descobre no mês
// em que acontece.
//
// Nas tabelas ligadas a um cliente isso é resolvido no banco, derivando do
// próprio cliente. Aqui é o outro caso: colaborador, categoria, função, CRM e
// folha não têm cliente, e a organização vem desta escolha.

const CHAVE = "femo-financas:organizacao-ativa";

export interface Organizacao {
  id: string;
  name: string;
}

/** Organizações em que a pessoa é membro ativo. A RLS já filtra o resto. */
export async function listarOrganizacoes(): Promise<Organizacao[]> {
  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id, organizations!inner(id, name)")
    .eq("status", "active");
  if (error) throw new Error(error.message);

  const linhas = (data ?? []) as unknown as Array<{ organizations: Organizacao }>;
  return linhas
    .map((linha) => linha.organizations)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export function organizacaoSalva(): string | null {
  try {
    return localStorage.getItem(CHAVE);
  } catch {
    // Navegador com armazenamento bloqueado: cai no caminho de uma organização
    // só, ou pede a escolha de novo. Nunca quebra a tela.
    return null;
  }
}

export function definirOrganizacao(id: string): void {
  try {
    localStorage.setItem(CHAVE, id);
  } catch {
    /* escolher sem conseguir lembrar ainda funciona nesta sessão */
  }
}

/**
 * A organização em que gravar. Resolve nesta ordem:
 *
 *   1. a escolhida, se ainda for uma das suas;
 *   2. a única, quando só há uma — quem administra uma agência só nunca vê
 *      seletor nenhum;
 *   3. erro pedindo a escolha.
 *
 * O passo 1 revalida em vez de confiar no que está guardado: perder acesso a
 * uma agência e continuar lançando nela seria pior que um erro na tela.
 */
/**
 * Carimba a organização ativa no que vai ser gravado.
 *
 * Envolver o argumento inteiro do insert, em vez de acrescentar o campo em
 * cada payload, mantém os 14 pontos de gravação com a mesma cara — e faz o
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

export async function organizacaoAtiva(): Promise<string> {
  const minhas = await listarOrganizacoes();

  if (minhas.length === 0) {
    throw new Error("Sua conta não está vinculada a nenhuma organização ativa.");
  }

  const salva = organizacaoSalva();
  if (salva && minhas.some((o) => o.id === salva)) return salva;

  if (minhas.length === 1) return minhas[0].id;

  throw new Error(
    "Escolha a agência no topo da barra lateral antes de lançar.",
  );
}
