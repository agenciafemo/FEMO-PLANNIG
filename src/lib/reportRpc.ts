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

export interface MediaItem {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  timestamp?: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
}

export interface MetaInsights {
  client: string;
  instagram_id: string;
  period: { from: string; to: string };
  profile: {
    username?: string;
    name?: string;
    followers_count?: number;
    media_count?: number;
    profile_picture_url?: string;
    error?: string;
  };
  media: MediaItem[] | { error: string };
  insights_available: boolean;
  insights_note: string;
  account_insights: Array<{ name: string; values?: Array<{ value: number; end_time?: string }> }> | null;
}

/** Puxa métricas reais do Instagram do cliente (perfil, posts, alcance). */
export async function getMetaInsights(input: {
  clientId: string;
  from?: string;
  to?: string;
}): Promise<MetaInsights> {
  const { data, error } = await supabase.functions.invoke("meta-insights", {
    body: { client_id: input.clientId, from: input.from, to: input.to },
  });
  if (error) throw error;
  return data as MetaInsights;
}
