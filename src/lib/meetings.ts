import { supabase } from "@/integrations/supabase/client";
import { edgeReasonCode, invokeEdge } from "@/lib/edgeInvoke";

// Tabelas de "Reuniões" ainda não estão no types.ts gerado (migration nova) —
// mesmo padrão de cast usado em src/lib/teamCalendar.ts até rodar
// `supabase gen types`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type MeetingStatus =
  | "pending"
  | "recording"
  | "transcribing"
  | "summarizing"
  /** Transcrição pronta, ata ainda não gerada. É repouso, não erro: a ata
   *  virou ação do usuário, e é aqui que toda reunião para por padrão. */
  | "transcribed"
  | "ready"
  | "failed";

export type MeetingSource = "upload" | "bot";

export interface MeetingListItem {
  id: string;
  title: string;
  status: MeetingStatus;
  source: MeetingSource;
  failure_reason: string | null;
  client_id: string | null;
  occurred_at: string;
  duration_seconds: number | null;
  summary: string | null;
}

export interface MeetingActionItem {
  id: string;
  title: string;
  suggested_assignee_id: string | null;
  suggested_due_date: string | null;
  task_id: string | null;
  position: number;
}

export interface MeetingDetail extends MeetingListItem {
  organization_id: string;
  meeting_link: string | null;
  transcript_text: string | null;
  transcript_raw: Array<{ speaker: string; text: string; start_ms: number; end_ms: number }> | null;
  decisions: string[];
  created_by: string;
  action_items: MeetingActionItem[];
}

export interface OrgMemberOption {
  user_id: string;
  display_name: string;
}

const MEETING_LIST_COLUMNS =
  "id, title, status, source, failure_reason, client_id, occurred_at, duration_seconds, summary";

export async function listMeetings(
  organizationId: string,
  filters: { clientId?: string } = {},
): Promise<MeetingListItem[]> {
  let query = (supabase as AnyClient)
    .from("meetings")
    .select(MEETING_LIST_COLUMNS)
    .eq("organization_id", organizationId)
    .order("occurred_at", { ascending: false });
  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as MeetingListItem[]) ?? [];
}

export async function getMeeting(id: string): Promise<MeetingDetail> {
  const { data, error } = await (supabase as AnyClient)
    .from("meetings")
    .select(
      "id, organization_id, title, status, source, failure_reason, client_id, meeting_link, occurred_at, duration_seconds, summary, transcript_text, transcript_raw, decisions, created_by, meeting_action_items(id, title, suggested_assignee_id, suggested_due_date, task_id, position)",
    )
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  const actionItems = ((row.meeting_action_items as MeetingActionItem[]) ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);
  return { ...(row as unknown as MeetingDetail), action_items: actionItems };
}

export async function listOrgMembers(
  organizationId: string,
): Promise<OrgMemberOption[]> {
  const membersResult = await (supabase as AnyClient)
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("status", "active");
  if (membersResult.error) throw new Error(membersResult.error.message);
  const memberIds: string[] = (membersResult.data ?? []).map(
    (row: { user_id: string }) => row.user_id,
  );
  if (memberIds.length === 0) return [];
  const profilesResult = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", memberIds);
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  return memberIds.map((userId) => {
    const profile = profilesResult.data?.find((item) => item.id === userId);
    return {
      user_id: userId,
      display_name: profile?.full_name?.trim() || "Usuário",
    };
  });
}

export async function createMeetingFromUpload(input: {
  organizationId: string;
  clientId: string | null;
  title: string;
  createdBy: string;
  file: File;
}): Promise<string> {
  const { data: inserted, error: insertError } = await (supabase as AnyClient)
    .from("meetings")
    .insert({
      organization_id: input.organizationId,
      client_id: input.clientId,
      title: input.title,
      source: "upload",
      status: "pending",
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);
  const meetingId = inserted.id as string;

  const extension = input.file.name.split(".").pop() || "webm";
  const storagePath = `${input.organizationId}/${meetingId}/gravacao.${extension}`;
  const uploadResult = await supabase.storage
    .from("meeting-recordings")
    .upload(storagePath, input.file);
  if (uploadResult.error) throw new Error(uploadResult.error.message);

  const updateResult = await (supabase as AnyClient)
    .from("meetings")
    .update({ audio_storage_path: storagePath })
    .eq("id", meetingId);
  if (updateResult.error) throw new Error(updateResult.error.message);

  const { error: transcribeError } = await invokeEdge("meeting-transcribe", {
    body: { meeting_id: meetingId },
  });
  if (transcribeError) throw new Error(transcribeError.message);

  return meetingId;
}

export async function createMeetingFromLink(input: {
  organizationId: string;
  clientId: string | null;
  teamEventId?: string | null;
  meetingLink: string;
  title: string;
  scheduledAt?: string | null;
}): Promise<string> {
  const { data, error } = await invokeEdge<{ meeting_id: string }>(
    "meeting-bot-start",
    {
      body: {
        organization_id: input.organizationId,
        client_id: input.clientId,
        team_event_id: input.teamEventId ?? null,
        meeting_link: input.meetingLink,
        title: input.title,
        scheduled_at: input.scheduledAt ?? null,
      },
    },
  );
  if (error) throw new Error(error.message);
  if (!data?.meeting_id) throw new Error("meeting_bot_start_failed");
  return data.meeting_id;
}

export type StopMeetingRecordingStatus =
  | "transcribed"
  | "transcript_pending"
  | "failed"
  | "stopping";

export async function stopMeetingRecording(
  meetingId: string,
): Promise<StopMeetingRecordingStatus> {
  const { data, error } = await invokeEdge<{ status?: string }>(
    "meeting-bot-stop",
    { body: { meeting_id: meetingId } },
  );
  if (error) throw new Error(error.message);
  return (data?.status ?? "stopping") as StopMeetingRecordingStatus;
}

/** Motivos que o meeting-summarize sabe distinguir, em português. O código
 *  técnico continua aparecendo entre parênteses — é o que torna um relato de
 *  erro do usuário acionável sem precisar abrir os logs. */
const MOTIVO_ATA: Record<string, string> = {
  gemini_request_failed: "A IA não respondeu.",
  gemini_empty_response: "A IA respondeu vazio.",
  gemini_invalid_json: "A IA respondeu num formato inesperado.",
  gemini_invalid_response: "A IA respondeu num formato inesperado.",
  missing_transcript: "Esta reunião não tem transcrição para resumir.",
  meeting_summarize_forbidden: "Você não tem permissão para gerar a ata desta reunião.",
  action_items_save_failed: "A ata saiu, mas os itens de ação não puderam ser salvos.",
  meeting_save_failed: "A ata saiu, mas não pôde ser salva.",
  meeting_not_found: "Reunião não encontrada.",
};

/** Frase em português para um `failure_reason` de ata. Usada tanto no toast
 *  quanto no aviso da tela, para as duas contarem a mesma história. */
export function descreverMotivoAta(code: string | null | undefined): string {
  if (!code) return "Não foi possível gerar a ata.";
  return MOTIVO_ATA[code] ?? "Não foi possível gerar a ata.";
}

/**
 * Gera (ou refaz) a ata por IA de uma reunião já transcrita.
 *
 * Deixou de ser encadeada na transcrição de propósito: o Gemini é o passo mais
 * frágil da cadeia, e enquanto ele fazia parte dela uma ata que não saía
 * derrubava a reunião inteira para "Falhou" — mesmo com a transcrição salva.
 */
export async function generateMeetingMinutes(meetingId: string): Promise<void> {
  const { error } = await invokeEdge("meeting-summarize", {
    body: { meeting_id: meetingId },
  });
  if (!error) return;

  const code = await edgeReasonCode(error);
  if (!code) throw new Error(error.message);
  const frase = MOTIVO_ATA[code] ?? "Não foi possível gerar a ata.";
  throw new Error(`${frase} (${code})`);
}

export async function createTaskFromActionItem(input: {
  actionItemId: string;
  meetingId: string;
  organizationId: string;
  clientId: string | null;
  title: string;
  assigneeId: string;
  dueDate: string;
  createdBy: string;
}): Promise<void> {
  const { data: task, error: taskError } = await (supabase as AnyClient)
    .from("tasks")
    .insert({
      organization_id: input.organizationId,
      client_id: input.clientId,
      title: input.title.trim(),
      assignee_id: input.assigneeId,
      due_date: input.dueDate,
      priority: "medium",
      status: "todo",
      tags: ["reuniao"],
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (taskError) throw new Error(taskError.message);

  const updateResult = await (supabase as AnyClient)
    .from("meeting_action_items")
    .update({ task_id: task.id })
    .eq("id", input.actionItemId);
  if (updateResult.error) throw new Error(updateResult.error.message);

  if (input.assigneeId !== input.createdBy) {
    await (supabase as AnyClient)
      .from("notifications")
      .insert({
        organization_id: input.organizationId,
        user_id: input.assigneeId,
        title: `✅ Nova tarefa de reunião`,
        body: input.title.trim(),
        type: "meeting_task",
        read: false,
      })
      .then(() => {}, () => {});
  }
}

// Aviso de consentimento (LGPD): mostrado antes da primeira reunião
// transcrita de cada organização. Registrado em `meeting_consents` (quem,
// quando) — não é uma política de retenção nem substitui aviso formal aos
// clientes, mas dá um registro real de quem confirmou o aviso, ao contrário
// de um flag em localStorage (que some ao limpar o navegador e não diz quem
// clicou). A primeira pessoa que confirma libera o recurso para toda a
// organização, mesmo comportamento visível de antes.
export async function hasMeetingConsent(organizationId: string): Promise<boolean> {
  const { data, error } = await (supabase as AnyClient)
    .from("meeting_consents")
    .select("id")
    .eq("organization_id", organizationId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

export async function recordMeetingConsent(
  organizationId: string,
  userId: string,
): Promise<void> {
  const { error } = await (supabase as AnyClient)
    .from("meeting_consents")
    .insert({ organization_id: organizationId, user_id: userId });
  if (error) throw new Error(error.message);
}
