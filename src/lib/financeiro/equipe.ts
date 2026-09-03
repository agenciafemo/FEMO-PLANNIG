import { supabase } from "@/integrations/supabase/client";
import { organizacaoAtiva } from "@/lib/financeiro/organizacao";

// A folha de pagamento é sobre as pessoas que já estão no Norteia. Digitar o
// nome de novo aqui criava uma segunda identidade para a mesma pessoa: "Ana
// Paula" na folha e "Ana P." na equipe são, para o sistema, duas pessoas — e
// cada uma acumula a sua comissão. Este módulo é a ponte que faltava.
//
// A fonte é a mesma RPC que o resto do app usa para listar a equipe
// (`get_task_assignees`), e não uma consulta nova a `profiles`: ela já é
// SECURITY DEFINER, já filtra membros ativos da organização e já devolve o
// diretório sanitizado, sem e-mail nem dado de autenticação.

export interface PessoaDaEquipe {
  user_id: string;
  display_name: string;
  job_title: string | null;
  avatar_url: string | null;
}

/** Membros ativos da organização, na ordem em que aparecem para escolher. */
export async function listarEquipe(): Promise<PessoaDaEquipe[]> {
  const organizationId = await organizacaoAtiva();

  const { data, error } = await supabase.rpc("get_task_assignees", {
    _organization_id: organizationId,
  });
  if (error) throw new Error(error.message);

  return ((data ?? []) as PessoaDaEquipe[])
    .slice()
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "pt-BR"));
}

/**
 * Quem da equipe ainda não está na folha.
 *
 * É o que o seletor oferece: mostrar quem já foi cadastrado seria oferecer um
 * caminho que o banco recusa (índice `colaboradores_pessoa_unica`), e o erro
 * chegaria como violação de unicidade em vez de uma lista que simplesmente não
 * repete ninguém.
 */
export async function equipeSemFolha(): Promise<PessoaDaEquipe[]> {
  const [equipe, jaNaFolha] = await Promise.all([
    listarEquipe(),
    supabase.from("colaboradores").select("user_id").not("user_id", "is", null),
  ]);
  if (jaNaFolha.error) throw new Error(jaNaFolha.error.message);

  const ocupados = new Set(
    (jaNaFolha.data ?? []).map((linha) => (linha as { user_id: string | null }).user_id),
  );
  return equipe.filter((pessoa) => !ocupados.has(pessoa.user_id));
}
