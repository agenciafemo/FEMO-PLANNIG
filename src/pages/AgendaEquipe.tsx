import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays, addWeeks, format, isSameDay, parseISO, startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock, Link as LinkIcon, Loader2,
  LogOut, MapPin, Plus, Trash2, UserRound, Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  createTeamEvent, deleteTeamEvent, loadWeekEvents, setRsvp, type TeamEvent,
} from "@/lib/teamCalendar";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
type Member = { user_id: string; display_name: string; avatar_url: string | null };

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export default function AgendaEquipe() {
  const { user } = useAuth();
  const { organizationId, role } = useOrganization();
  const queryClient = useQueryClient();
  const canEdit = role === "owner" || role === "admin" || role === "manager" || role === "editor";

  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = useMemo(() => addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset), [weekOffset]);
  const weekEnd = addDays(weekStart, 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const [filterUser, setFilterUser] = useState<string>("all"); // all | mine | userId
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<TeamEvent | null>(null);

  const { data: members = [] } = useQuery({
    queryKey: ["cal-members", organizationId],
    queryFn: async () => {
      const { data } = await (supabase as AnyClient).rpc("get_task_assignees", { _organization_id: organizationId });
      return (data as Member[]) ?? [];
    },
    enabled: !!organizationId,
  });
  const memberName = (id: string) => members.find((m) => m.user_id === id)?.display_name ?? "Alguém";

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["team-events", organizationId, weekStart.toISOString()],
    queryFn: () => loadWeekEvents(organizationId!, weekStart.toISOString(), weekEnd.toISOString()),
    enabled: !!organizationId,
  });

  // Filtro por pessoa (agenda dos outros).
  const filtered = events.filter((e) => {
    if (filterUser === "all") return true;
    const uid = filterUser === "mine" ? user?.id : filterUser;
    return e.team_event_attendees.some((a) => a.user_id === uid && a.response === "accepted");
  });
  const eventsForDay = (day: Date) => filtered
    .filter((e) => isSameDay(parseISO(e.starts_at), day))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  // ---- Criar evento ----
  const [form, setForm] = useState({
    title: "", date: format(new Date(), "yyyy-MM-dd"), start: "09:00", end: "10:00",
    location: "", link: "", description: "", attendees: [] as string[],
  });
  const resetForm = () => setForm({
    title: "", date: format(new Date(), "yyyy-MM-dd"), start: "09:00", end: "10:00",
    location: "", link: "", description: "", attendees: [],
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.title.trim() || !form.date) throw new Error("Preencha título e data.");
      const startsAt = new Date(`${form.date}T${form.start || "09:00"}:00`).toISOString();
      const endsAt = form.end ? new Date(`${form.date}T${form.end}:00`).toISOString() : null;
      await createTeamEvent({
        organizationId: organizationId!, createdBy: user!.id,
        title: form.title.trim(), description: form.description.trim() || null,
        location: form.location.trim() || null, meetingLink: form.link.trim() || null,
        startsAt, endsAt, allDay: false, attendeeIds: form.attendees,
      });
    },
    onSuccess: () => {
      toast.success("Evento criado! Participantes avisados.");
      setCreateOpen(false); resetForm();
      queryClient.invalidateQueries({ queryKey: ["team-events", organizationId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const rsvp = useMutation({
    mutationFn: (input: { eventId: string; response: "accepted" | "declined" }) =>
      setRsvp({ eventId: input.eventId, organizationId: organizationId!, userId: user!.id, response: input.response }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-events", organizationId] });
      setDetail(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteTeamEvent(id),
    onSuccess: () => {
      toast.success("Evento excluído.");
      queryClient.invalidateQueries({ queryKey: ["team-events", organizationId] });
      setDetail(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const myResponse = (e: TeamEvent) => e.team_event_attendees.find((a) => a.user_id === user?.id)?.response ?? null;

  return (
    <div className="nrt-surface -mx-4 -mt-4 min-h-[calc(100vh-4rem)] px-4 pb-10 pt-6 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-8">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <CalendarDays className="h-4 w-4" /> Agenda da equipe
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Calendário da Equipe</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filterUser} onValueChange={setFilterUser}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda a equipe</SelectItem>
                <SelectItem value="mine">Minha agenda</SelectItem>
                {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.display_name}</SelectItem>)}
              </SelectContent>
            </Select>
            {canEdit && (
              <Button className="gap-2" onClick={() => { resetForm(); setCreateOpen(true); }}>
                <Plus className="h-4 w-4" /> Novo evento
              </Button>
            )}
          </div>
        </div>

        {/* Navegação da semana */}
        <div className="mb-4 flex items-center gap-3">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setWeekOffset((w) => w - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">
            {format(weekStart, "d 'de' MMM", { locale: ptBR })} – {format(addDays(weekStart, 6), "d 'de' MMM yyyy", { locale: ptBR })}
          </span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setWeekOffset((w) => w + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>Hoje</Button>
        </div>

        {/* Grade da semana */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="grid grid-flow-col auto-cols-[minmax(180px,1fr)] gap-2 overflow-x-auto pb-4 xl:grid-flow-row xl:grid-cols-7">
            {days.map((day, i) => {
              const today = isSameDay(day, new Date());
              const dayEvents = eventsForDay(day);
              return (
                <div key={day.toISOString()} className={cn("rounded-xl border p-2", today ? "border-brand/40 bg-brand-soft/20" : "border-border/70 bg-card/40")}>
                  <div className="mb-2 text-center">
                    <p className="text-[11px] font-medium uppercase text-muted-foreground">{WEEKDAYS[i]}</p>
                    <p className={cn("text-lg font-semibold tabular-nums", today && "text-brand")}>{format(day, "d")}</p>
                  </div>
                  <div className="space-y-1.5">
                    {dayEvents.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => setDetail(e)}
                        className="w-full rounded-lg bg-brand/10 px-2 py-1.5 text-left transition-colors hover:bg-brand/20"
                      >
                        <p className="text-[11px] font-semibold tabular-nums text-brand">{format(parseISO(e.starts_at), "HH:mm")}</p>
                        <p className="truncate text-xs font-medium">{e.title}</p>
                      </button>
                    ))}
                    {dayEvents.length === 0 && <p className="py-2 text-center text-[10px] text-muted-foreground/50">—</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Diálogo: novo evento */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>Novo evento / reunião</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={(ev) => { ev.preventDefault(); create.mutate(); }}>
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Ex.: Reunião de planejamento" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5"><Label className="text-xs">Data</Label><Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Início</Label><Input type="time" value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Fim</Label><Input type="time" value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label className="text-xs">Local</Label><Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Sala / escritório" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Link da reunião</Label><Input value={form.link} onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))} placeholder="https://meet…" /></div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Descrição</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs"><Users className="h-3.5 w-3.5" /> Participantes (entram já confirmados)</Label>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border/70 p-2">
                {members.filter((m) => m.user_id !== user?.id).map((m) => (
                  <label key={m.user_id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/50">
                    <Checkbox
                      checked={form.attendees.includes(m.user_id)}
                      onCheckedChange={(c) => setForm((f) => ({
                        ...f,
                        attendees: c === true ? [...f.attendees, m.user_id] : f.attendees.filter((id) => id !== m.user_id),
                      }))}
                    />
                    {m.display_name}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <Button type="submit" disabled={create.isPending || !form.title.trim()}>
                {create.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Criar evento
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Diálogo: detalhe do evento */}
      <Dialog open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null); }}>
        <DialogContent className="max-w-md">
          {detail && (
            <>
              <DialogHeader><DialogTitle>{detail.title}</DialogTitle></DialogHeader>
              <div className="space-y-2 text-sm">
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {format(parseISO(detail.starts_at), "EEEE, d 'de' MMM · HH:mm", { locale: ptBR })}
                  {detail.ends_at ? ` – ${format(parseISO(detail.ends_at), "HH:mm")}` : ""}
                </p>
                {detail.location && <p className="flex items-center gap-2 text-muted-foreground"><MapPin className="h-4 w-4" /> {detail.location}</p>}
                {detail.meeting_link && (
                  <a href={detail.meeting_link} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-brand hover:underline">
                    <LinkIcon className="h-4 w-4" /> Entrar na reunião
                  </a>
                )}
                {detail.description && <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-2 text-foreground/90">{detail.description}</p>}

                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Users className="h-3.5 w-3.5" /> Participantes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.team_event_attendees.map((a) => (
                      <span key={a.user_id} className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]", a.response === "accepted" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground line-through")}>
                        <UserRound className="h-3 w-3" /> {memberName(a.user_id)}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  {myResponse(detail) === "accepted" ? (
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={rsvp.isPending} onClick={() => rsvp.mutate({ eventId: detail.id, response: "declined" })}>
                      <LogOut className="h-4 w-4" /> Sair do evento
                    </Button>
                  ) : (
                    <Button size="sm" className="gap-1.5" disabled={rsvp.isPending} onClick={() => rsvp.mutate({ eventId: detail.id, response: "accepted" })}>
                      Confirmar presença
                    </Button>
                  )}
                  {(canEdit || detail.created_by === user?.id) && (
                    <Button size="sm" variant="ghost" className="ml-auto gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(detail.id)}>
                      <Trash2 className="h-4 w-4" /> Excluir
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
