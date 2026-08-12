import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { addDays, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import {
  AlertTriangle, CalendarDays, CheckCircle2, Clock3, CircleDot,
  Instagram, ListTodo, Loader2, RefreshCw, Sparkles, TimerOff, Users, UsersRound,
} from "lucide-react";
import { EmptyState, MetricCard, PageHeader, SectionHeader } from "@/components/common";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import { getClientMetaStatus } from "@/lib/metaRpc";
import { cn } from "@/lib/utils";

type DatabaseError = { message: string };
type QueryResult<T> = { data: T[] | null; error: DatabaseError | null };
interface QueryBuilder<T> extends PromiseLike<QueryResult<T>> {
  select(columns?: string): QueryBuilder<T>;
  eq(column: string, value: unknown): QueryBuilder<T>;
  gte(column: string, value: unknown): QueryBuilder<T>;
  lte(column: string, value: unknown): QueryBuilder<T>;
  lt(column: string, value: unknown): QueryBuilder<T>;
  or(filters: string): QueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>;
}
interface UntypedDatabaseClient { from<T>(table: string): QueryBuilder<T>; }
type RpcResult = { data: unknown; error: DatabaseError | null };
const db = supabase as unknown as UntypedDatabaseClient;
const callRpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
const TIME_ZONE = "America/Sao_Paulo";
const DAILY_SECONDS = 8 * 60 * 60;
type Status = "todo" | "doing" | "review" | "done";
type Kind = "entrada" | "saida_almoco" | "volta_almoco" | "saida";
type DashboardPeriod = "week" | "month";
type TaskRow = { status: Status; due_date: string; updated_at: string; assignee_id: string };
type Punch = { user_id: string; punched_at: string; kind: Kind };
type Absence = { user_id: string; start_date: string; end_date: string };
type Client = { id: string; name: string };
type TeamMember = { user_id: string; display_name: string; job_title: string | null; avatar_url: string | null };
type FunctionTag = { id: string; name: string; color: string };
type MemberFunction = { user_id: string; tag_id: string };
type EventRow = { id: string; title: string; event_date: string; event_type: string; color: string | null };
type CatalogRow = {
  id: string; title?: string | null; name?: string | null; category?: string | null;
  month?: number | null; day?: number | null; recurring?: boolean | null;
  recurrence_rule?: string | null; recurrence_kind?: string | null;
  weekday?: number | null; occurrence?: number | null; offset_days?: number | null;
  color?: string | null; active?: boolean | null;
};
type Upcoming = { id: string; title: string; date: Date; color: string; detail: string };
type DashboardAnalysisResponse = { analysis?: unknown };
type GeneratedAnalysis = { text: string; contextKey: string };

const STATUS: Record<Status, { label: string; color: string }> = {
  todo: { label: "A fazer", color: "bg-slate-400" },
  doing: { label: "Fazendo", color: "bg-blue-500" },
  review: { label: "Revisão", color: "bg-amber-500" },
  done: { label: "Concluído", color: "bg-emerald-500" },
};
const COLORS: Record<string, string> = {
  nacional: "#2563EB", varejo: "#7C3AED", sazonal: "#D97706",
  aniversario: "#DB2777", personalizada: "#0891B2", relacionamento: "#0F766E",
};
const taskChartConfig = {
  quantidade: { label: "Tarefas", color: "hsl(var(--brand))" },
} satisfies ChartConfig;
const hoursChartConfig = {
  horas: { label: "Horas trabalhadas", color: "hsl(var(--brand))" },
} satisfies ChartConfig;

function dateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: TIME_ZONE,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function dayStartIso(key: string) { return new Date(`${key}T00:00:00-03:00`).toISOString(); }
function secondOfDay(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE,
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 3600 + Number(values.minute) * 60 + Number(values.second);
}
function balanceLabel(seconds: number) {
  if (!seconds) return "0h 00min";
  const absolute = Math.abs(seconds);
  return `${seconds > 0 ? "+" : "−"}${Math.floor(absolute / 3600)}h ${String(Math.floor((absolute % 3600) / 60)).padStart(2, "0")}min`;
}
function isBusinessDay(key: string) {
  const weekday = new Date(`${key}T12:00:00-03:00`).getDay();
  return weekday >= 1 && weekday <= 5;
}

function pointSummary(punches: Punch[], absences: Absence[], today: string, hoursStart: string, balanceStart: string) {
  const todayByUser = new Map<string, Punch[]>();
  const byUserDay = new Map<string, Punch[]>();
  punches.forEach((punch) => {
    const key = dateKey(new Date(punch.punched_at));
    const group = `${punch.user_id}:${key}`;
    byUserDay.set(group, [...(byUserDay.get(group) ?? []), punch]);
    if (key === today) todayByUser.set(punch.user_id, [...(todayByUser.get(punch.user_id) ?? []), punch]);
  });
  let working = 0;
  let late = 0;
  todayByUser.forEach((rows) => {
    const ordered = [...rows].sort((a, b) => a.punched_at.localeCompare(b.punched_at));
    const latest = ordered.at(-1);
    if (latest?.kind === "entrada" || latest?.kind === "volta_almoco") working++;
    const arrival = ordered.find((row) => row.kind === "entrada");
    if (arrival && secondOfDay(arrival.punched_at) > (8 * 60 + 30) * 60) late++;
  });
  const excused = new Set<string>();
  absences.forEach((absence) => {
    let cursor = new Date(`${absence.start_date}T12:00:00-03:00`);
    const end = new Date(`${absence.end_date}T12:00:00-03:00`);
    while (cursor <= end) {
      excused.add(`${absence.user_id}:${dateKey(cursor)}`);
      cursor = addDays(cursor, 1);
    }
  });
  let balance = 0;
  const workedSecondsByUser: Record<string, number> = {};
  byUserDay.forEach((rows, group) => {
    const key = group.slice(group.indexOf(":") + 1);
    const ordered = [...rows].sort((a, b) => a.punched_at.localeCompare(b.punched_at));
    const kinds = new Map<Kind, Punch>();
    ordered.forEach((row) => { if (!kinds.has(row.kind)) kinds.set(row.kind, row); });
    const entrada = kinds.get("entrada"); const almoco = kinds.get("saida_almoco");
    const volta = kinds.get("volta_almoco"); const saida = kinds.get("saida");
    const morning = entrada && almoco ? (new Date(almoco.punched_at).getTime() - new Date(entrada.punched_at).getTime()) / 1000 : 0;
    const afternoon = volta && saida ? (new Date(saida.punched_at).getTime() - new Date(volta.punched_at).getTime()) / 1000 : 0;
    const worked = Math.max(morning, 0) + Math.max(afternoon, 0);
    const userId = group.slice(0, group.indexOf(":"));
    if (key >= hoursStart) workedSecondsByUser[userId] = (workedSecondsByUser[userId] ?? 0) + Math.floor(worked);
    if (key < balanceStart || excused.has(group) || !entrada || !almoco || !volta || !saida || morning < 0 || afternoon < 0) return;
    balance += Math.floor(morning + afternoon) - (isBusinessDay(key) ? DAILY_SECONDS : 0);
  });
  return { working, late, balance, workedSecondsByUser };
}

function easter(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
function nthWeekday(year: number, month: number, weekday: number, occurrence: number) {
  const first = new Date(year, month - 1, 1), target = weekday % 7;
  return new Date(year, month - 1, 1 + (target - first.getDay() + 7) % 7 + (occurrence - 1) * 7);
}
function catalogDate(row: CatalogRow, year: number): Date | null {
  const rule = row.recurrence_rule ?? row.recurrence_kind ?? "fixed";
  if ((rule === "fixed" || rule === "fixed_date") && row.month && row.day) return new Date(year, row.month - 1, row.day);
  if (rule === "easter") return easter(year);
  if (rule === "carnival") return addDays(easter(year), -47);
  if (rule === "mothers_day") return nthWeekday(year, 5, 7, 2);
  if (rule === "fathers_day") return nthWeekday(year, 8, 7, 2);
  if (rule === "black_friday") return addDays(nthWeekday(year, 11, 4, 4), 1);
  if (rule === "easter_offset") return addDays(easter(year), row.offset_days ?? 0);
  if (rule === "nth_weekday" && row.month && row.weekday && row.occurrence) return addDays(nthWeekday(year, row.month, row.weekday, row.occurrence), row.offset_days ?? 0);
  return null;
}

function LoadingValue() { return <span className="inline-block h-6 w-12 animate-pulse rounded bg-muted" aria-label="Carregando" />; }
function Warning({ children }: { children: string }) {
  return <div className="flex items-center gap-2 rounded-lg border border-warning/25 bg-warning-soft px-3 py-2 text-small text-warning"><AlertTriangle className="h-4 w-4" />{children}</div>;
}
function AnalysisText({ text }: { text: string }) {
  return <div className="space-y-2 text-small leading-6 text-foreground">{text.split(/\r?\n/).map((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return <div key={index} className="h-1" />;
    if (line.startsWith("## ")) return <h3 key={index} className="pt-2 text-h3 first:pt-0">{line.slice(3)}</h3>;
    if (/^[-*]\s+/.test(line)) return <div key={index} className="flex gap-2 pl-1"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" /><p>{line.replace(/^[-*]\s+/, "")}</p></div>;
    if (/^\d+[.)]\s+/.test(line)) return <div key={index} className="flex gap-2 pl-1"><span className="font-semibold text-brand">{line.match(/^\d+/)?.[0]}.</span><p>{line.replace(/^\d+[.)]\s+/, "")}</p></div>;
    return <p key={index} className="text-muted-foreground">{line}</p>;
  })}</div>;
}
const actionLink = (to: string, label: string) => <Link to={to} className="text-small font-medium text-brand hover:underline">{label}</Link>;

export default function ControlDashboard() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const today = dateKey();
  const tomorrow = dateKey(addDays(new Date(`${today}T12:00:00-03:00`), 1));
  const monthStart = `${today.slice(0, 7)}-01`;
  const weekStart = format(startOfWeek(new Date(`${today}T12:00:00-03:00`), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const endDate = addDays(new Date(`${today}T12:00:00-03:00`), 6);
  const endKey = format(endDate, "yyyy-MM-dd");
  const [selectedFunction, setSelectedFunction] = useState("all");
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const periodStart = period === "week" ? weekStart : monthStart;
  const queryStart = weekStart < monthStart ? weekStart : monthStart;
  const periodLabel = period === "week" ? "esta semana" : "este mês";

  const tasks = useQuery({
    queryKey: ["control-dashboard", "tasks", organizationId, today],
    queryFn: async () => {
      const { data, error } = await db.from<TaskRow>("tasks").select("status,due_date,updated_at,assignee_id").eq("organization_id", organizationId);
      if (error) throw error;
      return data ?? [];
    }, enabled: !!organizationId,
  });
  const capacity = useQuery({
    queryKey: ["control-dashboard", "team-capacity", organizationId],
    queryFn: async () => {
      const [members, functions, assignments] = await Promise.all([
        callRpc("get_task_assignees", { _organization_id: organizationId }),
        db.from<FunctionTag>("team_function_tags").select("id,name,color").eq("organization_id", organizationId).order("name"),
        db.from<MemberFunction>("team_member_functions").select("user_id,tag_id").eq("organization_id", organizationId),
      ]);
      if (members.error) throw members.error;
      if (functions.error) throw functions.error;
      if (assignments.error) throw assignments.error;
      return {
        members: ((members.data ?? []) as TeamMember[]).filter((member) => Boolean(member.job_title?.trim())),
        functions: functions.data ?? [],
        assignments: assignments.data ?? [],
      };
    }, enabled: !!organizationId,
  });
  const pointPermission = useQuery({
    queryKey: ["control-dashboard", "point-permission", organizationId, user?.id],
    queryFn: async () => {
      const { data, error } = await callRpc("can_view_team_time_clock", { _organization_id: organizationId });
      if (error) throw error;
      return data === true;
    }, enabled: !!organizationId && !!user,
  });
  const point = useQuery({
    queryKey: ["control-dashboard", "point", organizationId, today, period, queryStart],
    queryFn: async () => {
      const [punches, absences] = await Promise.all([
        db.from<Punch>("time_clock_punches").select("user_id,punched_at,kind").eq("organization_id", organizationId)
          .gte("punched_at", dayStartIso(queryStart)).lt("punched_at", dayStartIso(tomorrow)).order("punched_at"),
        db.from<Absence>("time_clock_absences").select("user_id,start_date,end_date").eq("organization_id", organizationId)
          .eq("status", "approved").lte("start_date", today).gte("end_date", queryStart),
      ]);
      if (punches.error) throw punches.error;
      if (absences.error) throw absences.error;
      return pointSummary((punches.data ?? []) as Punch[], (absences.data ?? []) as Absence[], today, periodStart, monthStart);
    }, enabled: pointPermission.data === true && !!organizationId,
  });
  const clients = useQuery({
    queryKey: ["control-dashboard", "clients", organizationId],
    queryFn: async () => {
      const { data, error } = await db.from<Client>("clients").select("id,name").eq("organization_id", organizationId).order("name");
      if (error) throw error;
      return (data ?? []) as Client[];
    }, enabled: !!organizationId,
  });
  const instagram = useQuery({
    queryKey: ["control-dashboard", "instagram", organizationId, clients.data?.map((client) => client.id).join(",")],
    queryFn: async () => {
      const checks = await Promise.all((clients.data ?? []).map(async (client) => {
        try {
          const rows = await getClientMetaStatus(client.id);
          return rows.some((row) => row.channel_type === "instagram" && row.connection_status === "active" && row.channel_status !== "disconnected");
        } catch { return false; }
      }));
      return checks.filter(Boolean).length;
    }, enabled: !!organizationId && !!clients.data,
  });
  const calendar = useQuery({
    queryKey: ["control-dashboard", "calendar", organizationId, today, endKey],
    queryFn: async () => {
      const [events, catalog] = await Promise.all([
        db.from<EventRow>("calendar_events").select("id,title,event_date,event_type,color").eq("organization_id", organizationId)
          .gte("event_date", today).lte("event_date", endKey).order("event_date"),
        db.from<CatalogRow>("commemorative_dates").select("*").or(`organization_id.is.null,organization_id.eq.${organizationId}`),
      ]);
      if (events.error) throw events.error;
      if (catalog.error) throw catalog.error;
      const normalizedEvents = ((events.data ?? []) as EventRow[]).map<Upcoming>((row) => ({
        id: `event-${row.id}`, title: row.title, date: new Date(`${row.event_date}T12:00:00-03:00`),
        color: row.color ?? "#0F766E", detail: row.event_type === "campanha" ? "Campanha" : "Evento",
      }));
      const years = today.slice(0, 4) === endKey.slice(0, 4) ? [Number(today.slice(0, 4))] : [Number(today.slice(0, 4)), Number(endKey.slice(0, 4))];
      const normalizedCatalog = ((catalog.data ?? []) as CatalogRow[]).flatMap<Upcoming>((row) => {
        if (row.active === false || row.recurring === false) return [];
        const title = row.title ?? row.name;
        if (!title) return [];
        return years.flatMap((year) => {
          const date = catalogDate(row, year);
          if (!date) return [];
          const key = format(date, "yyyy-MM-dd");
          if (key < today || key > endKey) return [];
          const category = row.category?.toLowerCase() ?? "sazonal";
          return [{ id: `date-${row.id}-${year}`, title, date, color: row.color ?? COLORS[category] ?? COLORS.sazonal, detail: `Data ${category}` }];
        });
      });
      return [...normalizedEvents, ...normalizedCatalog].sort((a, b) => a.date.getTime() - b.date.getTime());
    }, enabled: !!organizationId,
  });

  const activeFunction = selectedFunction === "all" || capacity.data?.functions.some((item) => item.id === selectedFunction)
    ? selectedFunction : "all";
  const functionMemberIds = useMemo(() => activeFunction === "all" ? null : new Set(
    (capacity.data?.assignments ?? []).filter((item) => item.tag_id === activeFunction).map((item) => item.user_id),
  ), [activeFunction, capacity.data?.assignments]);
  const filteredTasks = useMemo(() => (tasks.data ?? []).filter((row) => !functionMemberIds || functionMemberIds.has(row.assignee_id)), [functionMemberIds, tasks.data]);
  const task = useMemo(() => {
    const distribution: Record<Status, number> = { todo: 0, doing: 0, review: 0, done: 0 };
    filteredTasks.forEach((row) => distribution[row.status]++);
    return {
      open: filteredTasks.filter((row) => row.status !== "done").length,
      overdue: filteredTasks.filter((row) => row.status !== "done" && row.due_date < today).length,
      completed: filteredTasks.filter((row) => row.status === "done" && row.updated_at.slice(0, 10) >= periodStart).length,
      distribution, total: filteredTasks.length,
    };
  }, [filteredTasks, periodStart, today]);
  const workload = useMemo(() => {
    const openByMember = new Map<string, number>();
    filteredTasks.filter((row) => row.status !== "done").forEach((row) => openByMember.set(row.assignee_id, (openByMember.get(row.assignee_id) ?? 0) + 1));
    return (capacity.data?.members ?? [])
      .filter((member) => !functionMemberIds || functionMemberIds.has(member.user_id))
      .map((member) => ({ ...member, openTasks: openByMember.get(member.user_id) ?? 0 }))
      .sort((a, b) => b.openTasks - a.openTasks || a.display_name.localeCompare(b.display_name));
  }, [capacity.data?.members, filteredTasks, functionMemberIds]);
  const taskChartData = useMemo(() => (Object.keys(STATUS) as Status[]).map((status) => ({
    status: STATUS[status].label,
    quantidade: task.distribution[status],
    fill: status === "todo" ? "#94A3B8" : status === "doing" ? "#3B82F6" : status === "review" ? "#F59E0B" : "#10B981",
  })), [task.distribution]);
  const hoursChartData = useMemo(() => (capacity.data?.members ?? []).map((member) => ({
    name: member.display_name.split(" ")[0],
    fullName: member.display_name,
    horas: Number(((point.data?.workedSecondsByUser[member.user_id] ?? 0) / 3600).toFixed(1)),
  })).sort((a, b) => b.horas - a.horas), [capacity.data?.members, point.data?.workedSecondsByUser]);
  const noPointAccess = pointPermission.data === false;
  const pointValue = (value?: number) => noPointAccess ? "Sem acesso" : value ?? <LoadingValue />;
  const anyError = tasks.isError || capacity.isError || pointPermission.isError || point.isError || clients.isError || instagram.isError || calendar.isError;
  const analysisContextKey = `${period}:${activeFunction}`;
  const [generatedAnalysis, setGeneratedAnalysis] = useState<GeneratedAnalysis | null>(null);
  const analysisIsStale = generatedAnalysis !== null && generatedAnalysis.contextKey !== analysisContextKey;
  const analysisReady = !anyError
    && !tasks.isLoading
    && !capacity.isLoading
    && !pointPermission.isLoading
    && !clients.isLoading
    && !instagram.isLoading
    && !calendar.isLoading
    && (noPointAccess || !point.isLoading);
  const analysisMutation = useMutation({
    mutationFn: async () => {
      const activeFunctionName = activeFunction === "all"
        ? "Todas as funções"
        : capacity.data?.functions.find((item) => item.id === activeFunction)?.name ?? "Função selecionada";
      const metrics = {
        periodo: {
          tipo: period,
          rotulo: periodLabel,
          inicio: periodStart,
          fim: today,
        },
        segmentacao: {
          funcao: activeFunctionName,
          observacao: "A segmentação por função afeta os indicadores e a carga de tarefas.",
        },
        tarefas: {
          total: task.total,
          abertas: task.open,
          atrasadas: task.overdue,
          concluidas_no_periodo: task.completed,
          distribuicao_por_status: task.distribution,
        },
        carga_por_colaborador: workload.map((member) => ({
          colaborador: member.display_name,
          funcao_principal: member.job_title,
          tarefas_abertas: member.openTasks,
          sobrecarregado: member.openTasks >= 8,
        })),
        ponto: noPointAccess ? {
          disponivel: false,
          motivo: "Usuário sem permissão específica para visualizar o ponto da equipe.",
        } : {
          disponivel: true,
          trabalhando_agora: point.data?.working ?? 0,
          atrasos_na_entrada_hoje: point.data?.late ?? 0,
          saldo_mensal_da_equipe_em_segundos: point.data?.balance ?? 0,
          horas_trabalhadas_no_periodo: hoursChartData.map((item) => ({
            colaborador: item.fullName,
            horas: item.horas,
          })),
          ajustes_pendentes: null,
          atestados_pendentes: null,
          motivo_dados_pendentes_ausentes: "Esses indicadores não são calculados neste dashboard.",
        },
        calendario_proximos_7_dias: {
          total: calendar.data?.length ?? 0,
          itens: (calendar.data ?? []).map((item) => ({
            titulo: item.title,
            data: format(item.date, "yyyy-MM-dd"),
            tipo: item.detail,
          })),
          clientes_sem_conteudo_proximo: null,
          motivo_indicador_ausente: "O dashboard não calcula conteúdo futuro por cliente.",
        },
        clientes: {
          total: clients.data?.length ?? 0,
          instagram_conectado: instagram.data ?? 0,
          instagram_nao_conectado: Math.max((clients.data?.length ?? 0) - (instagram.data ?? 0), 0),
        },
      };

      const { data, error } = await supabase.functions.invoke<DashboardAnalysisResponse>("dashboard-analysis", {
        body: { metrics },
      });
      if (error) throw error;
      if (typeof data?.analysis !== "string" || !data.analysis.trim()) {
        throw new Error("invalid_analysis_response");
      }
      return data.analysis.trim();
    },
    onSuccess: (text) => setGeneratedAnalysis({ text, contextKey: analysisContextKey }),
  });

  return <div className="nrt-surface -mx-4 -mt-4 min-h-screen px-4 pb-14 pt-6 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-8">
    <div className="mx-auto max-w-[1280px] space-y-7">
      <PageHeader title="Dashboard de Controle" subtitle="Uma visão executiva da operação da agência, atualizada com os dados dos módulos." breadcrumb={[{ label: "Dashboard", to: "/dashboard" }, { label: "Controle" }]} actions={<div className="inline-flex rounded-lg border bg-surface p-1" aria-label="Período do painel"><Button type="button" size="sm" variant={period === "week" ? "default" : "ghost"} className="h-7 px-3" onClick={() => setPeriod("week")}>Esta semana</Button><Button type="button" size="sm" variant={period === "month" ? "default" : "ghost"} className="h-7 px-3" onClick={() => setPeriod("month")}>Este mês</Button></div>} />
      {anyError && <Warning>Parte dos indicadores não pôde ser atualizada. Os demais dados continuam disponíveis.</Warning>}

      <section className="overflow-hidden rounded-xl border border-brand/20 bg-surface shadow-xs">
        <div className="flex flex-col gap-4 border-b border-border/70 bg-brand-soft/45 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-primary-foreground"><Sparkles className="h-5 w-5" /></span>
            <div><h2 className="text-h2">Análise da IA</h2><p className="mt-0.5 text-small text-muted-foreground">Resumo executivo, alertas e ações sugeridas para {periodLabel}.</p></div>
          </div>
          <Button type="button" className="shrink-0 gap-2" disabled={!analysisReady || analysisMutation.isPending} onClick={() => analysisMutation.mutate()}>
            {analysisMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" />Analisando...</> : generatedAnalysis ? <><RefreshCw className="h-4 w-4" />Atualizar</> : <><Sparkles className="h-4 w-4" />Gerar análise</>}
          </Button>
        </div>
        <div className="p-5">
          {analysisMutation.isPending ? <div className="space-y-3" aria-live="polite"><div className="h-4 w-3/4 animate-pulse rounded bg-muted" /><div className="h-4 w-full animate-pulse rounded bg-muted" /><div className="h-4 w-5/6 animate-pulse rounded bg-muted" /><p className="pt-2 text-caption text-muted-foreground">A IA está analisando somente os indicadores exibidos no painel.</p></div>
            : analysisMutation.isError ? <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-4"><p className="text-small font-semibold text-destructive">Não foi possível gerar a análise agora.</p><p className="mt-1 text-caption text-muted-foreground">Confira se a função foi publicada e tente novamente em alguns instantes.</p></div>
              : generatedAnalysis ? <div className="space-y-4">{analysisIsStale && <Warning>O período ou a função mudou. Clique em Atualizar para analisar os indicadores atuais.</Warning>}<AnalysisText text={generatedAnalysis.text} /><p className="border-t pt-3 text-caption text-muted-foreground">Análise gerada por IA. Revise antes de tomar decisões ou compartilhar com a equipe.</p></div>
                : <div className="flex flex-col items-center py-5 text-center"><Sparkles className="h-7 w-7 text-brand" /><p className="mt-3 text-small font-semibold">Transforme os indicadores em prioridades claras</p><p className="mt-1 max-w-xl text-caption text-muted-foreground">A análise usa tarefas, capacidade, ponto, agenda e clientes já carregados. Nenhum dado será inventado.</p>{!analysisReady && <p className="mt-3 text-caption text-warning">Aguardando todos os indicadores ficarem disponíveis.</p>}</div>}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader title="Tarefas" icon={ListTodo} action={actionLink("/tasks", "Abrir quadro")} />
        <div className="flex flex-col gap-1.5 sm:max-w-[280px]"><span className="text-caption text-muted-foreground">Segmentar por função</span><Select value={activeFunction} onValueChange={setSelectedFunction}><SelectTrigger className="h-9" aria-label="Filtrar por função"><SelectValue placeholder="Todas as funções" /></SelectTrigger><SelectContent><SelectItem value="all">Todas as funções</SelectItem>{(capacity.data?.functions ?? []).map((item) => <SelectItem key={item.id} value={item.id}><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</span></SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Tarefas abertas" value={tasks.isLoading ? <LoadingValue /> : task.open} icon={ListTodo} tone="info" />
          <MetricCard label="Tarefas atrasadas" value={tasks.isLoading ? <LoadingValue /> : task.overdue} icon={AlertTriangle} tone="warning" />
          <MetricCard label={`Concluídas ${periodLabel}`} value={tasks.isLoading ? <LoadingValue /> : task.completed} icon={CheckCircle2} tone="success" hint="Com base na última atualização" />
        </div>
        <div className="rounded-xl border bg-surface p-5 shadow-xs">
          <div className="flex items-center justify-between"><div><h3 className="text-h3">Tarefas por status</h3><p className="text-small text-muted-foreground">Distribuição do quadro na função selecionada.</p></div><span className="text-small tabular-nums text-muted-foreground">{task.total} no total</span></div>
          <ChartContainer config={taskChartConfig} className="mt-4 h-[260px] w-full">
            <BarChart data={taskChartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="status" tickLine={false} axisLine={false} tickMargin={10} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="quantidade" radius={[7, 7, 0, 0]}>{taskChartData.map((item) => <Cell key={item.status} fill={item.fill} />)}</Bar>
            </BarChart>
          </ChartContainer>
        </div>
        <div className="rounded-xl border bg-surface p-5 shadow-xs">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-h3">Carga por colaborador</h3><p className="text-small text-muted-foreground">Tarefas abertas por responsável{activeFunction === "all" ? "." : " na função selecionada."}</p></div><span className="text-caption text-muted-foreground">Sobrecarregado: 8 ou mais abertas</span></div>
          {capacity.isLoading ? <div className="mt-4 space-y-3">{[1, 2, 3].map((n) => <div key={n} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div>
            : workload.length ? <div className="mt-4 space-y-3">{workload.map((member) => {
              const overloaded = member.openTasks >= 8;
              const attention = member.openTasks >= 5 && !overloaded;
              return <div key={member.user_id} className={cn("rounded-lg border p-3", overloaded && "border-destructive/35 bg-destructive/5")}>
                <div className="flex items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">{member.display_name.trim().charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-small font-semibold">{member.display_name}</p><p className="truncate text-caption text-muted-foreground">{member.job_title}</p></div><div className="shrink-0 text-right"><strong className={cn("text-base tabular-nums", overloaded && "text-destructive", attention && "text-warning")}>{member.openTasks}</strong><p className="text-[10px] text-muted-foreground">abertas</p></div></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", overloaded ? "bg-destructive" : attention ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(member.openTasks / 8 * 100, 100)}%` }} /></div></div>{overloaded && <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-1 text-[10px] font-semibold text-destructive">Sobrecarregado</span>}</div>
              </div>;
            })}</div>
            : <EmptyState variant="inline" icon={UsersRound} title="Nenhum colaborador nesta função" description="Atribua a função aos colaboradores na área Equipe / Colaboradores." />}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader title="Ponto hoje" icon={Clock3} action={actionLink("/ponto", "Ver ponto")} />
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Trabalhando agora" value={pointValue(point.data?.working)} icon={UsersRound} tone="success" />
          <MetricCard label="Atrasos na entrada" value={pointValue(point.data?.late)} icon={TimerOff} tone="warning" hint="Entrada após 08:30" />
          <MetricCard label="Saldo da equipe no mês" value={noPointAccess ? "Sem acesso" : point.data ? balanceLabel(point.data.balance) : <LoadingValue />} icon={Clock3} tone="brand" hint="Somente jornadas completas" />
        </div>
        {noPointAccess && <Warning>Seu perfil não possui a permissão específica para visualizar o ponto da equipe.</Warning>}
        <div className="rounded-xl border bg-surface p-5 shadow-xs">
          <div><h3 className="text-h3">Horas trabalhadas por colaborador</h3><p className="text-small text-muted-foreground">Total registrado {periodLabel}, considerando os pares de ponto concluídos.</p></div>
          {noPointAccess ? <EmptyState variant="inline" icon={Clock3} title="Dados sem acesso" description="É necessária permissão de gestor do ponto para visualizar as horas da equipe." />
            : point.isLoading || capacity.isLoading ? <div className="mt-4 h-[280px] animate-pulse rounded-lg bg-muted" />
              : hoursChartData.length ? <ChartContainer config={hoursChartConfig} className="mt-4 w-full" style={{ height: Math.max(260, hoursChartData.length * 46) }}>
                <BarChart data={hoursChartData} layout="vertical" margin={{ top: 4, right: 18, left: 8, bottom: 4 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} unit="h" />
                  <YAxis type="category" dataKey="name" width={72} tickLine={false} axisLine={false} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent labelKey="fullName" />} />
                  <Bar dataKey="horas" fill="var(--color-horas)" radius={[0, 7, 7, 0]} />
                </BarChart>
              </ChartContainer>
              : <EmptyState variant="inline" icon={Clock3} title="Sem horas registradas" description="Ainda não há colaboradores com registros de ponto neste mês." />}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="space-y-4">
          <SectionHeader title="Próximos 7 dias" icon={CalendarDays} count={calendar.data?.length} action={actionLink("/calendario", "Abrir calendário")} />
          <div className="rounded-xl border bg-surface p-4 shadow-xs">
            {calendar.isLoading ? <div className="space-y-3">{[1, 2, 3].map((n) => <div key={n} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div>
              : calendar.data?.length ? <div className="divide-y">{calendar.data.map((item) => <div key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-muted/60"><span className="text-[10px] font-medium uppercase text-muted-foreground">{format(item.date, "MMM", { locale: ptBR })}</span><strong className="text-base leading-none">{format(item.date, "dd")}</strong></div><span className="h-8 w-1 rounded-full" style={{ backgroundColor: item.color }} /><div className="min-w-0"><p className="truncate text-small font-semibold">{item.title}</p><p className="text-caption text-muted-foreground">{item.detail} · {format(item.date, "EEEE", { locale: ptBR })}</p></div></div>)}</div>
              : <EmptyState variant="inline" icon={CalendarDays} title="Agenda livre" description="Nenhuma data ou evento previsto para os próximos 7 dias." />}
          </div>
        </section>
        <section className="space-y-4">
          <SectionHeader title="Clientes" icon={Users} action={actionLink("/clients", "Ver clientes")} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <MetricCard label="Clientes cadastrados" value={clients.data?.length ?? <LoadingValue />} icon={Users} tone="info" />
            <MetricCard label="Com Instagram conectado" value={instagram.data ?? <LoadingValue />} icon={Instagram} tone="brand" hint="Conexão Meta ativa" />
          </div>
          <div className="rounded-xl border bg-surface p-4 shadow-xs"><div className="flex items-center gap-2 text-small text-muted-foreground"><CircleDot className="h-4 w-4 text-success" />{clients.data?.length ? `${instagram.data ?? 0} de ${clients.data.length} clientes com Instagram ativo` : "Nenhum cliente cadastrado"}</div></div>
        </section>
      </div>
    </div>
  </div>;
}
