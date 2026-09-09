import { createContext, useContext, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MULTI_ORG_ENABLED } from "@/lib/featureFlags";

type OrganizationRole = "owner" | "admin" | "manager" | "editor" | "viewer";
export interface Membership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: OrganizationRole;
  clientLimit: number | null;
}
interface OrganizationContextType {
  organizationId: string | null;
  organizationName: string | null;
  role: OrganizationRole | null;
  clientLimit: number | null;
  memberships: Membership[];
  isLegacy: boolean;
  loading: boolean;
  error: string | null;
  switchOrganization: (organizationId: string) => Promise<void>;
  refresh: () => Promise<void>;
}
const LEGACY_MEMBERSHIP: Membership = {
  organizationId: "legacy", organizationName: "FEMO", organizationSlug: "femo", role: "owner", clientLimit: null,
};
const OrganizationContext = createContext<OrganizationContextType>({
  organizationId: null, organizationName: null, role: null, clientLimit: null,
  memberships: [], isLegacy: false, loading: true, error: null,
  switchOrganization: async () => {}, refresh: async () => {},
});
export const useOrganizationContext = () => useContext(OrganizationContext);

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["organization-context", user?.id];
  const query = useQuery({
    queryKey,
    enabled: !!user && !authLoading && MULTI_ORG_ENABLED,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!user) throw new Error("Login necessário");
      const [members, profile] = await Promise.all([
        supabase.from("organization_members").select("organization_id, role, organizations(name, slug, client_limit)")
          .eq("user_id", user.id).eq("status", "active"),
        supabase.from("profiles").select("active_organization_id").eq("id", user.id).maybeSingle(),
      ]);
      if (members.error) throw members.error;
      if (profile.error) throw profile.error;
      const memberships: Membership[] = (members.data ?? []).map((row) => ({
        organizationId: row.organization_id, role: row.role,
        organizationName: row.organizations?.name ?? "Agência",
        organizationSlug: row.organizations?.slug ?? "",
        clientLimit: row.organizations?.client_limit ?? null,
      }));
      const saved = profile.data?.active_organization_id;
      const activeId = memberships.some((m) => m.organizationId === saved)
        ? saved : memberships.length === 1 ? memberships[0].organizationId : null;
      return { memberships, activeId };
    },
  });
  const isLegacy = !MULTI_ORG_ENABLED;
  // Fail closed: a network/auth error must never become a legacy owner.
  const memberships = !user ? [] : isLegacy ? [LEGACY_MEMBERSHIP] : query.isError ? [] : query.data?.memberships ?? [];
  const activeId = isLegacy ? LEGACY_MEMBERSHIP.organizationId : query.data?.activeId;
  const active = memberships.find((m) => m.organizationId === activeId);

  const refresh = async () => {
    if (!MULTI_ORG_ENABLED || !user) return;
    const result = await query.refetch();
    if (result.error) throw result.error;
  };
  const switchOrganization = async (id: string) => {
    if (!user || isLegacy) throw new Error("Seleção de agência indisponível");
    const membership = await supabase.from("organization_members").select("id")
      .eq("organization_id", id).eq("user_id", user.id).eq("status", "active").maybeSingle();
    if (membership.error) throw membership.error;
    if (!membership.data) throw new Error("Você ainda não tem acesso a esta agência");
    const result = await supabase.from("profiles").update({ active_organization_id: id })
      .eq("id", user.id).select("id").maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error("Não foi possível salvar a agência selecionada");
    // Selection is outside AppLayout: discard old agency data before entering.
    await queryClient.cancelQueries();
    queryClient.removeQueries({ predicate: (entry) => entry.queryKey[0] !== "organization-context" });
    await refresh();
  };
  return <OrganizationContext.Provider value={{
    organizationId: active?.organizationId ?? null, organizationName: active?.organizationName ?? null,
    role: active?.role ?? null, clientLimit: active?.clientLimit ?? null,
    memberships, isLegacy, loading: authLoading || (!!user && MULTI_ORG_ENABLED && query.isPending),
    error: query.isError && !isLegacy ? "Não foi possível carregar suas agências. Tente novamente." : null,
    switchOrganization, refresh,
  }}>{children}</OrganizationContext.Provider>;
}
