import { supabase } from "@/integrations/supabase/client";

export type NpsClassification = "promoter" | "passive" | "detractor";

export interface NpsDashboardFilters {
  organizationId: string;
  from?: string | null;
  to?: string | null;
  clientId?: string | null;
  classification?: NpsClassification | null;
}

export interface NpsResponseFilters extends NpsDashboardFilters {
  search?: string | null;
  limit?: number;
  offset?: number;
}

export interface ClassificationDistribution {
  promoter: number;
  passive: number;
  detractor: number;
}

export interface PeriodDistributionItem {
  period: string;
  label: string;
  total: number;
  average_score: number | null;
}

export interface PlanningNpsDashboard {
  average_score: number | null;
  total_responses: number;
  promoter_count: number;
  passive_count: number;
  detractor_count: number;
  positive_count: number;
  neutral_count: number;
  negative_count: number;
  last_response_at: string | null;
  classification_distribution: ClassificationDistribution;
  period_distribution: PeriodDistributionItem[];
}

export interface PlanningNpsResponse {
  response_id: string;
  client_id: string | null;
  client_name: string | null;
  planning_id: string;
  planning_label: string;
  score: number;
  classification: NpsClassification;
  reason: string | null;
  created_at: string;
  total_count: number;
}

export interface NpsClientOption {
  id: string;
  name: string;
}

interface UntypedRpcResult {
  data: unknown;
  error: { message?: string } | null;
}

type UntypedRpc = (name: string, args: Record<string, unknown>) => PromiseLike<UntypedRpcResult>;

const untypedSupabase = supabase as unknown as { rpc: UntypedRpc };

const emptyDashboard: PlanningNpsDashboard = {
  average_score: null,
  total_responses: 0,
  promoter_count: 0,
  passive_count: 0,
  detractor_count: 0,
  positive_count: 0,
  neutral_count: 0,
  negative_count: 0,
  last_response_at: null,
  classification_distribution: {
    promoter: 0,
    passive: 0,
    detractor: 0,
  },
  period_distribution: [],
};

function dashboardArgs(filters: NpsDashboardFilters) {
  return {
    _organization_id: filters.organizationId,
    _from: filters.from ?? null,
    _to: filters.to ?? null,
    _client_id: filters.clientId ?? null,
    _classification: filters.classification ?? null,
  };
}

export async function getPlanningNpsDashboard(
  filters: NpsDashboardFilters,
): Promise<PlanningNpsDashboard> {
  const { data, error } = await untypedSupabase.rpc("get_planning_nps_dashboard", dashboardArgs(filters));

  if (error) {
    throw new Error("reviews_dashboard_load_failed");
  }

  if (!Array.isArray(data) || data.length === 0) {
    return emptyDashboard;
  }

  return data[0] as PlanningNpsDashboard;
}

export async function getPlanningNpsResponses(
  filters: NpsResponseFilters,
): Promise<PlanningNpsResponse[]> {
  const { data, error } = await untypedSupabase.rpc("get_planning_nps_responses", {
    ...dashboardArgs(filters),
    _search: filters.search?.trim() || null,
    _limit: filters.limit ?? 25,
    _offset: filters.offset ?? 0,
  });

  if (error) {
    throw new Error("reviews_responses_load_failed");
  }

  return Array.isArray(data) ? (data as PlanningNpsResponse[]) : [];
}

export async function getPlanningNpsClientOptions(organizationId: string): Promise<NpsClientOption[]> {
  const responses = await getPlanningNpsResponses({
    organizationId,
    limit: 100,
    offset: 0,
  });

  const uniqueClients = new Map<string, string>();

  responses.forEach((response) => {
    if (response.client_id && response.client_name) {
      uniqueClients.set(response.client_id, response.client_name);
    }
  });

  return Array.from(uniqueClients, ([id, name]) => ({ id, name })).sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
}
