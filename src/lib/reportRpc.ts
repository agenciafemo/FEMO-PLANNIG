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
  // Métricas reais do Instagram que a IA usou (quando enviadas). null se não.
  metricas?: {
    seguidores: number | null;
    total_de_posts_na_conta: number | null;
    alcance_no_periodo: number | null;
    engajamento_total_dos_posts_recentes: number;
    posts_recentes_analisados: number;
  } | null;
}

export async function generateReport(input: {
  clientId: string;
  from?: string; // ISO; default: últimos 30 dias (no servidor)
  to?: string; // ISO
  insights?: MetaInsights | null; // métricas já buscadas, para a IA analisar
}): Promise<ReportResult> {
  const { data, error } = await supabase.functions.invoke("generate-report", {
    body: {
      client_id: input.clientId,
      from: input.from,
      to: input.to,
      insights: input.insights ?? undefined,
    },
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
  media_url?: string;
  thumbnail_url?: string;
}

export interface DemoEntry {
  chave: string;
  valor: number;
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
  reach_total: number | null; // alcance total do período (contas únicas)
  views_total: number | null; // visualizações totais (sem deduplicar)
  previous_reach_total: number | null; // alcance do período de comparação
  previous_views_total: number | null; // visualizações do período de comparação
  account_insights: Array<{ name: string; values?: Array<{ value: number; end_time?: string }> }> | null;
  new_followers: Array<{ value: number; end_time?: string }> | null;
  demographics: { genero: DemoEntry[]; idade: DemoEntry[]; cidade: DemoEntry[] } | null;
  facebook: {
    page_id?: string;
    name?: string | null;
    followers?: number | null;
    engagement?: number | null;
    reach?: number | null;
    views?: number | null;
    note?: string;
  } | null;
}

/** Puxa métricas reais do Instagram do cliente (perfil, posts, alcance). */
export async function getMetaInsights(input: {
  clientId: string;
  from?: string;
  to?: string;
  compareFrom?: string;
  compareTo?: string;
}): Promise<MetaInsights> {
  const { data, error } = await supabase.functions.invoke("meta-insights", {
    body: {
      client_id: input.clientId,
      from: input.from,
      to: input.to,
      compare_from: input.compareFrom,
      compare_to: input.compareTo,
    },
  });
  if (error) throw error;
  return data as MetaInsights;
}
