import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertCircle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { usePersistedState } from "@/hooks/usePersistedState";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type ClientOption = { id: string; name: string };

type DatabaseError = { code?: string; message: string };
type QueryResult<T> = { data: T[] | null; error: DatabaseError | null };

interface QueryBuilder<T> extends PromiseLike<QueryResult<T>> {
  select(columns?: string): QueryBuilder<T>;
  eq(column: string, value: unknown): QueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>;
  insert(values: Record<string, unknown>): QueryBuilder<T>;
  update(values: Record<string, unknown>): QueryBuilder<T>;
  delete(): QueryBuilder<T>;
}

interface UntypedDatabaseClient {
  from<T>(table: string): QueryBuilder<T>;
}

const calendarDb = supabase as unknown as UntypedDatabaseClient;

type CatalogRow = {
  id: string;
  title?: string | null;
  name?: string | null;
  category?: string | null;
  month?: number | null;
  day?: number | null;
  recurring?: boolean | null;
  recurrence_rule?: string | null;
  recurrence_kind?: string | null;
  weekday?: number | null;
  occurrence?: number | null;
  offset_days?: number | null;
  color?: string | null;
  active?: boolean | null;
};

type EventRow = {
  id: string;
  client_id?: string | null;
  title: string;
  event_date?: string | null;
  starts_at?: string | null;
  event_type?: string | null;
  color?: string | null;
  note?: string | null;
  description?: string | null;
};

type CalendarItem = {
  id: string;
  recordId?: string;
  title: string;
  date: Date;
  category: string;
  color: string;
  kind: "commemorative" | "event";
  note?: string;
  eventType?: CalendarEventType;
};

type CalendarEventType = "personalizado" | "campanha" | "comemorativa";

type EventDraft = {
  id?: string;
  title: string;
  date: string;
  eventType: CalendarEventType;
  color: string;
  note: string;
};

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const CATEGORY_COLORS: Record<string, string> = {
  nacional: "#2563EB",
  varejo: "#7C3AED",
  sazonal: "#D97706",
  relacionamento: "#0F766E",
};

const LEGEND = [
  { label: "Nacional", color: CATEGORY_COLORS.nacional },
  { label: "Varejo", color: CATEGORY_COLORS.varejo },
  { label: "Sazonal", color: CATEGORY_COLORS.sazonal },
  { label: "Evento do cliente", color: "#0F766E" },
];

function isMissingRelation(error: DatabaseError | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205" ||
    /does not exist|schema cache|could not find/i.test(error.message ?? "")
  );
}

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function nthWeekday(year: number, month: number, isoWeekday: number, occurrence: number): Date {
  const first = new Date(year, month - 1, 1);
  const targetJsDay = isoWeekday % 7;
  const offset = (targetJsDay - first.getDay() + 7) % 7;
  return new Date(year, month - 1, 1 + offset + (occurrence - 1) * 7);
}

function resolveCatalogDate(row: CatalogRow, year: number): Date | null {
  const rule = row.recurrence_rule ?? row.recurrence_kind ?? "fixed";

  if ((rule === "fixed" || rule === "fixed_date") && row.month && row.day) {
    return new Date(year, row.month - 1, row.day);
  }

  if (rule === "easter") return easterSunday(year);
  if (rule === "carnival") return addDays(easterSunday(year), -47);
  if (rule === "mothers_day") return nthWeekday(year, 5, 7, 2);
  if (rule === "fathers_day") return nthWeekday(year, 8, 7, 2);
  if (rule === "black_friday") return addDays(nthWeekday(year, 11, 4, 4), 1);

  if (rule === "easter_offset") {
    return addDays(easterSunday(year), row.offset_days ?? 0);
  }

  if (rule === "nth_weekday" && row.month && row.weekday && row.occurrence) {
    return addDays(
      nthWeekday(year, row.month, row.weekday, row.occurrence),
      row.offset_days ?? 0,
    );
  }

  return null;
}

function normalizeCatalog(rows: CatalogRow[], year: number): CalendarItem[] {
  return rows.flatMap((row) => {
    if (row.active === false || row.recurring === false) return [];
    const date = resolveCatalogDate(row, year);
    const title = row.title ?? row.name;
    if (!date || !title) return [];
    const category = row.category?.toLowerCase() ?? "sazonal";
    return [{
      id: `date-${row.id}-${year}`,
      title,
      date,
      category,
      color: row.color ?? CATEGORY_COLORS[category] ?? CATEGORY_COLORS.sazonal,
      kind: "commemorative" as const,
    }];
  });
}

function normalizeEvents(rows: EventRow[], clientId: string): CalendarItem[] {
  return rows.flatMap((row) => {
    if (row.client_id != null && row.client_id !== clientId) return [];
    const rawDate = row.event_date ?? row.starts_at?.slice(0, 10);
    if (!rawDate) return [];
    const eventType: CalendarEventType =
      row.event_type === "campanha" || row.event_type === "campaign"
        ? "campanha"
        : row.event_type === "comemorativa"
          ? "comemorativa"
          : "personalizado";
    return [{
      id: `event-${row.id}`,
      recordId: row.id,
      title: row.title,
      date: parseISO(rawDate),
      category: eventType,
      color: row.color ?? "#0F766E",
      kind: "event" as const,
      note: row.note ?? row.description ?? undefined,
      eventType,
    }];
  });
}

async function getCommemorativeDates(year: number): Promise<CalendarItem[]> {
  const current = await calendarDb.from<CatalogRow>("commemorative_dates").select("*");
  if (!current.error) return normalizeCatalog(current.data ?? [], year);
  if (!isMissingRelation(current.error)) throw current.error;

  const legacy = await calendarDb.from<CatalogRow>("marketing_calendar_dates").select("*");
  if (legacy.error) throw legacy.error;
  return normalizeCatalog(legacy.data ?? [], year);
}

async function getCalendarEvents(organizationId: string, clientId: string): Promise<CalendarItem[]> {
  const { data, error } = await calendarDb.from<EventRow>("calendar_events")
    .select("*")
    .eq("organization_id", organizationId);
  if (error) throw error;
  return normalizeEvents(data ?? [], clientId);
}

function needsLegacyEventPayload(error: DatabaseError | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST204" ||
    /event_date|starts_at|description|schema cache|could not find/i.test(error.message)
  );
}

function legacyEventType(type: CalendarEventType): string {
  return type === "campanha" ? "campaign" : "other";
}

async function createCalendarEvent(input: {
  organizationId: string;
  clientId: string;
  userId: string;
  draft: EventDraft;
}): Promise<void> {
  const { organizationId, clientId, userId, draft } = input;
  const modernPayload = {
    organization_id: organizationId,
    client_id: clientId,
    title: draft.title.trim(),
    event_date: draft.date,
    event_type: draft.eventType,
    color: draft.color,
    note: draft.note.trim() || null,
    created_by: userId,
  };
  const modern = await calendarDb.from<EventRow>("calendar_events").insert(modernPayload);
  if (!modern.error) return;
  if (!needsLegacyEventPayload(modern.error)) throw modern.error;

  const legacy = await calendarDb.from<EventRow>("calendar_events").insert({
    organization_id: organizationId,
    client_id: clientId,
    title: draft.title.trim(),
    description: draft.note.trim() || null,
    event_type: legacyEventType(draft.eventType),
    starts_at: new Date(`${draft.date}T12:00:00`).toISOString(),
    ends_at: null,
    all_day: true,
    color: draft.color,
    created_by: userId,
  });
  if (legacy.error) throw legacy.error;
}

async function updateCalendarEvent(input: {
  organizationId: string;
  eventId: string;
  draft: EventDraft;
}): Promise<void> {
  const { organizationId, eventId, draft } = input;
  const modern = await calendarDb.from<EventRow>("calendar_events")
    .update({
      title: draft.title.trim(),
      event_date: draft.date,
      event_type: draft.eventType,
      color: draft.color,
      note: draft.note.trim() || null,
    })
    .eq("id", eventId)
    .eq("organization_id", organizationId);
  if (!modern.error) return;
  if (!needsLegacyEventPayload(modern.error)) throw modern.error;

  const legacy = await calendarDb.from<EventRow>("calendar_events")
    .update({
      title: draft.title.trim(),
      description: draft.note.trim() || null,
      event_type: legacyEventType(draft.eventType),
      starts_at: new Date(`${draft.date}T12:00:00`).toISOString(),
      color: draft.color,
    })
    .eq("id", eventId)
    .eq("organization_id", organizationId);
  if (legacy.error) throw legacy.error;
}

async function deleteCalendarEvent(organizationId: string, eventId: string): Promise<void> {
  const { error } = await calendarDb.from<EventRow>("calendar_events")
    .delete()
    .eq("id", eventId)
    .eq("organization_id", organizationId);
  if (error) throw error;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function upcomingDateLabel(date: Date, today: Date): string {
  if (isSameDay(date, today)) return "Hoje";
  if (isSameDay(date, addDays(today, 1))) return "Amanhã";
  return capitalize(format(date, "EEE, dd 'de' MMM", { locale: ptBR }));
}

export default function Calendario() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedByOrganization, setSelectedByOrganization] = usePersistedState<Record<string, string>>(
    "norteia-calendar-client-v1",
    {},
  );

  const clientsQuery = useQuery({
    queryKey: ["calendar-clients", organizationId],
    queryFn: async () => {
      const { data, error } = await calendarDb.from<ClientOption>("clients")
        .select("id, name")
        .eq("organization_id", organizationId!)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && !!organizationId,
  });

  const storedClientId = organizationId ? selectedByOrganization[organizationId] : "";
  const selectedClientId =
    clientsQuery.data?.some((client) => client.id === storedClientId)
      ? storedClientId
      : clientsQuery.data?.[0]?.id ?? "";

  const catalogQuery = useQuery({
    queryKey: ["calendar-commemorative-dates", organizationId, visibleMonth.getFullYear()],
    queryFn: () => getCommemorativeDates(visibleMonth.getFullYear()),
    enabled: !!organizationId,
  });

  const eventsQuery = useQuery({
    queryKey: ["calendar-events", organizationId, selectedClientId],
    queryFn: () => getCalendarEvents(organizationId!, selectedClientId),
    enabled: !!organizationId && !!selectedClientId,
  });

  const today = startOfDay(new Date());
  const upcomingEnd = addDays(today, 30);
  const upcomingStartYear = today.getFullYear();
  const upcomingEndYear = upcomingEnd.getFullYear();
  const upcomingCatalogQuery = useQuery({
    queryKey: ["calendar-upcoming-commemorative-dates", organizationId, upcomingStartYear, upcomingEndYear],
    queryFn: async () => {
      const years = upcomingStartYear === upcomingEndYear
        ? [upcomingStartYear]
        : [upcomingStartYear, upcomingEndYear];
      const results = await Promise.all(years.map(getCommemorativeDates));
      return results.flat();
    },
    enabled: !!organizationId,
  });

  const gridStart = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const items = useMemo(
    () => [...(catalogQuery.data ?? []), ...(eventsQuery.data ?? [])],
    [catalogQuery.data, eventsQuery.data],
  );
  const upcomingItems = (() => {
    const from = today.getTime();
    const to = upcomingEnd.getTime();
    return [...(upcomingCatalogQuery.data ?? []), ...(eventsQuery.data ?? [])]
      .filter((item) => {
        const timestamp = startOfDay(item.date).getTime();
        return timestamp >= from && timestamp <= to;
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime() || a.title.localeCompare(b.title, "pt-BR"));
  })();

  const chooseClient = (clientId: string) => {
    if (!organizationId) return;
    setSelectedByOrganization({ ...selectedByOrganization, [organizationId]: clientId });
  };

  const refreshEvents = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["calendar-events", organizationId, selectedClientId],
    });
  };

  const saveEvent = useMutation({
    mutationFn: async (draft: EventDraft) => {
      if (!organizationId || !selectedClientId || !user?.id) {
        throw new Error("Organização, cliente ou usuário não identificado.");
      }
      if (!draft.title.trim()) throw new Error("Informe o título do evento.");
      if (!draft.date) throw new Error("Informe a data do evento.");

      if (draft.id) {
        await updateCalendarEvent({ organizationId, eventId: draft.id, draft });
      } else {
        await createCalendarEvent({ organizationId, clientId: selectedClientId, userId: user.id, draft });
      }
    },
    onSuccess: async (_, draft) => {
      await refreshEvents();
      toast.success(draft.id ? "Evento atualizado." : "Evento criado.");
      setEventDraft(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeEvent = useMutation({
    mutationFn: async (eventId: string) => {
      if (!organizationId) throw new Error("Organização não identificada.");
      await deleteCalendarEvent(organizationId, eventId);
    },
    onSuccess: async () => {
      await refreshEvents();
      toast.success("Evento excluído.");
      setConfirmDelete(false);
      setEventDraft(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openNewEvent = (day: Date) => {
    if (!selectedClientId) return;
    setEventDraft({
      title: "",
      date: format(day, "yyyy-MM-dd"),
      eventType: "personalizado",
      color: "#0F766E",
      note: "",
    });
  };

  const openExistingEvent = (item: CalendarItem) => {
    if (item.kind !== "event" || !item.recordId) return;
    setEventDraft({
      id: item.recordId,
      title: item.title,
      date: format(item.date, "yyyy-MM-dd"),
      eventType: item.eventType ?? "personalizado",
      color: item.color,
      note: item.note ?? "",
    });
  };

  const loading = clientsQuery.isLoading || catalogQuery.isLoading || eventsQuery.isLoading;
  const failed = clientsQuery.isError || catalogQuery.isError || eventsQuery.isError;
  const retry = () => {
    void clientsQuery.refetch();
    void catalogQuery.refetch();
    void eventsQuery.refetch();
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <PageHeader
        title="Calendário"
        subtitle="Datas de marketing e compromissos de cada cliente em um só lugar."
        breadcrumb={[{ label: "Dashboard", to: "/dashboard" }, { label: "Calendário" }]}
        actions={
          <Select value={selectedClientId} onValueChange={chooseClient} disabled={!clientsQuery.data?.length}>
            <SelectTrigger className="w-full min-w-56 sm:w-64" aria-label="Selecionar cliente">
              <SelectValue placeholder="Selecione um cliente" />
            </SelectTrigger>
            <SelectContent>
              {(clientsQuery.data ?? []).map((client) => (
                <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {!clientsQuery.isLoading && clientsQuery.data?.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Nenhum cliente disponível"
          description="Cadastre um cliente antes de organizar o calendário dele."
        />
      ) : failed ? (
        <EmptyState
          icon={AlertCircle}
          title="Não foi possível carregar o calendário"
          description="Confira se a migration do módulo foi aplicada neste ambiente e tente novamente."
          action={
            <Button variant="outline" onClick={retry}>
              <RotateCcw className="mr-2 h-4 w-4" /> Tentar novamente
            </Button>
          }
        />
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b border-border/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setVisibleMonth(startOfMonth(new Date()))}>
                Hoje
              </Button>
              <div className="flex items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setVisibleMonth((month) => subMonths(month, 1))}
                  aria-label="Mês anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setVisibleMonth((month) => addMonths(month, 1))}
                  aria-label="Próximo mês"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <h2 className="ml-1 text-lg font-semibold tracking-tight sm:text-xl">
                {capitalize(format(visibleMonth, "MMMM 'de' yyyy", { locale: ptBR }))}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
              {LEGEND.map((item) => (
                <span key={item.label} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.label}
                </span>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-7 gap-px bg-border/70 p-px">
              {Array.from({ length: 35 }, (_, index) => (
                <div key={index} className="min-h-28 bg-card p-2 sm:min-h-32">
                  <Skeleton className="h-5 w-5 rounded-full" />
                  <Skeleton className="mt-5 h-5 w-full" />
                  <Skeleton className="mt-1.5 h-5 w-4/5" />
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-7 border-b border-border/80 bg-muted/25">
                  {WEEKDAYS.map((weekday) => (
                    <div key={weekday} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {weekday}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-px bg-border/80">
                  {days.map((day) => {
                    const dayItems = items
                      .filter((item) => isSameDay(item.date, day))
                      .sort((a, b) => Number(a.kind === "event") - Number(b.kind === "event"));
                    const visibleItems = dayItems.slice(0, 3);
                    const hiddenCount = dayItems.length - visibleItems.length;
                    const today = isSameDay(day, new Date());
                    const outsideMonth = !isSameMonth(day, visibleMonth);

                    return (
                      <div
                        key={format(day, "yyyy-MM-dd")}
                        role="button"
                        tabIndex={0}
                        onClick={() => openNewEvent(day)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") openNewEvent(day);
                        }}
                        className={cn(
                          "group min-h-28 cursor-pointer bg-card p-1.5 transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:min-h-32 sm:p-2",
                          outsideMonth && "bg-muted/20 text-muted-foreground",
                          today && "bg-brand-soft/30",
                        )}
                        aria-label={`Criar evento em ${format(day, "dd/MM/yyyy")}`}
                      >
                        <div className="mb-1.5 flex items-center justify-between">
                          <Plus className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                          <span
                            className={cn(
                              "flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-medium",
                              today && "bg-brand text-white",
                              !today && outsideMonth && "text-muted-foreground/60",
                            )}
                          >
                            {format(day, "d")}
                          </span>
                        </div>

                        <div className="space-y-1">
                          {visibleItems.map((item) => {
                            const itemStyle = {
                              backgroundColor: `${item.color}18`,
                              color: item.color,
                              borderLeft: `3px solid ${item.color}`,
                            };
                            const itemClass = "flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10px] font-medium sm:text-[11px]";
                            const title = item.note ? `${item.title} — ${item.note}` : item.title;

                            return item.kind === "event" ? (
                              <button
                                key={item.id}
                                type="button"
                                title={title}
                                className={cn(itemClass, "hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand")}
                                style={itemStyle}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openExistingEvent(item);
                                }}
                              >
                                <span className="truncate">{item.title}</span>
                              </button>
                            ) : (
                              <div key={item.id} title={title} className={itemClass} style={itemStyle}>
                                <span className="truncate">{item.title}</span>
                              </div>
                            );
                          })}
                          {hiddenCount > 0 && (
                            <p className="px-1.5 text-[10px] font-medium text-muted-foreground">
                              +{hiddenCount} {hiddenCount === 1 ? "evento" : "eventos"}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm xl:sticky xl:top-5">
          <div className="border-b border-border/80 px-4 py-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand">
                <CalendarDays className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold">Próximas datas</h2>
                <p className="text-[11px] text-muted-foreground">Próximos 30 dias</p>
              </div>
            </div>
          </div>

          <div className="max-h-[680px] overflow-y-auto p-3">
            {upcomingCatalogQuery.isLoading || eventsQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={index} className="rounded-xl border border-border/70 p-3">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="mt-2 h-4 w-full" />
                    <Skeleton className="mt-2 h-3 w-16" />
                  </div>
                ))}
              </div>
            ) : upcomingCatalogQuery.isError ? (
              <div className="px-3 py-8 text-center">
                <AlertCircle className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-2 text-xs font-medium">Não foi possível carregar as próximas datas.</p>
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => void upcomingCatalogQuery.refetch()}>
                  Tentar novamente
                </Button>
              </div>
            ) : upcomingItems.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <CalendarDays className="mx-auto h-6 w-6 text-muted-foreground/60" />
                <p className="mt-2 text-sm font-medium">Agenda livre</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Nenhuma data ou evento previsto para os próximos 30 dias.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {upcomingItems.map((item) => {
                  const content = (
                    <>
                      <div className="flex items-start gap-2.5">
                        <span
                          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-muted-foreground">
                            {upcomingDateLabel(item.date, today)}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug">{item.title}</p>
                          <span
                            className="mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{ backgroundColor: `${item.color}18`, color: item.color }}
                          >
                            {item.kind === "event"
                              ? item.eventType === "campanha" ? "Campanha" : item.eventType === "comemorativa" ? "Comemorativa" : "Evento"
                              : capitalize(item.category)}
                          </span>
                        </div>
                      </div>
                    </>
                  );

                  return item.kind === "event" ? (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openExistingEvent(item)}
                      className="w-full rounded-xl border border-border/70 p-3 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      {content}
                    </button>
                  ) : (
                    <div key={item.id} className="rounded-xl border border-border/70 p-3">
                      {content}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
        </div>
      )}

      <Dialog
        open={!!eventDraft}
        onOpenChange={(open) => {
          if (!open && !saveEvent.isPending && !removeEvent.isPending) setEventDraft(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{eventDraft?.id ? "Editar evento" : "Novo evento"}</DialogTitle>
          </DialogHeader>

          {eventDraft && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                saveEvent.mutate(eventDraft);
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="calendar-event-title">Título</Label>
                <Input
                  id="calendar-event-title"
                  value={eventDraft.title}
                  onChange={(event) => setEventDraft({ ...eventDraft, title: event.target.value })}
                  placeholder="Ex.: Gravação da campanha de Natal"
                  maxLength={160}
                  autoFocus
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="calendar-event-date">Data</Label>
                  <Input
                    id="calendar-event-date"
                    type="date"
                    value={eventDraft.date}
                    onChange={(event) => setEventDraft({ ...eventDraft, date: event.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="calendar-event-type">Tipo</Label>
                  <Select
                    value={eventDraft.eventType}
                    onValueChange={(eventType: CalendarEventType) => setEventDraft({ ...eventDraft, eventType })}
                  >
                    <SelectTrigger id="calendar-event-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="personalizado">Personalizado</SelectItem>
                      <SelectItem value="campanha">Campanha</SelectItem>
                      <SelectItem value="comemorativa">Comemorativa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="calendar-event-color">Cor</Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="calendar-event-color"
                    type="color"
                    value={eventDraft.color}
                    onChange={(event) => setEventDraft({ ...eventDraft, color: event.target.value.toUpperCase() })}
                    className="h-10 w-16 cursor-pointer p-1"
                  />
                  <Input
                    value={eventDraft.color}
                    onChange={(event) => {
                      const color = event.target.value.toUpperCase();
                      if (/^#[0-9A-F]{0,6}$/.test(color)) setEventDraft({ ...eventDraft, color });
                    }}
                    pattern="^#[0-9A-Fa-f]{6}$"
                    maxLength={7}
                    aria-label="Cor em hexadecimal"
                    className="font-mono"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="calendar-event-note">Nota</Label>
                <Textarea
                  id="calendar-event-note"
                  value={eventDraft.note}
                  onChange={(event) => setEventDraft({ ...eventDraft, note: event.target.value })}
                  placeholder="Contexto, responsáveis ou observações do evento"
                  rows={4}
                  maxLength={5000}
                />
              </div>

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
                {eventDraft.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setConfirmDelete(true)}
                    disabled={saveEvent.isPending || removeEvent.isPending}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Excluir
                  </Button>
                ) : <span />}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setEventDraft(null)} disabled={saveEvent.isPending}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={saveEvent.isPending || !eventDraft.title.trim()}>
                    {saveEvent.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {eventDraft.id ? "Salvar alterações" : "Criar evento"}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este evento?</AlertDialogTitle>
            <AlertDialogDescription>
              O evento “{eventDraft?.title}” será removido do calendário. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeEvent.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removeEvent.isPending || !eventDraft?.id}
              onClick={(event) => {
                event.preventDefault();
                if (eventDraft?.id) removeEvent.mutate(eventDraft.id);
              }}
            >
              {removeEvent.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir evento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
