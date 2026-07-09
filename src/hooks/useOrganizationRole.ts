import { useOrganizationContext } from "@/contexts/OrganizationContext";

// Espelha a granularidade de permissões definida nas RLS policies:
// owner/admin/manager gerenciam clientes e planejamentos; editor edita
// conteúdos (posts/roteiros); viewer só visualiza.
export function useOrganizationRole() {
  const { role } = useOrganizationContext();

  return {
    role,
    isOwner: role === "owner",
    isOwnerOrAdmin: role === "owner" || role === "admin",
    canManageClientsAndPlannings: role === "owner" || role === "admin" || role === "manager",
    canEditContent: role === "owner" || role === "admin" || role === "manager" || role === "editor",
    isViewerOnly: role === "viewer",
  };
}
