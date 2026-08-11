import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  BriefcaseBusiness,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Coffee,
  LogIn,
  LogOut,
  TimerReset,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState, MetricCard, PageHeader, SectionHeader, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type PunchKind = "entrada" | "saida_almoco" | "volta_almoco" | "saida";

type TimeClockPunch = {
  id: string;
  organization_id: string;
  user_id: string;
  punched_at: string;
  kind: PunchKind;
  note: string | null;
  created_at: string;
};

type TeamMember = {
  user_id: string;
  display_name: string;
  job_title: string | null;
  avatar_url: string | null;
};

type QueryError = { message: string; code?: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };

interface TimeClockFilterBuilder<T> extends PromiseLike<QueryResult<T>> {
  select(columns?: string): TimeClockFilterBuilder<T>;
  eq(column: string, value: unknown): TimeClockFilterBuilder<T>;
  gte(column: string, value: string): TimeClockFilterBuilder<T>;
  lt(column: string, value: string): TimeClockFilterBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): TimeClockFilterBuilder<T>;
  insert(values: Record<string, unknown>): TimeClockFilterBuilder<T>;
}

const timeClockSupabase = supabase as unknown as {
  from<T>(relation: string): TimeClockFilterBuilder<T>;
  rpc<T>(functionName: string, params: Record<string, unknown>): PromiseLike<QueryResult<T>>;
};

const AGENCY_TIME_ZONE = "America/Sao_Paulo";

const PUNCH_STEPS: Array<{
  kind: PunchKind;
  label: string;
  action: string;
  reference: string;
  icon: typeof Clock3;
}> = [
  { kind: "entrada", label: "Entrada", action: "Registrar entrada", reference: "08:30", icon: LogIn },
  { kind: "saida_almoco", label: "Saída para almoço", action: "Registrar saída para almoço", reference: "12:00", icon: Coffee },
  { kind: "volta_almoco", label: "Volta do almoço", action: "Registrar volta do almoço", reference: "13:00", icon: BriefcaseBusiness },
  { kind: "saida", label: "Saída", action: "Registrar saída", reference: "17:30", icon: LogOut },
];

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: AGENCY_TIME_ZONE,
});

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "full",
  timeZone: AGENCY_TIME_ZONE,
});

const historyDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  weekday: "short",
  timeZone: AGENCY_TIME_ZONE,
});

const timePartsFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: AGENCY_TIME_ZONE,
});

function agencyDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: AGENCY_TIME_ZONE,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function agencyDayRange(dateKey: string) {
  const start = new Date(`${dateKey}T00:00:00-03:00`);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function formatPunchTime(punchedAt: string) {
  return timeFormatter.format(new Date(punchedAt));
}

function agencySecondOfDay(punchedAt: string) {
  const parts = timePartsFormatter.formatToParts(new Date(punchedAt));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 3600 + Number(values.minute) * 60 + Number(values.second);
}

function formatHistoryDate(dateKey: string) {
  return historyDateFormatter.format(new Date(`${dateKey}T12:00:00-03:00`)).replace(".", "");
}

function formatWorkedDuration(totalSeconds: number) {
  if (totalSeconds <= 0) return "—";
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}min`;
}

function teamMemberLabel(member: TeamMember) {
  return member.job_title ? `${member.display_name} — ${member.job_title}` : member.display_name;
}

function findPunch(punches: TimeClockPunch[], kind: PunchKind) {
  return punches.find((punch) => punch.kind === kind);
}

function getNextStep(punches: TimeClockPunch[]) {
  const lastPunch = punches.at(-1);
  if (!lastPunch) return PUNCH_STEPS[0];

  const currentIndex = PUNCH_STEPS.findIndex((step) => step.kind === lastPunch.kind);
  return currentIndex >= 0 ? PUNCH_STEPS[currentIndex + 1] ?? null : PUNCH_STEPS[0];
}

function getCurrentStatus(punches: TimeClockPunch[]) {
  const lastPunch = punches.at(-1);
  if (!lastPunch) {
    return {
      label: "Aguardando entrada",
      detail: "Registre sua entrada para iniciar a jornada.",
      variant: "neutral" as const,
    };
  }

  const time = formatPunchTime(lastPunch.punched_at);
  if (lastPunch.kind === "entrada" || lastPunch.kind === "volta_almoco") {
    return {
      label: `Trabalhando desde ${time}`,
      detail: lastPunch.kind === "entrada" ? "Período da manhã em andamento." : "Período da tarde em andamento.",
      variant: "success" as const,
    };
  }

  if (lastPunch.kind === "saida_almoco") {
    return {
      label: `Em intervalo desde ${time}`,
      detail: "Aguardando o registro da volta do almoço.",
      variant: "warning" as const,
    };
  }

  return {
    label: `Jornada concluída às ${time}`,
    detail: "Todos os registros previstos para hoje foram concluídos.",
    variant: "info" as const,
  };
}

type HistoryDay = {
  dateKey: string;
  punches: Partial<Record<PunchKind, TimeClockPunch>>;
  totalSeconds: number;
  partial: boolean;
  alerts: string[];
};

type TeamHistoryDay = {
  member: TeamMember;
  day: HistoryDay;
};

function summarizeHistory(punches: TimeClockPunch[], todayKey: string): HistoryDay[] {
  const grouped = new Map<string, TimeClockPunch[]>();
  punches.forEach((punch) => {
    const dateKey = agencyDateKey(new Date(punch.punched_at));
    grouped.set(dateKey, [...(grouped.get(dateKey) ?? []), punch]);
  });

  return Array.from(grouped.entries())
    .map(([dateKey, dayPunches]) => {
      const ordered = [...dayPunches].sort(
        (first, second) => new Date(first.punched_at).getTime() - new Date(second.punched_at).getTime()
      );
      const byKind: Partial<Record<PunchKind, TimeClockPunch>> = {};
      ordered.forEach((punch) => {
        byKind[punch.kind] ??= punch;
      });

      const completedPairs: Array<[TimeClockPunch | undefined, TimeClockPunch | undefined]> = [
        [byKind.entrada, byKind.saida_almoco],
        [byKind.volta_almoco, byKind.saida],
      ];
      let totalSeconds = 0;
      let pairCount = 0;
      completedPairs.forEach(([start, end]) => {
        if (!start || !end) return;
        const duration = Math.floor((new Date(end.punched_at).getTime() - new Date(start.punched_at).getTime()) / 1000);
        if (duration < 0) return;
        totalSeconds += duration;
        pairCount += 1;
      });

      const alerts: string[] = [];
      if (byKind.entrada && agencySecondOfDay(byKind.entrada.punched_at) > (8 * 60 + 30) * 60) alerts.push("Atraso na entrada");
      if (byKind.saida_almoco && agencySecondOfDay(byKind.saida_almoco.punched_at) < 12 * 60 * 60) alerts.push("Saída antecipada de manhã");
      if (byKind.volta_almoco && agencySecondOfDay(byKind.volta_almoco.punched_at) > 13 * 60 * 60) alerts.push("Atraso na volta");
      if (byKind.saida && agencySecondOfDay(byKind.saida.punched_at) < (17 * 60 + 30) * 60) alerts.push("Saída antecipada");

      const complete = PUNCH_STEPS.every((step) => byKind[step.kind]);
      if (!complete) alerts.push(dateKey === todayKey ? "Em andamento" : "Registro incompleto");

      return {
        dateKey,
        punches: byKind,
        totalSeconds,
        partial: pairCount < 2,
        alerts,
      };
    })
    .sort((first, second) => second.dateKey.localeCompare(first.dateKey));
}

export default function TimeClock() {
  const { user } = useAuth();
  const { organizationId, isLegacy, loading: organizationLoading } = useOrganization();
  const queryClient = useQueryClient();
  const todayKey = agencyDateKey();
  const dayRange = useMemo(() => agencyDayRange(todayKey), [todayKey]);
  const [teamMemberFilter, setTeamMemberFilter] = useState("all");
  const [periodStart, setPeriodStart] = useState(() => `${agencyDateKey().slice(0, 7)}-01`);
  const [periodEnd, setPeriodEnd] = useState(() => agencyDateKey());
  const historyStart = useMemo(
    () => new Date(new Date(dayRange.start).getTime() - 29 * 24 * 60 * 60 * 1000).toISOString(),
    [dayRange.start]
  );
  const teamPeriodValid = /^\d{4}-\d{2}-\d{2}$/.test(periodStart)
    && /^\d{4}-\d{2}-\d{2}$/.test(periodEnd)
    && periodStart <= periodEnd;

  const teamPermissionQuery = useQuery({
    queryKey: ["time-clock-team-permission", organizationId, user?.id],
    queryFn: async () => {
      const result = await timeClockSupabase.rpc<boolean>("can_view_team_time_clock", {
        _organization_id: organizationId!,
      });
      if (result.error) throw result.error;
      return result.data === true;
    },
    enabled: !!user && !!organizationId && !isLegacy,
  });

  const teamMembersQuery = useQuery({
    queryKey: ["time-clock-team-members", organizationId],
    queryFn: async () => {
      const result = await timeClockSupabase.rpc<TeamMember[]>("get_task_assignees", {
        _organization_id: organizationId!,
      });
      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: teamPermissionQuery.data === true && !!organizationId,
  });

  const punchesQuery = useQuery({
    queryKey: ["time-clock-punches", organizationId, user?.id, todayKey],
    queryFn: async () => {
      const result = await timeClockSupabase
        .from<TimeClockPunch[]>("time_clock_punches")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("user_id", user!.id)
        .gte("punched_at", dayRange.start)
        .lt("punched_at", dayRange.end)
        .order("punched_at", { ascending: true });

      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: !!user && !!organizationId && !isLegacy,
    refetchInterval: 60_000,
  });

  const punches = punchesQuery.data ?? [];
  const nextStep = getNextStep(punches);
  const currentStatus = getCurrentStatus(punches);

  const historyQuery = useQuery({
    queryKey: ["time-clock-history", organizationId, user?.id, todayKey],
    queryFn: async () => {
      const result = await timeClockSupabase
        .from<TimeClockPunch[]>("time_clock_punches")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("user_id", user!.id)
        .gte("punched_at", historyStart)
        .lt("punched_at", dayRange.end)
        .order("punched_at", { ascending: false });

      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: !!user && !!organizationId && !isLegacy,
  });

  const historyDays = useMemo(
    () => summarizeHistory(historyQuery.data ?? [], todayKey),
    [historyQuery.data, todayKey]
  );

  const teamPunchesQuery = useQuery({
    queryKey: [
      "time-clock-team-history",
      organizationId,
      teamMemberFilter,
      periodStart,
      periodEnd,
    ],
    queryFn: async () => {
      const periodRange = {
        start: agencyDayRange(periodStart).start,
        end: agencyDayRange(periodEnd).end,
      };
      let query = timeClockSupabase
        .from<TimeClockPunch[]>("time_clock_punches")
        .select("*")
        .eq("organization_id", organizationId!)
        .gte("punched_at", periodRange.start)
        .lt("punched_at", periodRange.end)
        .order("punched_at", { ascending: true });

      if (teamMemberFilter !== "all") query = query.eq("user_id", teamMemberFilter);

      const result = await query;
      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled:
      teamPermissionQuery.data === true
      && !!organizationId
      && teamPeriodValid,
  });

  const visibleTeamMembers = useMemo(() => {
    const members = teamMembersQuery.data ?? [];
    return teamMemberFilter === "all"
      ? members
      : members.filter((member) => member.user_id === teamMemberFilter);
  }, [teamMemberFilter, teamMembersQuery.data]);

  const teamHistoryDays = useMemo<TeamHistoryDay[]>(() => {
    const punchesByMember = new Map<string, TimeClockPunch[]>();
    (teamPunchesQuery.data ?? []).forEach((punch) => {
      punchesByMember.set(punch.user_id, [...(punchesByMember.get(punch.user_id) ?? []), punch]);
    });

    return visibleTeamMembers
      .flatMap((member) =>
        summarizeHistory(punchesByMember.get(member.user_id) ?? [], todayKey)
          .map((day) => ({ member, day }))
      )
      .sort((first, second) => {
        const dateOrder = second.day.dateKey.localeCompare(first.day.dateKey);
        return dateOrder || first.member.display_name.localeCompare(second.member.display_name, "pt-BR");
      });
  }, [teamPunchesQuery.data, todayKey, visibleTeamMembers]);

  const teamTotals = useMemo(() =>
    visibleTeamMembers.map((member) => {
      const days = teamHistoryDays.filter((item) => item.member.user_id === member.user_id);
      return {
        member,
        days: days.length,
        totalSeconds: days.reduce((total, item) => total + item.day.totalSeconds, 0),
      };
    }),
  [teamHistoryDays, visibleTeamMembers]);

  const registerPunch = useMutation({
    mutationFn: async (kind: PunchKind) => {
      if (!user || !organizationId) throw new Error("Organização ou usuário indisponível.");

      const result = await timeClockSupabase.from<null>("time_clock_punches").insert({
        organization_id: organizationId,
        user_id: user.id,
        kind,
      });

      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["time-clock-punches", organizationId, user?.id, todayKey],
        }),
        queryClient.invalidateQueries({
          queryKey: ["time-clock-history", organizationId, user?.id, todayKey],
        }),
        queryClient.invalidateQueries({
          queryKey: ["time-clock-team-history", organizationId],
        }),
      ]);
      toast.success("Ponto registrado com sucesso.");
    },
    onError: (error: QueryError) => {
      toast.error(error.message || "Não foi possível registrar o ponto.");
    },
  });

  const loading = organizationLoading || punchesQuery.isLoading;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <PageHeader
          title="Ponto"
          subtitle="Registre sua jornada e acompanhe os horários do dia."
          breadcrumb={[{ label: "Gestão da equipe" }, { label: "Ponto" }]}
        />

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <MetricCard
            label="Status atual"
            value={loading ? <Skeleton className="h-7 w-36" /> : currentStatus.label}
            icon={Clock3}
            tone={currentStatus.variant === "success" ? "success" : currentStatus.variant === "warning" ? "warning" : "neutral"}
          />
          <MetricCard
            label="Registros de hoje"
            value={loading ? <Skeleton className="h-7 w-16" /> : `${punches.length}/4`}
            icon={CheckCircle2}
            tone={punches.length === 4 ? "success" : "brand"}
          />
          <MetricCard
            label="Jornada padrão"
            value="8 horas"
            hint="08:30–12:00 / 13:00–17:30"
            icon={TimerReset}
            tone="info"
          />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
          <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-7">
            <StatusBadge variant={currentStatus.variant}>{currentStatus.label}</StatusBadge>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
              {nextStep ? nextStep.action : "Jornada finalizada"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{currentStatus.detail}</p>

            <Button
              type="button"
              size="lg"
              className="mt-7 h-16 w-full rounded-2xl text-base font-semibold shadow-md sm:text-lg"
              disabled={loading || registerPunch.isPending || !nextStep || !organizationId || isLegacy}
              onClick={() => nextStep && registerPunch.mutate(nextStep.kind)}
            >
              <Clock3 className="mr-2 h-5 w-5" />
              {registerPunch.isPending ? "Registrando..." : nextStep?.action ?? "Jornada concluída"}
            </Button>

            {nextStep && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Próximo horário de referência: {nextStep.reference}
              </p>
            )}
          </section>

          <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
            <SectionHeader title="Jornada de referência" icon={BriefcaseBusiness} />
            <div className="mt-5 space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-xl bg-muted/50 px-4 py-3">
                <span className="text-muted-foreground">Manhã</span>
                <span className="font-semibold tabular-nums">08:30–12:00</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted/50 px-4 py-3">
                <span className="text-muted-foreground">Intervalo</span>
                <span className="font-semibold tabular-nums">12:00–13:00</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted/50 px-4 py-3">
                <span className="text-muted-foreground">Tarde</span>
                <span className="font-semibold tabular-nums">13:00–17:30</span>
              </div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Estes horários são uma referência da jornada padrão. O registro exibirá sempre o horário real da batida.
            </p>
          </section>
        </div>

        <section className="mt-8">
          <SectionHeader
            title="Registros de hoje"
            count={punches.length}
            icon={Clock3}
            action={<span className="text-xs capitalize text-muted-foreground">{dateFormatter.format(new Date())}</span>}
          />

          {loading ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-32 rounded-2xl" />)}
            </div>
          ) : punchesQuery.isError ? (
            <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center">
              <AlertCircle className="mx-auto h-6 w-6 text-destructive" />
              <p className="mt-3 font-medium">Não foi possível carregar o ponto</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Confirme se a migration do módulo foi aplicada neste ambiente.
              </p>
              <Button variant="outline" className="mt-4" onClick={() => punchesQuery.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : punches.length === 0 ? (
            <EmptyState
              className="mt-4"
              icon={Clock3}
              title="Nenhum registro hoje"
              description="Use o botão Registrar entrada para iniciar sua jornada."
            />
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {PUNCH_STEPS.map((step) => {
                const punch = findPunch(punches, step.kind);
                const isNext = nextStep?.kind === step.kind;
                const Icon = step.icon;

                return (
                  <article
                    key={step.kind}
                    className={cn(
                      "rounded-2xl border bg-card p-4 shadow-sm transition-colors",
                      punch && "border-success/25 bg-success/5",
                      isNext && "border-primary/35 ring-1 ring-primary/15"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-xl",
                        punch ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                      )}>
                        <Icon className="h-4.5 w-4.5" />
                      </div>
                      {punch && <CheckCircle2 className="h-4 w-4 text-success" />}
                    </div>
                    <p className="mt-4 text-sm font-medium">{step.label}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {punch ? formatPunchTime(punch.punched_at) : "--:--"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">Referência {step.reference}</p>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-10">
          <SectionHeader
            title="Histórico"
            count={historyDays.length}
            icon={CalendarRange}
            action={<span className="text-xs text-muted-foreground">Últimos 30 dias</span>}
          />

          {historyQuery.isLoading ? (
            <Skeleton className="mt-4 h-72 rounded-2xl" />
          ) : historyQuery.isError ? (
            <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center">
              <AlertCircle className="mx-auto h-6 w-6 text-destructive" />
              <p className="mt-3 font-medium">Não foi possível carregar o histórico</p>
              <Button variant="outline" className="mt-4" onClick={() => historyQuery.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : historyDays.length === 0 ? (
            <EmptyState
              className="mt-4"
              icon={CalendarRange}
              title="Histórico vazio"
              description="Os dias com registros de ponto aparecerão aqui."
            />
          ) : (
            <div className="mt-4 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/35 hover:bg-muted/35">
                    <TableHead className="min-w-32">Dia</TableHead>
                    <TableHead className="text-center">Entrada</TableHead>
                    <TableHead className="min-w-32 text-center">Saída almoço</TableHead>
                    <TableHead className="min-w-32 text-center">Volta almoço</TableHead>
                    <TableHead className="text-center">Saída</TableHead>
                    <TableHead className="min-w-28">Total</TableHead>
                    <TableHead className="min-w-56">Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyDays.map((day) => (
                    <TableRow key={day.dateKey}>
                      <TableCell className="font-medium capitalize">{formatHistoryDate(day.dateKey)}</TableCell>
                      {PUNCH_STEPS.map((step) => (
                        <TableCell key={step.kind} className="text-center font-medium tabular-nums">
                          {day.punches[step.kind] ? formatPunchTime(day.punches[step.kind]!.punched_at) : "—"}
                        </TableCell>
                      ))}
                      <TableCell>
                        <span className="font-semibold tabular-nums">{formatWorkedDuration(day.totalSeconds)}</span>
                        {day.partial && day.totalSeconds > 0 && (
                          <span className="ml-1 text-[10px] text-muted-foreground">parcial</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {day.alerts.length === 0 ? (
                          <StatusBadge variant="success" size="sm">Regular</StatusBadge>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {day.alerts.map((alert) => (
                              <StatusBadge
                                key={alert}
                                variant={alert === "Em andamento" ? "info" : "warning"}
                                size="sm"
                              >
                                {alert}
                              </StatusBadge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        {teamPermissionQuery.data === true && (
          <section className="mt-12 border-t border-border/70 pt-10">
            <SectionHeader
              title="Visão da equipe"
              count={teamHistoryDays.length}
              icon={BriefcaseBusiness}
              action={<StatusBadge variant="info" size="sm">Acesso ADM/Head</StatusBadge>}
            />

            <div className="mt-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
              <div className="grid gap-4 md:grid-cols-[minmax(220px,1fr)_180px_180px]">
                <div className="space-y-1.5">
                  <Label>Colaborador</Label>
                  <Select value={teamMemberFilter} onValueChange={setTeamMemberFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Toda a equipe</SelectItem>
                      {(teamMembersQuery.data ?? []).map((member) => (
                        <SelectItem key={member.user_id} value={member.user_id}>
                          {teamMemberLabel(member)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="team-period-start">Período inicial</Label>
                  <Input
                    id="team-period-start"
                    type="date"
                    value={periodStart}
                    onChange={(event) => setPeriodStart(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="team-period-end">Período final</Label>
                  <Input
                    id="team-period-end"
                    type="date"
                    value={periodEnd}
                    onChange={(event) => setPeriodEnd(event.target.value)}
                  />
                </div>
              </div>
              {!teamPeriodValid && (
                <p className="mt-3 text-sm text-destructive">A data inicial deve ser anterior à data final.</p>
              )}
            </div>

            <div className="mt-6">
              <SectionHeader title="Totais no período" count={teamTotals.length} icon={TimerReset} />
              {teamMembersQuery.isLoading || teamPunchesQuery.isLoading ? (
                <Skeleton className="mt-3 h-40 rounded-2xl" />
              ) : teamMembersQuery.isError || teamPunchesQuery.isError ? (
                <div className="mt-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-center">
                  <p className="font-medium">Não foi possível carregar os dados da equipe</p>
                  <Button
                    variant="outline"
                    className="mt-3"
                    onClick={() => {
                      teamMembersQuery.refetch();
                      if (teamPeriodValid) teamPunchesQuery.refetch();
                    }}
                  >
                    Tentar novamente
                  </Button>
                </div>
              ) : (
                <div className="mt-3 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/35 hover:bg-muted/35">
                        <TableHead>Colaborador</TableHead>
                        <TableHead className="text-center">Dias registrados</TableHead>
                        <TableHead className="text-right">Total trabalhado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teamTotals.map((total) => (
                        <TableRow key={total.member.user_id}>
                          <TableCell>
                            <p className="font-medium">{total.member.display_name}</p>
                            {total.member.job_title && (
                              <p className="text-xs text-muted-foreground">{total.member.job_title}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-center tabular-nums">{total.days}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {total.totalSeconds > 0 ? formatWorkedDuration(total.totalSeconds) : "0h 00min"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="mt-7">
              <SectionHeader title="Registros da equipe" count={teamHistoryDays.length} icon={CalendarRange} />
              {!teamPeriodValid ? (
                <EmptyState
                  className="mt-3"
                  icon={CalendarRange}
                  title="Período inválido"
                  description="Corrija as datas para consultar os registros da equipe."
                />
              ) : teamPunchesQuery.isLoading || teamMembersQuery.isLoading ? (
                <Skeleton className="mt-3 h-72 rounded-2xl" />
              ) : teamHistoryDays.length === 0 ? (
                <EmptyState
                  className="mt-3"
                  icon={CalendarRange}
                  title="Nenhum registro no período"
                  description="Altere o colaborador ou as datas para ampliar a busca."
                />
              ) : (
                <div className="mt-3 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/35 hover:bg-muted/35">
                        <TableHead className="min-w-36">Colaborador</TableHead>
                        <TableHead className="min-w-32">Dia</TableHead>
                        <TableHead className="text-center">Entrada</TableHead>
                        <TableHead className="min-w-32 text-center">Saída almoço</TableHead>
                        <TableHead className="min-w-32 text-center">Volta almoço</TableHead>
                        <TableHead className="text-center">Saída</TableHead>
                        <TableHead className="min-w-28">Total</TableHead>
                        <TableHead className="min-w-56">Situação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teamHistoryDays.map(({ member, day }) => (
                        <TableRow key={`${member.user_id}-${day.dateKey}`}>
                          <TableCell>
                            <p className="font-medium">{member.display_name}</p>
                            {member.job_title && <p className="text-xs text-muted-foreground">{member.job_title}</p>}
                          </TableCell>
                          <TableCell className="font-medium capitalize">{formatHistoryDate(day.dateKey)}</TableCell>
                          {PUNCH_STEPS.map((step) => (
                            <TableCell key={step.kind} className="text-center font-medium tabular-nums">
                              {day.punches[step.kind] ? formatPunchTime(day.punches[step.kind]!.punched_at) : "—"}
                            </TableCell>
                          ))}
                          <TableCell>
                            <span className="font-semibold tabular-nums">{formatWorkedDuration(day.totalSeconds)}</span>
                            {day.partial && day.totalSeconds > 0 && (
                              <span className="ml-1 text-[10px] text-muted-foreground">parcial</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {day.alerts.length === 0 ? (
                              <StatusBadge variant="success" size="sm">Regular</StatusBadge>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {day.alerts.map((alert) => (
                                  <StatusBadge
                                    key={alert}
                                    variant={alert === "Em andamento" ? "info" : "warning"}
                                    size="sm"
                                  >
                                    {alert}
                                  </StatusBadge>
                                ))}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
