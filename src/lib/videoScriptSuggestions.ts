// ============================================================================
// videoScriptSuggestions.ts — Camada de dados da AGÊNCIA (autenticada) para as
// sugestões de correção de roteiro enviadas pelo cliente no portal público.
//
// - listVideoScriptSuggestions: leitura direta da tabela video_script_suggestions
//   (uso autenticado; a RLS `org_members_select_vss` já restringe a membros da
//   organização, então não há vazamento entre agências).
// - applyVideoScriptSuggestion / rejectVideoScriptSuggestion: chamam as RPCs
//   internas SECURITY DEFINER apply_/reject_video_script_suggestion.
//
// Este módulo NÃO mostra toast e NÃO trata UI: apenas LANÇA erro para o
// componente decidir como exibir (onError do react-query, etc.).
//
// A tabela e as RPCs já estão tipadas no types.ts (gerado do staging). Os
// retornos são convertidos para a interface VideoScriptSuggestion de
// publicRpc.ts (narrow de field_name/status para os unions do domínio).
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import type { VideoScriptSuggestion } from "./publicRpc";

export type { VideoScriptSuggestion } from "./publicRpc";

// Lista as sugestões de roteiro de um planejamento (mais recentes primeiro).
// A RLS restringe automaticamente aos membros da organização do planejamento.
export async function listVideoScriptSuggestions(
  planningId: string,
): Promise<VideoScriptSuggestion[]> {
  const { data, error } = await supabase
    .from("video_script_suggestions")
    .select("*")
    .eq("planning_id", planningId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as VideoScriptSuggestion[];
}

// Aceita e aplica a sugestão no roteiro (atômico, via RPC). Retorna a linha
// atualizada (status 'accepted'); lança se a RPC falhar ou não retornar linha.
export async function applyVideoScriptSuggestion(
  suggestionId: string,
): Promise<VideoScriptSuggestion> {
  const { data, error } = await supabase.rpc("apply_video_script_suggestion", {
    _suggestion_id: suggestionId,
  });
  if (error) throw error;
  if (data == null) throw new Error("Não foi possível aplicar a sugestão. Tente novamente.");
  return data as VideoScriptSuggestion;
}

// Rejeita a sugestão (status 'rejected', sem alterar o roteiro). Retorna a
// linha atualizada; lança se a RPC falhar ou não retornar linha.
export async function rejectVideoScriptSuggestion(
  suggestionId: string,
): Promise<VideoScriptSuggestion> {
  const { data, error } = await supabase.rpc("reject_video_script_suggestion", {
    _suggestion_id: suggestionId,
  });
  if (error) throw error;
  if (data == null) throw new Error("Não foi possível rejeitar a sugestão. Tente novamente.");
  return data as VideoScriptSuggestion;
}
