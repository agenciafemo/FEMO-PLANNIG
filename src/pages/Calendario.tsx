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
  Download,
  ListPlus,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { jsPDF } from "jspdf";
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
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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

type ClientOption = { id: string; name: string; segment?: string | null };

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
  client_id?: string | null;
  segment?: string | null;
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
  all_day?: boolean | null;
  start_time?: string | null;
  end_time?: string | null;
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
  timeLabel?: string;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
  // Dados brutos da data comemorativa (para editar/excluir).
  commemorative?: {
    month: number | null;
    day: number | null;
    category: string;
    clientId: string | null;
    recurrence: string;
  };
};

type CalendarEventType = "personalizado" | "campanha" | "comemorativa";

type EventDraft = {
  id?: string;
  title: string;
  date: string;
  eventType: CalendarEventType;
  color: string;
  note: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
};

// Cadastro de uma data comemorativa/aniversário no catálogo (recorrente todo
// ano). Escopo "global" = toda a agência; "cliente" = só o cliente atual.
type CommemorativeDateDraft = {
  id?: string; // presente = edição de uma data existente
  title: string;
  month: number;
  day: number;
  category: "aniversario" | "personalizada" | "nacional" | "varejo" | "sazonal";
  scope: "global" | "clients";
  clientIds: string[];
  color: string;
  // Recorrência: "fixed" = dia/mês fixos; demais = datas móveis (o sistema
  // calcula o dia certo a cada ano automaticamente).
  recurrence: string;
};

// Opções de recorrência expostas na UI. As móveis usam apenas a coluna
// recurrence_rule (o resolver calcula o dia), sem depender de colunas extras.
const RECURRENCE_OPTIONS: { value: string; label: string; movable: boolean }[] = [
  { value: "fixed", label: "Data fixa (dia e mês)", movable: false },
  { value: "easter", label: "Páscoa (móvel)", movable: true },
  { value: "good_friday", label: "Sexta-feira Santa (móvel)", movable: true },
  { value: "carnival", label: "Carnaval (móvel)", movable: true },
  { value: "corpus_christi", label: "Corpus Christi (móvel)", movable: true },
  { value: "mothers_day", label: "Dia das Mães (2º dom. de maio)", movable: true },
  { value: "fathers_day", label: "Dia dos Pais (2º dom. de agosto)", movable: true },
  { value: "black_friday", label: "Black Friday (4ª sexta de nov.)", movable: true },
];
const isMovableRule = (rule: string) => rule !== "fixed" && rule !== "fixed_date";

// Rascunho de tarefa criada a partir de uma data/evento do calendário.
type TaskDraft = {
  title: string;
  dueDate: string;
  assigneeId: string;
  priority: string;
  sourceLabel: string;
};

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const CATEGORY_COLORS: Record<string, string> = {
  nacional: "#2563EB",
  varejo: "#7C3AED",
  sazonal: "#D97706",
  aniversario: "#DB2777",
  personalizada: "#0891B2",
  relacionamento: "#0F766E",
};

// Formata um TIME (HH:MM:SS) do banco para exibição curta (HH:MM).
function shortTime(value?: string | null): string {
  if (!value) return "";
  return value.slice(0, 5);
}

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
  if (rule === "good_friday") return addDays(easterSunday(year), -2);
  if (rule === "corpus_christi") return addDays(easterSunday(year), 60);
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

function normalizeCatalog(
  rows: CatalogRow[],
  year: number,
  clientId: string,
  clientSegment: string | null,
): CalendarItem[] {
  return rows.flatMap((row) => {
    if (row.active === false || row.recurring === false) return [];
    // Datas por cliente só aparecem no calendário daquele cliente; datas sem
    // client_id (catálogo global ou geral da org) aparecem para todos.
    if (row.client_id != null && row.client_id !== clientId) return [];
    // Datas de um segmento só aparecem para clientes daquele segmento. Datas
    // sem segmento (universais/comerciais) aparecem para todos.
    if (row.segment != null && row.segment !== clientSegment) return [];
    const date = resolveCatalogDate(row, year);
    const title = row.title ?? row.name;
    if (!date || !title) return [];
    const category = row.category?.toLowerCase() ?? "sazonal";
    return [{
      id: `date-${row.id}-${year}`,
      recordId: row.id,
      title,
      date,
      category,
      color: row.color ?? CATEGORY_COLORS[category] ?? CATEGORY_COLORS.sazonal,
      kind: "commemorative" as const,
      commemorative: {
        month: row.month ?? null,
        day: row.day ?? null,
        category,
        clientId: row.client_id ?? null,
        recurrence: row.recurrence_rule ?? row.recurrence_kind ?? "fixed",
      },
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
    const allDay = row.all_day ?? true;
    const startTime = shortTime(row.start_time);
    const endTime = shortTime(row.end_time);
    const timeLabel = allDay
      ? ""
      : endTime
        ? `${startTime}–${endTime}`
        : startTime;
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
      allDay,
      startTime,
      endTime,
      timeLabel,
    }];
  });
}

async function getCommemorativeDates(
  year: number,
  clientId: string,
  clientSegment: string | null,
): Promise<CalendarItem[]> {
  const current = await calendarDb.from<CatalogRow>("commemorative_dates").select("*");
  if (!current.error) return normalizeCatalog(current.data ?? [], year, clientId, clientSegment);
  if (!isMissingRelation(current.error)) throw current.error;

  const legacy = await calendarDb.from<CatalogRow>("marketing_calendar_dates").select("*");
  if (legacy.error) throw legacy.error;
  return normalizeCatalog(legacy.data ?? [], year, clientId, clientSegment);
}

async function createCommemorativeDate(input: {
  organizationId: string;
  draft: CommemorativeDateDraft;
}): Promise<void> {
  const { organizationId, draft } = input;
  const base = {
    organization_id: organizationId,
    title: draft.title.trim(),
    month: draft.month,
    day: draft.day,
    category: draft.category,
    recurring: true,
    recurrence_rule: draft.recurrence || "fixed",
    color: draft.color,
  };

  // Edição: atualiza a linha existente (mantém o escopo/cliente atual).
  if (draft.id) {
    const { organization_id: _org, ...updatable } = base;
    void _org;
    let { error } = await calendarDb.from<CatalogRow>("commemorative_dates")
      .update(updatable)
      .eq("id", draft.id);
    if (error && needsLegacyEventPayload(error)) {
      const { color: _omitColor, ...noColor } = updatable;
      void _omitColor;
      ({ error } = await calendarDb.from<CatalogRow>("commemorative_dates")
        .update(noColor)
        .eq("id", draft.id));
    }
    if (error) throw error;
    return;
  }

  // Criação. Global = 1 linha sem cliente; específicos = 1 linha por cliente.
  const targets: (string | null)[] = draft.scope === "global" ? [null] : draft.clientIds;
  let inserted = 0;
  let duplicates = 0;
  for (const clientId of targets) {
    let { error } = await calendarDb.from<CatalogRow>("commemorative_dates").insert({
      ...base,
      client_id: clientId,
    });
    // Bancos antigos podem não ter a coluna `color` (a cor é derivada da
    // categoria na leitura). Se for esse o caso, refaz o insert sem ela.
    if (error && needsLegacyEventPayload(error)) {
      const { color: _omitColor, ...baseNoColor } = base;
      void _omitColor;
      ({ error } = await calendarDb.from<CatalogRow>("commemorative_dates").insert({
        ...baseNoColor,
        client_id: clientId,
      }));
    }
    if (error) {
      if (error.code === "23505") { duplicates++; continue; } // já existe
      throw error;
    }
    inserted++;
  }
  // Nada inserido e havia duplicata → avisa em vez de fingir sucesso.
  if (inserted === 0 && duplicates > 0) {
    throw new Error("Essa data já existe para o(s) cliente(s) selecionado(s).");
  }
}

async function deleteCommemorativeDate(id: string): Promise<void> {
  const { error } = await calendarDb.from<CatalogRow>("commemorative_dates").delete().eq("id", id);
  if (error) throw error;
}

type Assignee = {
  user_id: string;
  display_name: string;
  job_title?: string | null;
};

// Diretório de quem pode receber tarefa (RPC do módulo de Tarefas).
async function getAssignees(organizationId: string): Promise<Assignee[]> {
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: Assignee[] | null; error: DatabaseError | null }>)(
    "get_task_assignees",
    { _organization_id: organizationId },
  );
  if (error) throw error;
  return data ?? [];
}

// Conjunto de user_ids que têm a função "Social Mídia" (tags de colaborador).
async function getSocialMediaUserIds(organizationId: string): Promise<string[]> {
  const tags = await calendarDb.from<{ id: string; name: string }>("team_function_tags")
    .select("id, name")
    .eq("organization_id", organizationId);
  if (tags.error || !tags.data) return [];
  const socialTagIds = new Set(
    tags.data.filter((tag) => /social|m[ií]dia/i.test(tag.name)).map((tag) => tag.id),
  );
  if (socialTagIds.size === 0) return [];
  const members = await calendarDb.from<{ user_id: string; tag_id: string }>("team_member_functions")
    .select("user_id, tag_id")
    .eq("organization_id", organizationId);
  if (members.error || !members.data) return [];
  return members.data.filter((row) => socialTagIds.has(row.tag_id)).map((row) => row.user_id);
}

// Cria uma tarefa no quadro a partir de uma data/evento do calendário.
async function createTaskFromCalendar(input: {
  organizationId: string;
  clientId: string;
  userId: string;
  title: string;
  dueDate: string;
  assigneeId: string;
  priority: string;
}): Promise<void> {
  const { error } = await calendarDb.from("tasks").insert({
    organization_id: input.organizationId,
    client_id: input.clientId,
    title: input.title.trim(),
    assignee_id: input.assigneeId,
    due_date: input.dueDate,
    priority: input.priority,
    status: "todo",
    tags: ["calendario"],
    created_by: input.userId,
  });
  if (error) throw error;
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
    all_day: draft.allDay,
    start_time: draft.allDay ? null : draft.startTime || null,
    end_time: draft.allDay ? null : draft.endTime || null,
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
      all_day: draft.allDay,
      start_time: draft.allDay ? null : draft.startTime || null,
      end_time: draft.allDay ? null : draft.endTime || null,
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
  const [dateDraft, setDateDraft] = useState<CommemorativeDateDraft | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedByOrganization, setSelectedByOrganization] = usePersistedState<Record<string, string>>(
    "norteia-calendar-client-v1",
    {},
  );

  const clientsQuery = useQuery({
    queryKey: ["calendar-clients", organizationId],
    queryFn: async () => {
      // select("*") para trazer o segment se a coluna já existir (tolerante a
      // ambientes onde a migration ainda não rodou).
      const { data, error } = await calendarDb.from<ClientOption>("clients")
        .select("*")
        .eq("organization_id", organizationId!)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((c) => ({ id: c.id, name: c.name, segment: c.segment ?? null }));
    },
    enabled: !!user && !!organizationId,
  });

  const storedClientId = organizationId ? selectedByOrganization[organizationId] : "";
  const selectedClientId =
    clientsQuery.data?.some((client) => client.id === storedClientId)
      ? storedClientId
      : clientsQuery.data?.[0]?.id ?? "";
  const selectedClientSegment =
    clientsQuery.data?.find((client) => client.id === selectedClientId)?.segment ?? null;

  const catalogQuery = useQuery({
    queryKey: ["calendar-commemorative-dates", organizationId, selectedClientId, selectedClientSegment, visibleMonth.getFullYear()],
    queryFn: () => getCommemorativeDates(visibleMonth.getFullYear(), selectedClientId, selectedClientSegment),
    enabled: !!organizationId,
  });

  const eventsQuery = useQuery({
    queryKey: ["calendar-events", organizationId, selectedClientId],
    queryFn: () => getCalendarEvents(organizationId!, selectedClientId),
    enabled: !!organizationId && !!selectedClientId,
  });

  const assigneesQuery = useQuery({
    queryKey: ["calendar-task-assignees", organizationId],
    queryFn: () => getAssignees(organizationId!),
    enabled: !!organizationId,
  });

  const socialMediaQuery = useQuery({
    queryKey: ["calendar-social-media-users", organizationId],
    queryFn: () => getSocialMediaUserIds(organizationId!),
    enabled: !!organizationId,
  });

  const today = startOfDay(new Date());
  const upcomingEnd = addDays(today, 30);
  const upcomingStartYear = today.getFullYear();
  const upcomingEndYear = upcomingEnd.getFullYear();
  const upcomingCatalogQuery = useQuery({
    queryKey: ["calendar-upcoming-commemorative-dates", organizationId, selectedClientId, selectedClientSegment, upcomingStartYear, upcomingEndYear],
    queryFn: async () => {
      const years = upcomingStartYear === upcomingEndYear
        ? [upcomingStartYear]
        : [upcomingStartYear, upcomingEndYear];
      const results = await Promise.all(years.map((y) => getCommemorativeDates(y, selectedClientId, selectedClientSegment)));
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

  const refreshCatalog = async () => {
    await queryClient.invalidateQueries({ queryKey: ["calendar-commemorative-dates"] });
    await queryClient.invalidateQueries({ queryKey: ["calendar-upcoming-commemorative-dates"] });
  };

  const saveCommemorativeDate = useMutation({
    mutationFn: async (draft: CommemorativeDateDraft) => {
      if (!organizationId) throw new Error("Organização não identificada.");
      if (draft.scope === "clients" && draft.clientIds.length === 0) {
        throw new Error("Selecione ao menos um cliente.");
      }
      if (!draft.title.trim()) throw new Error("Informe o título da data.");
      await createCommemorativeDate({ organizationId, draft });
    },
    onSuccess: async (_data, draft) => {
      await refreshCatalog();
      // O calendário mostra UM cliente por vez. Se a data foi criada para
      // cliente(s) específico(s) e a visão atual é outra, muda para o primeiro
      // cliente escolhido — senão a data "some" (fica no calendário dele).
      if (!draft.id && draft.scope === "clients" && draft.clientIds.length > 0 && organizationId
          && !draft.clientIds.includes(selectedClientId)) {
        setSelectedByOrganization({ ...selectedByOrganization, [organizationId]: draft.clientIds[0] });
      }
      toast.success("Data salva no calendário.");
      setDateDraft(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Gera um PDF das datas comemorativas + eventos do mês visível, para a
  // equipe usar no brainstorm daquele mês.
  const downloadMonthPdf = () => {
    const monthItems = items
      .filter((item) => isSameMonth(item.date, visibleMonth))
      .sort((a, b) => a.date.getTime() - b.date.getTime() || a.title.localeCompare(b.title, "pt-BR"));
    if (monthItems.length === 0) {
      toast.error("Nenhuma data ou evento neste mês.");
      return;
    }
    const clientName = clientsQuery.data?.find((client) => client.id === selectedClientId)?.name ?? "";
    const monthLabel = capitalize(format(visibleMonth, "MMMM 'de' yyyy", { locale: ptBR }));
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 48;
    let y = margin;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Datas do mês", margin, y);
    y += 22;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(110);
    doc.text(`${monthLabel}${clientName ? ` · ${clientName}` : ""}`, margin, y);
    y += 10;
    doc.setDrawColor(220);
    doc.line(margin, y, 547, y);
    y += 22;
    doc.setTextColor(0);
    monthItems.forEach((item) => {
      if (y > 790) {
        doc.addPage();
        y = margin;
      }
      const hex = item.color.replace("#", "");
      doc.setFillColor(
        parseInt(hex.slice(0, 2), 16) || 0,
        parseInt(hex.slice(2, 4), 16) || 0,
        parseInt(hex.slice(4, 6), 16) || 0,
      );
      doc.circle(margin + 3, y - 3, 3, "F");
      const dateStr = capitalize(format(item.date, "EEE, dd/MM", { locale: ptBR }));
      const tipo = item.kind === "event"
        ? (item.eventType === "campanha" ? "Campanha" : item.eventType === "comemorativa" ? "Comemorativa" : "Evento")
        : capitalize(item.category);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(dateStr, margin + 14, y);
      doc.setFont("helvetica", "normal");
      doc.text(item.title, margin + 100, y);
      doc.setTextColor(140);
      doc.setFontSize(9);
      doc.text(tipo, 470, y);
      doc.setTextColor(0);
      doc.setFontSize(10);
      y += 20;
    });
    doc.save(`datas-${format(visibleMonth, "yyyy-MM")}.pdf`);
  };

  const openNewDate = () => {
    setDateDraft({
      title: "",
      month: visibleMonth.getMonth() + 1,
      day: 1,
      category: "aniversario",
      scope: selectedClientId ? "clients" : "global",
      clientIds: selectedClientId ? [selectedClientId] : [],
      color: CATEGORY_COLORS.aniversario,
      recurrence: "fixed",
    });
  };

  // Abre o diálogo para EDITAR uma data comemorativa existente.
  const openEditDate = (item: CalendarItem) => {
    if (!item.recordId || !item.commemorative) return;
    const c = item.commemorative;
    const category = (["aniversario", "personalizada", "nacional", "varejo", "sazonal"].includes(c.category)
      ? c.category
      : "sazonal") as CommemorativeDateDraft["category"];
    setDateDraft({
      id: item.recordId,
      title: item.title,
      month: c.month ?? item.date.getMonth() + 1,
      day: c.day ?? item.date.getDate(),
      category,
      scope: c.clientId ? "clients" : "global",
      clientIds: c.clientId ? [c.clientId] : [],
      color: item.color,
      recurrence: c.recurrence || "fixed",
    });
  };

  const deleteCommemorative = useMutation({
    mutationFn: (id: string) => deleteCommemorativeDate(id),
    onSuccess: async () => {
      await refreshCatalog();
      toast.success("Data removida do calendário.");
      setDateDraft(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveTask = useMutation({
    mutationFn: async (draft: TaskDraft) => {
      if (!organizationId || !selectedClientId || !user?.id) {
        throw new Error("Organização, cliente ou usuário não identificado.");
      }
      if (!draft.assigneeId) throw new Error("Selecione o responsável (social mídia).");
      if (!draft.title.trim()) throw new Error("Informe o título da tarefa.");
      await createTaskFromCalendar({
        organizationId,
        clientId: selectedClientId,
        userId: user.id,
        title: draft.title,
        dueDate: draft.dueDate,
        assigneeId: draft.assigneeId,
        priority: draft.priority,
      });
    },
    onSuccess: () => {
      toast.success("Tarefa enviada para o quadro do responsável.");
      setTaskDraft(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Pré-seleciona o primeiro colaborador com função "Social Mídia".
  const openTaskFromItem = (item: CalendarItem) => {
    if (!selectedClientId) {
      toast.error("Selecione um cliente primeiro.");
      return;
    }
    const socialIds = socialMediaQuery.data ?? [];
    const assignees = assigneesQuery.data ?? [];
    const firstSocial = assignees.find((assignee) => socialIds.includes(assignee.user_id));
    setTaskDraft({
      title: `Post: ${item.title}`,
      dueDate: format(item.date, "yyyy-MM-dd"),
      assigneeId: firstSocial?.user_id ?? assignees[0]?.user_id ?? "",
      priority: "medium",
      sourceLabel: item.title,
    });
  };

  const openNewEvent = (day: Date) => {
    if (!selectedClientId) return;
    setEventDraft({
      title: "",
      date: format(day, "yyyy-MM-dd"),
      eventType: "personalizado",
      color: "#0F766E",
      note: "",
      allDay: true,
      startTime: "",
      endTime: "",
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
      allDay: item.allDay ?? true,
      startTime: item.startTime ?? "",
      endTime: item.endTime ?? "",
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
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
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
            <Button
              variant="outline"
              onClick={openNewDate}
              disabled={!clientsQuery.data?.length}
              className="shrink-0"
            >
              <Plus className="mr-2 h-4 w-4" /> Adicionar data
            </Button>
            <Button
              variant="outline"
              onClick={downloadMonthPdf}
              disabled={!clientsQuery.data?.length}
              className="shrink-0"
            >
              <Download className="mr-2 h-4 w-4" /> Baixar PDF
            </Button>
          </div>
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
                                {item.timeLabel && (
                                  <span className="shrink-0 tabular-nums opacity-80">{item.timeLabel}</span>
                                )}
                                <span className="truncate">{item.title}</span>
                              </button>
                            ) : (
                              <button
                                key={item.id}
                                type="button"
                                title={title}
                                className={cn(itemClass, "hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand")}
                                style={itemStyle}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEditDate(item);
                                }}
                              >
                                <span className="truncate">{item.title}</span>
                              </button>
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

                  return (
                    <div
                      key={item.id}
                      className="group relative rounded-xl border border-border/70 p-3 transition-colors hover:bg-muted/45"
                    >
                      {item.kind === "event" ? (
                        <button
                          type="button"
                          onClick={() => openExistingEvent(item)}
                          className="block w-full pr-7 text-left focus-visible:outline-none"
                        >
                          {content}
                        </button>
                      ) : (
                        <div className="pr-7">{content}</div>
                      )}
                      <button
                        type="button"
                        title="Criar tarefa para o social mídia"
                        aria-label="Criar tarefa para o social mídia"
                        onClick={() => openTaskFromItem(item)}
                        className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <ListPlus className="h-4 w-4" />
                      </button>
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

              <div className="space-y-3 rounded-lg border border-border/70 p-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="calendar-event-allday" className="cursor-pointer">Dia inteiro</Label>
                  <Switch
                    id="calendar-event-allday"
                    checked={eventDraft.allDay}
                    onCheckedChange={(allDay) => setEventDraft({ ...eventDraft, allDay })}
                  />
                </div>
                {!eventDraft.allDay && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="calendar-event-start">Início</Label>
                      <Input
                        id="calendar-event-start"
                        type="time"
                        value={eventDraft.startTime}
                        onChange={(event) => setEventDraft({ ...eventDraft, startTime: event.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="calendar-event-end">Fim</Label>
                      <Input
                        id="calendar-event-end"
                        type="time"
                        value={eventDraft.endTime}
                        onChange={(event) => setEventDraft({ ...eventDraft, endTime: event.target.value })}
                      />
                    </div>
                  </div>
                )}
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

      <Dialog
        open={!!dateDraft}
        onOpenChange={(open) => {
          if (!open && !saveCommemorativeDate.isPending) setDateDraft(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{dateDraft?.id ? "Editar data comemorativa" : "Adicionar data comemorativa"}</DialogTitle>
          </DialogHeader>

          {dateDraft && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                saveCommemorativeDate.mutate(dateDraft);
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="calendar-date-title">Título</Label>
                <Input
                  id="calendar-date-title"
                  value={dateDraft.title}
                  onChange={(event) => setDateDraft({ ...dateDraft, title: event.target.value })}
                  placeholder="Ex.: Aniversário do cliente"
                  maxLength={160}
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="calendar-date-recurrence">Quando acontece</Label>
                <Select
                  value={dateDraft.recurrence}
                  onValueChange={(value) => setDateDraft({ ...dateDraft, recurrence: value })}
                >
                  <SelectTrigger id="calendar-date-recurrence"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RECURRENCE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isMovableRule(dateDraft.recurrence) ? (
                <p className="rounded-lg bg-brand-soft/40 px-3 py-2 text-[11px] text-brand">
                  Data móvel: o sistema calcula o dia certo automaticamente a cada ano.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="calendar-date-day">Dia</Label>
                    <Input
                      id="calendar-date-day"
                      type="number"
                      min={1}
                      max={31}
                      value={dateDraft.day}
                      onChange={(event) => setDateDraft({ ...dateDraft, day: Number(event.target.value) })}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="calendar-date-month">Mês</Label>
                    <Select
                      value={String(dateDraft.month)}
                      onValueChange={(value) => setDateDraft({ ...dateDraft, month: Number(value) })}
                    >
                      <SelectTrigger id="calendar-date-month"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((month, index) => (
                          <SelectItem key={month} value={String(index + 1)}>{month}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="calendar-date-category">Categoria</Label>
                  <Select
                    value={dateDraft.category}
                    onValueChange={(category: CommemorativeDateDraft["category"]) =>
                      setDateDraft({ ...dateDraft, category, color: CATEGORY_COLORS[category] ?? dateDraft.color })
                    }
                  >
                    <SelectTrigger id="calendar-date-category"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="aniversario">Aniversário</SelectItem>
                      <SelectItem value="personalizada">Personalizada</SelectItem>
                      <SelectItem value="nacional">Nacional</SelectItem>
                      <SelectItem value="varejo">Varejo</SelectItem>
                      <SelectItem value="sazonal">Sazonal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="calendar-date-scope">Aparece em</Label>
                  <Select
                    value={dateDraft.scope}
                    disabled={!!dateDraft.id}
                    onValueChange={(scope: "global" | "clients") => setDateDraft({ ...dateDraft, scope })}
                  >
                    <SelectTrigger id="calendar-date-scope"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="clients">Clientes específicos</SelectItem>
                      <SelectItem value="global">Toda a agência</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {dateDraft.id && (
                <p className="text-[11px] text-muted-foreground">
                  Para mudar onde a data aparece, exclua e crie novamente.
                </p>
              )}

              {dateDraft.scope === "clients" && !dateDraft.id && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Clientes ({dateDraft.clientIds.length} selecionado{dateDraft.clientIds.length === 1 ? "" : "s"})</Label>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-brand hover:underline"
                      onClick={() => {
                        const allIds = (clientsQuery.data ?? []).map((client) => client.id);
                        const isAll = allIds.length > 0 && dateDraft.clientIds.length === allIds.length;
                        setDateDraft({ ...dateDraft, clientIds: isAll ? [] : allIds });
                      }}
                    >
                      {dateDraft.clientIds.length === (clientsQuery.data?.length ?? 0) && (clientsQuery.data?.length ?? 0) > 0
                        ? "Limpar"
                        : "Selecionar todos"}
                    </button>
                  </div>
                  <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-border/70 p-2">
                    {(clientsQuery.data ?? []).map((client) => {
                      const checked = dateDraft.clientIds.includes(client.id);
                      return (
                        <label
                          key={client.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => {
                              const on = value === true;
                              setDateDraft({
                                ...dateDraft,
                                clientIds: on
                                  ? [...dateDraft.clientIds, client.id]
                                  : dateDraft.clientIds.filter((id) => id !== client.id),
                              });
                            }}
                          />
                          <span className="truncate">{client.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                {dateDraft.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={deleteCommemorative.isPending || saveCommemorativeDate.isPending}
                    onClick={() => deleteCommemorative.mutate(dateDraft.id!)}
                  >
                    {deleteCommemorative.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    Excluir
                  </Button>
                ) : <span />}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setDateDraft(null)} disabled={saveCommemorativeDate.isPending}>
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      saveCommemorativeDate.isPending ||
                      !dateDraft.title.trim() ||
                      (dateDraft.scope === "clients" && !dateDraft.id && dateDraft.clientIds.length === 0)
                    }
                  >
                    {saveCommemorativeDate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {dateDraft.id ? "Salvar" : "Adicionar"}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!taskDraft}
        onOpenChange={(open) => {
          if (!open && !saveTask.isPending) setTaskDraft(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Criar tarefa para o social mídia</DialogTitle>
          </DialogHeader>

          {taskDraft && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                saveTask.mutate(taskDraft);
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="calendar-task-title">Título da tarefa</Label>
                <Input
                  id="calendar-task-title"
                  value={taskDraft.title}
                  onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })}
                  maxLength={160}
                  autoFocus
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="calendar-task-assignee">Responsável</Label>
                  <Select
                    value={taskDraft.assigneeId}
                    onValueChange={(assigneeId) => setTaskDraft({ ...taskDraft, assigneeId })}
                  >
                    <SelectTrigger id="calendar-task-assignee"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {(assigneesQuery.data ?? []).map((assignee) => {
                        const isSocial = (socialMediaQuery.data ?? []).includes(assignee.user_id);
                        return (
                          <SelectItem key={assignee.user_id} value={assignee.user_id}>
                            {assignee.display_name}{isSocial ? " · Social Mídia" : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="calendar-task-priority">Prioridade</Label>
                  <Select
                    value={taskDraft.priority}
                    onValueChange={(priority) => setTaskDraft({ ...taskDraft, priority })}
                  >
                    <SelectTrigger id="calendar-task-priority"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Baixa</SelectItem>
                      <SelectItem value="medium">Média</SelectItem>
                      <SelectItem value="high">Alta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Prazo: {format(parseISO(taskDraft.dueDate), "dd/MM/yyyy")} · cliente atual · vai para a coluna “A fazer” do responsável.
              </p>

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setTaskDraft(null)} disabled={saveTask.isPending}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saveTask.isPending || !taskDraft.title.trim() || !taskDraft.assigneeId}>
                  {saveTask.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Criar tarefa
                </Button>
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
