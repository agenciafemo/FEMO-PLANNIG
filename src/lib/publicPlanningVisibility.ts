/**
 * Defesa adicional no frontend. A autorização real continua nas RPCs do
 * banco, mas este filtro impede uma versão antiga da RPC de renderizar um
 * planejamento que ainda esteja em produção.
 */
export function isPublicPlanningStatus(status: string | null | undefined): boolean {
  return status === "client_review" || status === "approved";
}
