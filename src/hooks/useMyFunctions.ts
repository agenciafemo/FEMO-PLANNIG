import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";

export type TeamFunctionTag = {
  id: string;
  organizationId: string;
  name: string;
  color: string;
};

type MemberFunctionRow = {
  tag_id: string;
};

type FunctionTagRow = {
  id: string;
  organization_id: string;
  name: string;
  color: string;
};

type QueryError = { message: string; code?: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };

interface FunctionFilterBuilder<T> extends PromiseLike<QueryResult<T>> {
  select(columns?: string): FunctionFilterBuilder<T>;
  eq(column: string, value: unknown): FunctionFilterBuilder<T>;
  in(column: string, values: readonly unknown[]): FunctionFilterBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): FunctionFilterBuilder<T>;
}

const functionSupabase = supabase as unknown as {
  from<T>(relation: string): FunctionFilterBuilder<T>;
};

async function loadMyFunctions(organizationId: string, userId: string): Promise<TeamFunctionTag[]> {
  const assignmentsResult = await functionSupabase
    .from<MemberFunctionRow[]>("team_member_functions")
    .select("tag_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId);

  if (assignmentsResult.error) throw assignmentsResult.error;

  const tagIds = (assignmentsResult.data ?? []).map((assignment) => assignment.tag_id);
  if (tagIds.length === 0) return [];

  const tagsResult = await functionSupabase
    .from<FunctionTagRow[]>("team_function_tags")
    .select("id, organization_id, name, color")
    .eq("organization_id", organizationId)
    .in("id", tagIds)
    .order("name", { ascending: true });

  if (tagsResult.error) throw tagsResult.error;

  return (tagsResult.data ?? []).map((tag) => ({
    id: tag.id,
    organizationId: tag.organization_id,
    name: tag.name,
    color: tag.color,
  }));
}

/**
 * Retorna as classificações de trabalho do usuário logado na organização ativa.
 * Essas funções não são permissões e, por si só, não restringem acesso a dados.
 */
export function useMyFunctions() {
  const { user } = useAuth();
  const { organizationId, isLegacy } = useOrganization();

  const query = useQuery({
    queryKey: ["my-functions", organizationId, user?.id],
    queryFn: () => loadMyFunctions(organizationId!, user!.id),
    enabled: Boolean(user && organizationId && !isLegacy),
  });

  return {
    ...query,
    functions: query.data ?? [],
  };
}
