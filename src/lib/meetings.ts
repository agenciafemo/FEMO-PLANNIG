import { supabase } from "@/integrations/supabase/client";
import { invokeEdge } from "@/lib/edgeInvoke";

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
