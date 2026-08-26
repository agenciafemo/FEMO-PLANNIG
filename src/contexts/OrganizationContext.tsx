import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MULTI_ORG_ENABLED } from "@/lib/featureFlags";

// TODO(multi-org-migration): este tipo espelha o enum "organization_member_role"
// que só existirá em types.ts depois da migration 3. Tipamos manualmente para
// não depender de tabelas que ainda não existem no schema gerado.
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
  switchOrganization: (organizationId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

// TODO(multi-org-migration): remover este fallback assim que a migration 3
// estiver aplicada em produção e VITE_MULTI_ORG_ENABLED puder ficar sempre
// "true". Enquanto isso, é o que preserva o comportamento atual da FEMO
// (uma única organização implícita, dono de tudo).
const LEGACY_MEMBERSHIP: Membership = {
  organizationId: "legacy",
  organizationName: "FEMO",
  organizationSlug: "femo",
  role: "owner",
  clientLimit: null,
};

const OrganizationContext = createContext<OrganizationContextType>({
  organizationId: LEGACY_MEMBERSHIP.organizationId,
  organizationName: LEGACY_MEMBERSHIP.organizationName,
  role: LEGACY_MEMBERSHIP.role,
  clientLimit: LEGACY_MEMBERSHIP.clientLimit,
  memberships: [LEGACY_MEMBERSHIP],
  isLegacy: true,
  loading: true,
  switchOrganization: async () => {},
  refresh: async () => {},
});

export const useOrganizationContext = () => useContext(OrganizationContext);

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [memberships, setMemberships] = useState<Membership[]>([LEGACY_MEMBERSHIP]);
  const [organizationId, setOrganizationId] = useState<string | null>(LEGACY_MEMBERSHIP.organizationId);
  const [isLegacy, setIsLegacy] = useState(true);
  const [loading, setLoading] = useState(true);
  // Segunda linha de defesa contra o app "recarregar" ao voltar para a aba.
  // Os guards em App.tsx devolvem `null` enquanto loading é true, e `null`
  // DESMONTA a árvore inteira — todo estado local de formulário morre junto.
  // Isso é aceitável na primeira carga (não há nada na tela ainda), mas nunca
  // numa revalidação: ali a tela já existe e precisa continuar de pé.
  const jaCarregouUmaVez = useRef(false);

  const load = useCallback(async () => {
    if (!user) {
      setMemberships([]);
      setOrganizationId(null);
      setLoading(false);
      jaCarregouUmaVez.current = true;
      return;
    }

    // Com a flag desligada, nenhuma query nova roda: o app se comporta
    // exatamente como antes da migration multi-org existir.
    if (!MULTI_ORG_ENABLED) {
      setIsLegacy(true);
      setMemberships([LEGACY_MEMBERSHIP]);
      setOrganizationId(LEGACY_MEMBERSHIP.organizationId);
      setLoading(false);
      jaCarregouUmaVez.current = true;
      return;
    }

    // Só a primeira carga apaga a tela. Depois disso, recarrega por baixo.
    if (!jaCarregouUmaVez.current) setLoading(true);

    try {
      const [{ data: memberRows, error: membersError }, { data: profile, error: profileError }] = await Promise.all([
        (supabase.from("organization_members" as any) as any)
          .select("organization_id, role, organizations(name, slug, client_limit)")
          .eq("user_id", user.id)
          .eq("status", "active"),
        (supabase.from("profiles") as any).select("active_organization_id").eq("id", user.id).maybeSingle(),
      ]);

      if (membersError) throw membersError;
      if (profileError) throw profileError;

      const loadedMemberships: Membership[] = ((memberRows ?? []) as any[]).map((row) => ({
        organizationId: row.organization_id,
        organizationName: (row.organizations as { name: string; slug: string } | null)?.name ?? "",
        organizationSlug: (row.organizations as { name: string; slug: string } | null)?.slug ?? "",
        role: row.role,
        clientLimit: (row.organizations as { client_limit: number | null } | null)?.client_limit ?? null,
      }));

      const activeId = (profile as any)?.active_organization_id ?? null;
      const activeIsValid = activeId && loadedMemberships.some((m) => m.organizationId === activeId);

      setIsLegacy(false);
      setMemberships(loadedMemberships);
      setOrganizationId(activeIsValid ? activeId : loadedMemberships[0]?.organizationId ?? null);
    } catch {
      // As tabelas da migration multi-org ainda não existem neste ambiente
      // (ex.: VITE_MULTI_ORG_ENABLED=true num ambiente de teste sem a
      // migration aplicada). Cai para o mesmo modo legado do flag desligado
      // em vez de quebrar a tela.
      setIsLegacy(true);
      setMemberships([LEGACY_MEMBERSHIP]);
      setOrganizationId(LEGACY_MEMBERSHIP.organizationId);
    } finally {
      setLoading(false);
      jaCarregouUmaVez.current = true;
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  const switchOrganization = useCallback(
    async (newOrganizationId: string) => {
      if (!user || isLegacy) return;
      setOrganizationId(newOrganizationId);
      await (supabase.from("profiles") as any).update({ active_organization_id: newOrganizationId }).eq("id", user.id);
    },
    [user, isLegacy]
  );

  const active = memberships.find((m) => m.organizationId === organizationId) ?? null;

  return (
    <OrganizationContext.Provider
      value={{
        organizationId: active?.organizationId ?? null,
        organizationName: active?.organizationName ?? null,
        role: active?.role ?? null,
        clientLimit: active?.clientLimit ?? null,
        memberships,
        isLegacy,
        loading: authLoading || loading,
        switchOrganization,
        refresh: load,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}
