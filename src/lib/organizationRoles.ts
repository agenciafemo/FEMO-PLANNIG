export type OrganizationRole = "owner" | "admin" | "manager" | "editor" | "viewer";

/**
 * Acesso à gestão sensível da agência.
 *
 * Funções profissionais (social media, edição, tráfego etc.) não entram
 * nesta decisão: elas descrevem o trabalho da pessoa, não autoridade sobre
 * financeiro, cofre, equipe ou configurações.
 */
export function isOrganizationAdministrator(
  role: OrganizationRole | string | null | undefined,
): boolean {
  return role === "owner" || role === "admin";
}
