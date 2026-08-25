import { supabase } from "@/integrations/supabase/client";

/**
 * Exclusão de planejamento — em UMA operação.
 *
 * ANTES esta exclusão era feita em dois passos pelo cliente: apagava os posts,
 * depois o planejamento. Isso destruía conteúdo, porque as políticas do banco
 * divergem — `org_editors_delete_posts` deixa editor apagar posts, mas
 * `org_managers_delete_plannings` exige manager para apagar o planejamento.
 * Como DELETE bloqueado por RLS devolve ZERO LINHAS SEM ERRO, o resultado para
 * um editor era: conteúdo apagado, planejamento intacto, e um toast dizendo
 * "excluído". Perda de dados silenciosa.
 *
 * Apagar os posts à mão nunca foi necessário: `posts.planning_id` já é
 * ON DELETE CASCADE, assim como video_scripts, production_items e as respostas
 * de NPS. Apagar só o planejamento leva tudo junto, dentro da mesma transação
 * do Postgres. E se a RLS barrar, NADA é apagado.
 *
 * O `.select()` é o que fecha o buraco: sem ele não há como distinguir
 * "apagou" de "a RLS barrou em silêncio".
 */
export class PlanningDeleteForbiddenError extends Error {
  constructor() {
    super(
      "Você não tem permissão para excluir planejamentos. " +
      "Peça a alguém com papel de gestor, ou solicite a promoção do seu acesso.",
    );
    this.name = "PlanningDeleteForbiddenError";
  }
}

export async function deletePlanningCascade(planningId: string): Promise<void> {
  const { data, error } = await supabase
    .from("plannings")
    .delete()
    .eq("id", planningId)
    .select("id");

  if (error) throw error;
  // Zero linhas com sucesso = a política de segurança barrou.
  if (!data || data.length === 0) throw new PlanningDeleteForbiddenError();
}

/** Quantas peças somem junto — para a confirmação dizer o tamanho do estrago. */
export async function countPlanningPosts(planningId: string): Promise<number> {
  const { count } = await supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("planning_id", planningId);
  return count ?? 0;
}
