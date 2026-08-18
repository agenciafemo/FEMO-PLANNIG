import { supabase } from "@/integrations/supabase/client";

// Histórico de relatórios por cliente (persistido pela função generate-report).
export type ReportHistoryItem = {
  id: string;
  period_from: string | null;
  period_to: string | null;
  analysis: string | null;
  // dados/metricas são JSONB — formato do ReportResult (reportRpc.ts).
  dados: Record<string, unknown> | null;
  metricas: Record<string, unknown> | null;
  created_at: string;
};

export async function loadReportHistory(
  organizationId: string,
  clientId: string,
): Promise<ReportHistoryItem[]> {
  const { data, error } = await (supabase
    .from("client_report_history" as never)
    .select("id, period_from, period_to, analysis, dados, metricas, created_at")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(20) as unknown as Promise<{ data: unknown; error: { message: string } | null }>);
  if (error) throw new Error(error.message);
  return (data as ReportHistoryItem[]) ?? [];
}
