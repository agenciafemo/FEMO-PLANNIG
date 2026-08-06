// Camada de dados dos Relatórios com IA. Fala só com a Edge Function
// generate-report (que guarda a chave do Gemini como secret e lê os dados via
// RLS). Nenhuma chave ou lógica de IA vive no frontend.

import { supabase } from "@/integrations/supabase/client";

export interface ReportResult {
  analysis: string;
  dados: {
    cliente: string;
    periodo: { de: string; ate: string };
    total_posts_no_periodo: number;
    posts_por_status: Record<string, number>;
    posts_por_formato: Record<string, number>;
    publicados_no_instagram_via_norteia: number;
  };
}

export async function generateReport(input: {
  clientId: string;
  from?: string; // ISO; default: últimos 30 dias (no servidor)
  to?: string; // ISO
}): Promise<ReportResult> {
  const { data, error } = await supabase.functions.invoke("generate-report", {
    body: { client_id: input.clientId, from: input.from, to: input.to },
  });
  if (error) throw error;
  return data as ReportResult;
}
