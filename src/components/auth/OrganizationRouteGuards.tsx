import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useOrganizationContext } from "@/contexts/OrganizationContext";
import { isOrganizationAdministrator } from "@/lib/organizationRoles";

export function OrganizationGuard({ children }: { children: ReactNode }) {
  const { memberships, organizationId, loading, error } = useOrganizationContext();
  if (loading) return null;
  if (error || memberships.length === 0 || !organizationId) {
    return <Navigate to="/organizations/select" replace />;
  }
  return <>{children}</>;
}

export function RequireOrganizationCreator({ children }: { children: ReactNode }) {
  const { memberships, organizationId, loading, error } = useOrganizationContext();
  if (loading) return null;
  const active = memberships.find((membership) => membership.organizationId === organizationId);
  if (error || !active || !isOrganizationAdministrator(active.role)) {
    return <Navigate to="/organizations/select" replace />;
  }
  return <>{children}</>;
}

export function RequireOrganizationAdministrator({ children }: { children: ReactNode }) {
  const { role, loading, error } = useOrganizationContext();
  if (loading) return null;
  if (error || !isOrganizationAdministrator(role)) {
    return <Navigate to="/administrativo/clientes" replace />;
  }
  return <>{children}</>;
}
