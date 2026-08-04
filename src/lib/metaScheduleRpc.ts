// ============================================================================
// metaScheduleRpc.ts — Camada de dados da Programação (fila de publicação).
//
// Fala só com as RPCs SECURITY DEFINER validadas (create/cancel/get_scheduled_posts)
// e com a Edge Function meta-publish (worker). NUNCA SELECT direto em
// meta_scheduled_posts (a RLS + REVOKE fecham a tabela; a leitura é pela RPC).
// Mesmo dispatch cast (supabase.rpc as any) já usado em vaultRpc/metaRpc.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";

export interface ScheduledPost {
  id: string;
  organization_id: string;
  client_id: string;
  connection_id: string;
  post_id: string | null;
  media_type: string; // image (v1)
  image_url: string;
  caption: string;
  scheduled_for: string; // ISO
  status: string; // queued | processing | published | failed | canceled
  instagram_media_id: string | null;
  permalink: string | null;
  error_code: string | null;
  attempts: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** Itens da janela do calendário (por data, opcionalmente por cliente). */
export async function getScheduledPosts(
  fromIso: string,
  toIso: string,
  clientId?: string | null,
): Promise<ScheduledPost[]> {
  const { data, error } = await (supabase.rpc as any)("get_scheduled_posts", {
    _from: fromIso,
    _to: toIso,
    _client_id: clientId ?? null,
  });
  if (error) throw error;
  return (data ?? []) as ScheduledPost[];
}

/**
 * Enfileira uma publicação. scheduledFor no passado/agora = "publicar agora"
 * (o worker pega no próximo ciclo / no invoke imediato). Só quem gerencia a
 * conexão consegue (a RPC valida). Devolve o id do item na fila.
 */
export async function createScheduledPost(input: {
  clientId: string;
  connectionId: string;
  imageUrl: string;
  caption?: string;
  scheduledFor?: string; // ISO; default agora (no servidor)
  postId?: string | null;
}): Promise<string> {
  const { data, error } = await (supabase.rpc as any)("create_scheduled_post", {
    _client_id: input.clientId,
    _connection_id: input.connectionId,
    _image_url: input.imageUrl,
    _caption: input.caption ?? "",
    _scheduled_for: input.scheduledFor ?? new Date().toISOString(),
    _post_id: input.postId ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Cancela um item da fila (só 'queued' ou 'failed'). */
export async function cancelScheduledPost(id: string): Promise<void> {
  const { error } = await (supabase.rpc as any)("cancel_scheduled_post", { _id: id });
  if (error) throw error;
}

/**
 * Aciona o worker de publicação agora (usado logo após "publicar agora").
 * O worker processa os itens já vencidos; devolve um resumo.
 */
export async function runPublishWorker(): Promise<{
  processed: number;
  published: number;
  failed: number;
}> {
  const { data, error } = await supabase.functions.invoke("meta-publish", { body: {} });
  if (error) throw error;
  return data as { processed: number; published: number; failed: number };
}
