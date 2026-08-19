import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type Attendee = { user_id: string; response: "accepted" | "declined" };

export type TeamEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  meeting_link: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  created_by: string;
  team_event_attendees: Attendee[];
};

export async function loadWeekEvents(
  organizationId: string,
  fromIso: string,
  toIso: string,
): Promise<TeamEvent[]> {
  const { data, error } = await (supabase as AnyClient)
    .from("team_events")
    .select("id, title, description, location, meeting_link, starts_at, ends_at, all_day, created_by, team_event_attendees(user_id, response)")
    .eq("organization_id", organizationId)
    .gte("starts_at", fromIso)
    .lte("starts_at", toIso)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as TeamEvent[]) ?? [];
}

export async function createTeamEvent(input: {
  organizationId: string;
  createdBy: string;
  title: string;
  description: string | null;
  location: string | null;
  meetingLink: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  attendeeIds: string[]; // participantes (entram como "accepted")
}): Promise<void> {
  const { data: ev, error } = await (supabase as AnyClient)
    .from("team_events")
    .insert({
      organization_id: input.organizationId,
      created_by: input.createdBy,
      title: input.title,
      description: input.description,
      location: input.location,
      meeting_link: input.meetingLink,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      all_day: input.allDay,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Sempre inclui o criador + os convidados, todos aceitos automaticamente.
  const ids = Array.from(new Set([input.createdBy, ...input.attendeeIds]));
  const rows = ids.map((uid) => ({
    event_id: ev.id,
    organization_id: input.organizationId,
    user_id: uid,
    response: "accepted",
  }));
  if (rows.length > 0) {
    await (supabase as AnyClient).from("team_event_attendees").insert(rows);
  }

  // Notificação no sininho para os convidados.
  try {
    const notifs = ids
      .filter((uid) => uid !== input.createdBy)
      .map((uid) => ({
        organization_id: input.organizationId,
        user_id: uid,
        title: `📅 Novo evento: ${input.title}`,
        body: new Date(input.startsAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }),
        type: "team_event",
        read: false,
      }));
    if (notifs.length > 0) await (supabase as AnyClient).from("notifications").insert(notifs);
  } catch { /* best-effort */ }
}

// Sair do evento (declined) ou voltar (accepted) — a própria pessoa.
export async function setRsvp(input: {
  eventId: string;
  organizationId: string;
  userId: string;
  response: "accepted" | "declined";
}): Promise<void> {
  const { error } = await (supabase as AnyClient)
    .from("team_event_attendees")
    .upsert(
      {
        event_id: input.eventId,
        organization_id: input.organizationId,
        user_id: input.userId,
        response: input.response,
      },
      { onConflict: "event_id,user_id" },
    );
  if (error) throw new Error(error.message);
}

export async function deleteTeamEvent(id: string): Promise<void> {
  const { error } = await (supabase as AnyClient).from("team_events").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
