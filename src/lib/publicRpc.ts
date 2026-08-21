// ============================================================================
// publicRpc.ts — Wrapper central das RPCs do portal público (/c/:token).
//
// Objetivo: centralizar TODAS as chamadas de RPC do portal em um só lugar, com
// tratamento padronizado que impede "sucesso falso":
//   - callRead  : leituras. Erro do banco vira throw; lista vazia é resultado
//                 válido (não é erro).
//   - callWrite : escritas que retornam a linha persistida. Erro OU retorno
//                 vazio viram throw -> o onSuccess do react-query só dispara
//                 depois que o banco confirmou a persistência.
//   - callVoidWrite : escritas cujas RPCs retornam VOID e fazem RAISE em falha
//                 (ex.: public_delete_post_comment). Aqui "sem erro" já é
//                 sucesso, porque a própria RPC lança exceção quando nada casa.
//
// types.ts NÃO é alterado agora: os NOMES das RPCs ainda não estão no tipo
// gerado, então usamos `(supabase.rpc as any)`. Os RETORNOS são tipados
// reusando os Row das tabelas que já existem em types.ts; a única exceção é a
// tabela nova video_script_suggestions, tipada por interface local abaixo.
// >>> Regenerar types.ts a partir do staging ANTES de produção e remover os
// >>> casts `as any` (ver plano de ordem segura).
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Tables = Database["public"]["Tables"];
export type Planning = Tables["plannings"]["Row"];
export type Post = Tables["posts"]["Row"];
export type MonthlyReport = Tables["monthly_reports"]["Row"];
export type ClientDocument = Tables["client_documents"]["Row"];
export type VideoScript = Tables["video_scripts"]["Row"];
export type PostComment = Tables["post_comments"]["Row"];
export type PostEditSuggestion = Tables["post_edit_suggestions"]["Row"];
export type ReportComment = Tables["report_comments"]["Row"];

// get_public_client retorna apenas um subconjunto de colunas de clients.
export interface PublicClient {
  id: string;
  name: string;
  logo_url: string | null;
  accent_color: string | null;
  notes: string | null;
}

// Tabela nova (companheira 20260703120300) ainda não presente em types.ts.
export type VideoScriptSuggestionStatus = "pending" | "accepted" | "rejected";
export type VideoScriptField =
  | "title"
  | "spoken_text"
  | "references_notes"
  | "editing_instructions";
export interface VideoScriptSuggestion {
  id: string;
  video_script_id: string;
  planning_id: string | null;
  organization_id: string | null;
  field_name: VideoScriptField;
  original_value: string | null;
  suggested_value: string;
  status: VideoScriptSuggestionStatus;
  created_by_name: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface PlanningNpsSubmitResult {
  response_id: string;
  accepted: boolean;
  next_allowed_at: string;
}

// ----------------------------------------------------------------------------
// Primitivas
// ----------------------------------------------------------------------------
async function callRead<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) throw error;
  return data as T;
}

async function callWrite<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) throw error;
  if (data == null) throw new Error("Não foi possível salvar. Tente novamente.");
  return data as T;
}

async function callVoidWrite(fn: string, args: Record<string, unknown>): Promise<void> {
  // RPCs VOID que fazem RAISE em falha: "sem erro" já significa sucesso real.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)(fn, args);
  if (error) throw error;
}

// ----------------------------------------------------------------------------
// Leituras (get_public_*)
// ----------------------------------------------------------------------------
export async function getPublicClient(token: string): Promise<PublicClient | null> {
  const rows = await callRead<PublicClient[]>("get_public_client", { _token: token });
  return rows?.[0] ?? null;
}

export function getPublicPlannings(token: string): Promise<Planning[]> {
  return callRead<Planning[]>("get_public_plannings", { _token: token });
}

export function getPublicPosts(token: string, planningId: string): Promise<Post[]> {
  return callRead<Post[]>("get_public_posts", { _token: token, _planning_id: planningId });
}

export function getPublicPost(token: string, postId: string): Promise<Post[]> {
  return callRead<Post[]>("get_public_post", { _token: token, _post_id: postId });
}

export function getPublicReports(token: string): Promise<MonthlyReport[]> {
  return callRead<MonthlyReport[]>("get_public_reports", { _token: token });
}

export function getPublicDocuments(token: string): Promise<ClientDocument[]> {
  return callRead<ClientDocument[]>("get_public_documents", { _token: token });
}

export function getPublicVideoScripts(token: string, planningId: string): Promise<VideoScript[]> {
  return callRead<VideoScript[]>("get_public_video_scripts", {
    _token: token,
    _planning_id: planningId,
  });
}

export function getPublicAllVideoScripts(token: string): Promise<VideoScript[]> {
  return callRead<VideoScript[]>("get_public_all_video_scripts", { _token: token });
}

export function getPublicPostComments(token: string, postId: string): Promise<PostComment[]> {
  return callRead<PostComment[]>("get_public_post_comments", { _token: token, _post_id: postId });
}

export function getPublicReportComments(token: string, reportId: string): Promise<ReportComment[]> {
  return callRead<ReportComment[]>("get_public_report_comments", {
    _token: token,
    _report_id: reportId,
  });
}

export function getPublicPostSuggestions(token: string, postId: string): Promise<PostEditSuggestion[]> {
  return callRead<PostEditSuggestion[]>("get_public_post_suggestions", {
    _token: token,
    _post_id: postId,
  });
}

export function getPublicVideoScriptSuggestions(
  token: string,
  scriptId: string,
): Promise<VideoScriptSuggestion[]> {
  return callRead<VideoScriptSuggestion[]>("get_public_video_script_suggestions", {
    _token: token,
    _script_id: scriptId,
  });
}

// ----------------------------------------------------------------------------
// Escritas (public_*) — retornam a linha persistida
// ----------------------------------------------------------------------------
export function insertPostComment(
  token: string,
  postId: string,
  authorName: string | null,
  text: string | null,
  audioUrl: string | null = null,
): Promise<PostComment> {
  return callWrite<PostComment>("public_insert_post_comment", {
    _token: token,
    _post_id: postId,
    _author_name: authorName,
    _text: text,
    _audio_url: audioUrl,
  });
}

export function updatePostComment(token: string, commentId: string, text: string): Promise<PostComment> {
  return callWrite<PostComment>("public_update_post_comment", {
    _token: token,
    _comment_id: commentId,
    _text: text,
  });
}

export function deletePostComment(token: string, commentId: string): Promise<void> {
  // RETURNS VOID + RAISE em falha -> callVoidWrite.
  return callVoidWrite("public_delete_post_comment", { _token: token, _comment_id: commentId });
}

export function insertEditSuggestion(
  token: string,
  postId: string,
  fieldName: string,
  originalValue: string | null,
  suggestedValue: string,
): Promise<PostEditSuggestion> {
  return callWrite<PostEditSuggestion>("public_insert_edit_suggestion", {
    _token: token,
    _post_id: postId,
    _field_name: fieldName,
    _original_value: originalValue,
    _suggested_value: suggestedValue,
  });
}

export function insertReportComment(
  token: string,
  reportId: string,
  authorName: string | null,
  text: string | null,
  audioUrl: string | null = null,
): Promise<ReportComment> {
  return callWrite<ReportComment>("public_insert_report_comment", {
    _token: token,
    _report_id: reportId,
    _author_name: authorName,
    _text: text,
    _audio_url: audioUrl,
  });
}

/** Categorias que o cliente escolhe ao pedir correção (o quadro de produção
 *  usa isso para devolver o trabalho à pessoa certa). */
export const REVISION_REASONS: { code: string; label: string; types?: string[] }[] = [
  { code: "legenda_video", label: "Legenda do vídeo", types: ["reels"] },
  { code: "legenda_post", label: "Legenda do post", types: ["static", "carousel", "story"] },
  { code: "design", label: "Erro de design", types: ["static", "carousel", "story", "reels"] },
  { code: "portugues", label: "Erro de português" },
  { code: "edicao", label: "Edição", types: ["reels"] },
];

/** Só oferece ao cliente o que faz sentido para aquele tipo de post — não faz
 *  sentido pedir "erro de edição" num post estático. */
export function revisionReasonsFor(contentType: string | null | undefined) {
  return REVISION_REASONS.filter((r) => !r.types || r.types.includes(contentType ?? ""));
}

/** O cliente pede correção informando onde está o erro. */
export function requestPostRevision(
  token: string,
  postId: string,
  reasons: string[],
  note?: string,
): Promise<Post> {
  return callWrite<Post>("public_request_post_revision", {
    _token: token,
    _post_id: postId,
    _reasons: reasons,
    _note: note ?? null,
  });
}

export function updatePostStatus(token: string, postId: string, newStatus: string): Promise<Post> {
  return callWrite<Post>("public_update_post_status", {
    _token: token,
    _post_id: postId,
    _new_status: newStatus,
  });
}

export function updatePlanningStatus(
  token: string,
  planningId: string,
  newStatus: string,
): Promise<Planning> {
  return callWrite<Planning>("public_update_planning_status", {
    _token: token,
    _planning_id: planningId,
    _new_status: newStatus,
  });
}

export function insertVideoScriptSuggestion(
  token: string,
  scriptId: string,
  fieldName: VideoScriptField,
  originalValue: string | null,
  suggestedValue: string,
  authorName: string | null = null,
): Promise<VideoScriptSuggestion> {
  return callWrite<VideoScriptSuggestion>("public_insert_video_script_suggestion", {
    _token: token,
    _script_id: scriptId,
    _field_name: fieldName,
    _original_value: originalValue,
    _suggested_value: suggestedValue,
    _author_name: authorName,
  });
}

export async function submitPlanningNps(
  token: string,
  planningId: string,
  score: number,
  reason: string | null,
): Promise<PlanningNpsSubmitResult> {
  const rows = await callWrite<PlanningNpsSubmitResult[]>(
    "public_submit_planning_nps",
    {
      _token: token,
      _planning_id: planningId,
      _score: score,
      _reason: reason,
    },
  );

  const result = rows?.[0];
  if (!result) {
    throw new Error("nps_response_missing");
  }

  return result;
}

// ----------------------------------------------------------------------------
// Best-effort — notificação passiva de "cliente abriu o planejamento".
// NÃO mostra sucesso ao usuário; em erro apenas registra no console. Assim,
// nunca há "sucesso falso" (não há toast de sucesso associado a este fluxo).
// ----------------------------------------------------------------------------
export async function notifyPlanningViewed(token: string, planningId: string): Promise<void> {
  try {
    await callVoidWrite("public_notify_planning_viewed", {
      _token: token,
      _planning_id: planningId,
    });
  } catch (err) {
    console.warn("notifyPlanningViewed falhou (best-effort):", err);
  }
}
