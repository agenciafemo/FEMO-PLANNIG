import { supabase } from "@/integrations/supabase/client";

// Movimentações do Administrativo. O registro vem do banco por gatilho; aqui
// só se lê e se transforma numa frase que alguém entenda sem saber o nome das
// tabelas.

export interface Movimentacao {
  id: string;
  autor_id: string | null;
  autor_nome: string | null;
  acao: "criou" | "alterou" | "removeu";
  entidade: string;
  registro_descricao: string | null;
  registro_id: string | null;
  tabela: string;
  criado_em: string;
}

/** Teto por página. O log cresce sozinho; puxar tudo trava a tela um dia. */
export const MOVIMENTACOES_POR_PAGINA = 50;

export async function listarMovimentacoes(
  organizationId: string,
  pagina = 0,
): Promise<Movimentacao[]> {
  const inicio = pagina * MOVIMENTACOES_POR_PAGINA;

  const { data, error } = await supabase
    .from("auditoria_administrativa")
    .select("*")
    .eq("organization_id", organizationId)
    .order("criado_em", { ascending: false })
    .range(inicio, inicio + MOVIMENTACOES_POR_PAGINA - 1);

  if (error) throw new Error(error.message);
  return (data ?? []) as Movimentacao[];
}

/**
 * A linha em uma frase.
 *
 * Sem o nome do registro a frase fica "Fernanda alterou Colaborador", que não
 * diz qual — por isso a descrição entra entre aspas quando existe, e some
 * quando não existe, em vez de virar um "(sem nome)" que polui.
 */
export function descreverMovimentacao(m: Movimentacao): string {
  const autor = m.autor_nome?.trim() || "Alguém";
  const alvo = m.registro_descricao?.trim();
  return alvo
    ? `${autor} ${m.acao} ${artigo(m.entidade)} ${m.entidade.toLowerCase()} “${alvo}”`
    : `${autor} ${m.acao} ${artigo(m.entidade)} ${m.entidade.toLowerCase()}`;
}

/** "a ficha financeira" / "o lançamento" — sem isto a frase soa telegrama. */
function artigo(entidade: string): string {
  const femininas = ["Ficha", "Categoria", "Função", "Tabela", "Folha", "Configuração"];
  return femininas.some((f) => entidade.startsWith(f)) ? "a" : "o";
}

/** "há 5 minutos", "ontem", "12/09" — data cheia só quando já é passado. */
export function quandoFoi(iso: string, agora = new Date()): string {
  const data = new Date(iso);
  const minutos = Math.floor((agora.getTime() - data.getTime()) / 60000);

  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  if (horas < 48) return "ontem";

  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
