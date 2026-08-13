import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  BriefcaseBusiness,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Coffee,
  Download,
  FileText,
  LogIn,
  LogOut,
  Paperclip,
  Plus,
  TimerReset,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  generateTimeClockReportPdf,
  type TimeClockPdfMember,
} from "@/lib/timeClockReport";

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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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

type AbsenceStatus = "pending" | "approved" | "rejected";
type AbsenceKind = "atestado" | "folga" | "ferias" | "outro";

type TimeClockAbsence = {
  id: string;
  organization_id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  kind: AbsenceKind;
  reason: string | null;
  file_path: string | null;
  status: AbsenceStatus;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

const ABSENCE_KIND_LABEL: Record<AbsenceKind, string> = {
  atestado: "Atestado",
  folga: "Folga",
  ferias: "Férias",
  outro: "Outro",
};

const ATTACHMENTS_BUCKET = "time-clock-attachments";

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
  update(values: Record<string, unknown>): TimeClockFilterBuilder<T>;
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

type AdjustmentStatus = "pending" | "approved" | "rejected";

type TimeClockAdjustmentRequest = {
  id: string;
  organization_id: string;
  user_id: string;
  requested_punched_at: string;
  kind: PunchKind;
  reason: string;
  status: AdjustmentStatus;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

const ADJUSTMENT_STATUS: Record<AdjustmentStatus, { label: string; variant: "warning" | "success" | "danger" }> = {
  pending: { label: "Em análise", variant: "warning" },
  approved: { label: "Aprovado", variant: "success" },
  rejected: { label: "Rejeitado", variant: "danger" },
};

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

const EXPECTED_DAILY_SECONDS = 8 * 60 * 60; // jornada padrão de 8h

function isBusinessDay(dateKey: string): boolean {
  const weekday = new Date(`${dateKey}T12:00:00-03:00`).getDay(); // 0=dom .. 6=sab
  return weekday >= 1 && weekday <= 5;
}

function isCompleteDay(day: HistoryDay): boolean {
  return PUNCH_STEPS.every((step) => day.punches[step.kind]);
}

// Saldo do dia em segundos (extra positivo / negativo). null = não entra no
// banco de horas (dia incompleto/em andamento). Dia útil espera 8h; fim de
// semana espera 0 (só gera extra, nunca negativa).
function dayBalanceSeconds(day: HistoryDay, abonoDates?: Set<string>): number | null {
  // Dia coberto por atestado aprovado é abonado: não gera negativa nem extra.
  if (abonoDates?.has(day.dateKey)) return null;
  if (!isCompleteDay(day)) return null;
  const expected = isBusinessDay(day.dateKey) ? EXPECTED_DAILY_SECONDS : 0;
  return day.totalSeconds - expected;
}

// Formata um saldo com sinal (+1h 30min / −0h 45min / 0h 00min).
function formatBalance(totalSeconds: number): string {
  if (totalSeconds === 0) return "0h 00min";
  const sign = totalSeconds > 0 ? "+" : "−";
  const abs = Math.abs(totalSeconds);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  return `${sign}${hours}h ${String(minutes).padStart(2, "0")}min`;
}

// Agrega extras, negativas e saldo (banco de horas) de uma lista de dias.
function summarizeBalance(
  days: HistoryDay[],
  abonoDates?: Set<string>,
): { extras: number; negativas: number; saldo: number } {
  let extras = 0;
  let negativas = 0;
  for (const day of days) {
    const balance = dayBalanceSeconds(day, abonoDates);
    if (balance === null) continue;
    if (balance > 0) extras += balance;
    else if (balance < 0) negativas += -balance;
  }
  return { extras, negativas, saldo: extras - negativas };
}

// Expande um intervalo [start,end] em chaves de data (yyyy-MM-dd).
function expandDateRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cursor = new Date(`${startDate}T12:00:00-03:00`);
  const end = new Date(`${endDate}T12:00:00-03:00`);
  while (cursor.getTime() <= end.getTime()) {
    out.push(agencyDateKey(cursor));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

// Conjunto de dias abonados (só atestados aprovados) de uma lista.
function abonoDatesFrom(absences: TimeClockAbsence[]): Set<string> {
  const set = new Set<string>();
  for (const absence of absences) {
    if (absence.status !== "approved") continue;
    for (const dateKey of expandDateRange(absence.start_date, absence.end_date)) set.add(dateKey);
  }
  return set;
}

type HourBankBaseline = { baseline_seconds: number; effective_from: string };

export default function TimeClock() {
  const { user } = useAuth();
  const { organizationId, isLegacy, loading: organizationLoading } = useOrganization();
  const queryClient = useQueryClient();
  const todayKey = agencyDateKey();
  const dayRange = useMemo(() => agencyDayRange(todayKey), [todayKey]);
  const [teamMemberFilter, setTeamMemberFilter] = useState("all");
  const [periodStart, setPeriodStart] = useState(() => `${agencyDateKey().slice(0, 7)}-01`);
  const [periodEnd, setPeriodEnd] = useState(() => agencyDateKey());
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustmentDate, setAdjustmentDate] = useState(() => agencyDateKey());
  const [adjustmentTime, setAdjustmentTime] = useState(() => timeFormatter.format(new Date()));
  const [adjustmentKind, setAdjustmentKind] = useState<PunchKind>("entrada");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [absenceOpen, setAbsenceOpen] = useState(false);
  const [absenceStart, setAbsenceStart] = useState(() => agencyDateKey());
  const [absenceEnd, setAbsenceEnd] = useState(() => agencyDateKey());
  const [absenceKind, setAbsenceKind] = useState<AbsenceKind>("atestado");
  const [absenceReason, setAbsenceReason] = useState("");
  const [absenceFile, setAbsenceFile] = useState<File | null>(null);
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

  const myAdjustmentsQuery = useQuery({
    queryKey: ["time-clock-my-adjustments", organizationId, user?.id],
    queryFn: async () => {
      const result = await timeClockSupabase
        .from<TimeClockAdjustmentRequest[]>("time_clock_adjustment_requests")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: !!user && !!organizationId && !isLegacy,
    refetchInterval: 30_000,
    retry: false,
  });

  const pendingAdjustmentsQuery = useQuery({
    queryKey: ["time-clock-pending-adjustments", organizationId],
    queryFn: async () => {
      const result = await timeClockSupabase
        .from<TimeClockAdjustmentRequest[]>("time_clock_adjustment_requests")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: teamPermissionQuery.data === true && !!organizationId,
    refetchInterval: 30_000,
    retry: false,
  });

  const myAbsencesQuery = useQuery({
    queryKey: ["time-clock-my-absences", organizationId, user?.id],
    queryFn: async () => {
      const result = await timeClockSupabase
        .from<TimeClockAbsence[]>("time_clock_absences")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("user_id", user!.id)
        .order("start_date", { ascending: false });
      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: !!user && !!organizationId && !isLegacy,
    retry: false,
  });

  const teamAbsencesQuery = useQuery({
    queryKey: ["time-clock-team-absences", organizationId],
    queryFn: async () => {
      const result = await timeClockSupabase
        .from<TimeClockAbsence[]>("time_clock_absences")
        .select("*")
        .eq("organization_id", organizationId!)
        .order("start_date", { ascending: false });
      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: teamPermissionQuery.data === true && !!organizationId,
    refetchInterval: 30_000,
    retry: false,
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

  const myAbonoDates = useMemo(
    () => abonoDatesFrom(myAbsencesQuery.data ?? []),
    [myAbsencesQuery.data],
  );
  const personalBalance = useMemo(
    () => summarizeBalance(historyDays, myAbonoDates),
    [historyDays, myAbonoDates],
  );

  // Banco de horas ACUMULADO = saldo de abertura (migrado do app anterior) +
  // saldos dos pontos a partir da data de corte. Resiliente: se a tabela ainda
  // não existir neste ambiente, simplesmente não mostra o acumulado.
  const bankBaselineQuery = useQuery({
    queryKey: ["time-clock-bank-baseline", organizationId, user?.id],
    queryFn: async () => {
      try {
        const result = await timeClockSupabase
          .from<HourBankBaseline[]>("time_clock_hour_bank_baseline")
          .select("baseline_seconds,effective_from")
          .eq("organization_id", organizationId!)
          .eq("user_id", user!.id);
        if (result.error) return null;
        return (result.data ?? [])[0] ?? null;
      } catch {
        return null;
      }
    },
    enabled: !!user && !!organizationId && !isLegacy,
    retry: false,
  });
  const bankEffectiveFrom = bankBaselineQuery.data?.effective_from ?? null;
  const bankPunchesQuery = useQuery({
    queryKey: ["time-clock-bank-punches", organizationId, user?.id, bankEffectiveFrom, todayKey],
    queryFn: async () => {
      const result = await timeClockSupabase
        .from<TimeClockPunch[]>("time_clock_punches")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("user_id", user!.id)
        .gte("punched_at", agencyDayRange(bankEffectiveFrom!).start)
        .lt("punched_at", dayRange.end)
        .order("punched_at", { ascending: true });
      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: !!user && !!organizationId && !isLegacy && !!bankEffectiveFrom,
  });
  const accumulatedBank = useMemo(() => {
    const baseline = bankBaselineQuery.data;
    if (!baseline) return null;
    const days = summarizeHistory(bankPunchesQuery.data ?? [], todayKey)
      .filter((day) => day.dateKey >= baseline.effective_from);
    return baseline.baseline_seconds + summarizeBalance(days, myAbonoDates).saldo;
  }, [bankBaselineQuery.data, bankPunchesQuery.data, todayKey, myAbonoDates]);

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

  const teamAbonoByUser = useMemo(() => {
    const byUser = new Map<string, TimeClockAbsence[]>();
    (teamAbsencesQuery.data ?? []).forEach((absence) => {
      byUser.set(absence.user_id, [...(byUser.get(absence.user_id) ?? []), absence]);
    });
    const map = new Map<string, Set<string>>();
    byUser.forEach((list, userId) => map.set(userId, abonoDatesFrom(list)));
    return map;
  }, [teamAbsencesQuery.data]);

  const teamTotals = useMemo(() =>
    visibleTeamMembers.map((member) => {
      const days = teamHistoryDays.filter((item) => item.member.user_id === member.user_id);
      const balance = summarizeBalance(days.map((item) => item.day), teamAbonoByUser.get(member.user_id));
      return {
        member,
        days: days.length,
        totalSeconds: days.reduce((total, item) => total + item.day.totalSeconds, 0),
        extras: balance.extras,
        negativas: balance.negativas,
        saldo: balance.saldo,
      };
    }),
  [teamHistoryDays, visibleTeamMembers, teamAbonoByUser]);

  const reportTotals = useMemo(
    () => teamTotals.filter((total) => total.days > 0),
    [teamTotals],
  );

  const handleDownloadPdf = () => {
    if (!teamPeriodValid || teamPunchesQuery.isLoading) {
      toast.error("Aguarde o carregamento de um período válido.");
      return;
    }
    if (teamPunchesQuery.isError) {
      toast.error("Não foi possível carregar os registros para gerar o relatório.");
      return;
    }

    const members: TimeClockPdfMember[] = reportTotals.map((total) => {
      const days = teamHistoryDays
        .filter((item) => item.member.user_id === total.member.user_id)
        .map(({ day }) => {
          const balance = dayBalanceSeconds(day);
          return {
            date: formatHistoryDate(day.dateKey),
            entrada: day.punches.entrada ? formatPunchTime(day.punches.entrada.punched_at) : "—",
            saidaAlmoco: day.punches.saida_almoco ? formatPunchTime(day.punches.saida_almoco.punched_at) : "—",
            voltaAlmoco: day.punches.volta_almoco ? formatPunchTime(day.punches.volta_almoco.punched_at) : "—",
            saida: day.punches.saida ? formatPunchTime(day.punches.saida.punched_at) : "—",
            total: day.totalSeconds > 0 ? formatWorkedDuration(day.totalSeconds) : "—",
            saldo: balance === null ? "—" : formatBalance(balance),
          };
        })
        .reverse();
      return {
        name: total.member.display_name,
        role: total.member.job_title ?? "",
        diasRegistrados: total.days,
        totalTrabalhado: total.totalSeconds > 0 ? formatWorkedDuration(total.totalSeconds) : "0h 00min",
        extras: total.extras > 0 ? formatBalance(total.extras) : "0h 00min",
        negativas: total.negativas > 0 ? formatBalance(-total.negativas) : "0h 00min",
        saldo: formatBalance(total.saldo),
        days,
      };
    });
    if (members.length === 0) {
      toast.error("Sem dados para gerar o relatório neste período.");
      return;
    }
    try {
      generateTimeClockReportPdf({
        periodLabel: `${formatHistoryDate(periodStart)} a ${formatHistoryDate(periodEnd)}`,
        generatedAt: new Date().toLocaleString("pt-BR"),
        detailed: teamMemberFilter !== "all",
        members,
      });
      toast.success("Relatório gerado.");
    } catch {
      toast.error("Não foi possível gerar o relatório em PDF.");
    }
  };

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

  const requestAdjustment = useMutation({
    mutationFn: async () => {
      if (!user || !organizationId) throw new Error("Organização ou usuário indisponível.");
      if (adjustmentReason.trim().length < 5) {
        throw new Error("Explique o motivo do ajuste com pelo menos 5 caracteres.");
      }
      const requestedAt = new Date(`${adjustmentDate}T${adjustmentTime}:00-03:00`);
      if (Number.isNaN(requestedAt.getTime())) throw new Error("Data ou horário inválido.");
      if (requestedAt.getTime() > Date.now() + 5 * 60 * 1000) {
        throw new Error("Não é permitido solicitar um horário futuro.");
      }

      const result = await timeClockSupabase
        .from<null>("time_clock_adjustment_requests")
        .insert({
          organization_id: organizationId,
          user_id: user.id,
          requested_punched_at: requestedAt.toISOString(),
          kind: adjustmentKind,
          reason: adjustmentReason.trim(),
        });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-clock-my-adjustments", organizationId, user?.id] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-pending-adjustments", organizationId] }),
      ]);
      toast.success("Horário enviado para análise da ADM.");
      setAdjustmentOpen(false);
      setAdjustmentReason("");
    },
    onError: (error: QueryError) => toast.error(error.message || "Não foi possível enviar a solicitação."),
  });

  const reviewAdjustment = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      if (!organizationId) throw new Error("Organização indisponível.");
      const result = await timeClockSupabase
        .from<null>("time_clock_adjustment_requests")
        .update({ status })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .eq("status", "pending");
      if (result.error) throw result.error;
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-clock-pending-adjustments", organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-punches", organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-history", organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-team-history", organizationId] }),
      ]);
      toast.success(variables.status === "approved" ? "Ajuste aprovado e incluído no ponto." : "Ajuste rejeitado.");
    },
    onError: (error: QueryError) => toast.error(error.message || "Não foi possível analisar a solicitação."),
  });

  const createAbsence = useMutation({
    mutationFn: async () => {
      if (!user || !organizationId) throw new Error("Organização ou usuário indisponível.");
      if (!absenceStart || !absenceEnd) throw new Error("Informe o período do atestado.");
      if (absenceEnd < absenceStart) throw new Error("A data final não pode ser antes da inicial.");
      if (absenceKind === "atestado" && !absenceFile) {
        throw new Error("Anexe a foto ou PDF do atestado.");
      }
      let filePath: string | null = null;
      if (absenceFile) {
        if (absenceFile.size > 10 * 1024 * 1024) throw new Error("Arquivo muito grande (máximo 10MB).");
        const ext = absenceFile.name.split(".").pop()?.toLowerCase() || "dat";
        const path = `${organizationId}/${user.id}/${crypto.randomUUID()}.${ext}`;
        const upload = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, absenceFile);
        if (upload.error) throw upload.error;
        filePath = path;
      }
      const result = await timeClockSupabase
        .from<null>("time_clock_absences")
        .insert({
          organization_id: organizationId,
          user_id: user.id,
          start_date: absenceStart,
          end_date: absenceEnd,
          kind: absenceKind,
          reason: absenceReason.trim() || null,
          file_path: filePath,
          created_by: user.id,
        });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-clock-my-absences", organizationId, user?.id] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-team-absences", organizationId] }),
      ]);
      toast.success("Atestado enviado para análise da ADM.");
      setAbsenceOpen(false);
      setAbsenceReason("");
      setAbsenceFile(null);
    },
    onError: (error: QueryError) => toast.error(error.message || "Não foi possível enviar o atestado."),
  });

  const reviewAbsence = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      if (!organizationId) throw new Error("Organização indisponível.");
      const result = await timeClockSupabase
        .from<null>("time_clock_absences")
        .update({ status })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .eq("status", "pending");
      if (result.error) throw result.error;
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-clock-team-absences", organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-my-absences", organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-history", organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-team-history", organizationId] }),
      ]);
      toast.success(variables.status === "approved" ? "Atestado aprovado — dias abonados." : "Atestado rejeitado.");
    },
    onError: (error: QueryError) => toast.error(error.message || "Não foi possível analisar o atestado."),
  });

  const openAbsenceFile = async (filePath: string) => {
    const { data, error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(filePath, 60);
    if (error || !data?.signedUrl) {
      toast.error("Não foi possível abrir o arquivo.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const loading = organizationLoading || punchesQuery.isLoading;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <PageHeader
          title="Ponto"
          subtitle="Registre sua jornada e acompanhe os horários do dia."
          breadcrumb={[{ label: "Gestão da equipe" }, { label: "Ponto" }]}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setAdjustmentDate(agencyDateKey());
                  setAdjustmentTime(timeFormatter.format(new Date()));
                  setAdjustmentKind("entrada");
                  setAdjustmentReason("");
                  setAdjustmentOpen(true);
                }}
                disabled={!organizationId || isLegacy}
              >
                <Plus className="mr-2 h-4 w-4" /> Adicionar horário
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setAbsenceStart(agencyDateKey());
                  setAbsenceEnd(agencyDateKey());
                  setAbsenceKind("atestado");
                  setAbsenceReason("");
                  setAbsenceFile(null);
                  setAbsenceOpen(true);
                }}
                disabled={!organizationId || isLegacy}
              >
                <FileText className="mr-2 h-4 w-4" /> Adicionar atestado
              </Button>
            </div>
          }
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
            label="Banco de horas acumulado"
            value={
              accumulatedBank === null
                ? bankBaselineQuery.isLoading
                  ? <Skeleton className="h-7 w-20" />
                  : "—"
                : formatBalance(accumulatedBank)
            }
            hint={accumulatedBank === null ? "saldo ainda não definido" : "saldo atual + seus pontos"}
            icon={TimerReset}
            tone={
              accumulatedBank === null
                ? "neutral"
                : accumulatedBank > 0
                  ? "success"
                  : accumulatedBank < 0
                    ? "warning"
                    : "info"
            }
          />
        </div>

        <div className="mt-6">
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

            {/* Jornada de referência — compacta, abaixo do botão. */}
            <div className="mt-6 border-t border-border/60 pt-4">
              <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <BriefcaseBusiness className="h-3.5 w-3.5" /> Jornada de referência
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-1.5">
                  <span className="text-muted-foreground">Manhã</span>
                  <span className="font-semibold tabular-nums">08:30–12:00</span>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-1.5">
                  <span className="text-muted-foreground">Intervalo</span>
                  <span className="font-semibold tabular-nums">12:00–13:00</span>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-1.5">
                  <span className="text-muted-foreground">Tarde</span>
                  <span className="font-semibold tabular-nums">13:00–17:30</span>
                </span>
              </div>
            </div>
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

        <section className="mt-8">
          <SectionHeader
            title="Meus ajustes de horário"
            count={myAdjustmentsQuery.data?.length ?? 0}
            icon={Clock3}
            action={<span className="text-xs text-muted-foreground">Acompanhamento das solicitações</span>}
          />

          {myAdjustmentsQuery.isLoading ? (
            <Skeleton className="mt-3 h-28 rounded-2xl" />
          ) : myAdjustmentsQuery.isError ? (
            <div className="mt-3 rounded-2xl border border-warning/20 bg-warning/5 p-4 text-sm text-muted-foreground">
              As solicitações ficarão disponíveis após a migration de ajustes do ponto ser aplicada.
            </div>
          ) : (myAdjustmentsQuery.data ?? []).length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-border/70 px-5 py-6 text-center text-sm text-muted-foreground">
              Você ainda não solicitou nenhum ajuste de horário.
            </div>
          ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {(myAdjustmentsQuery.data ?? []).slice(0, 6).map((request) => {
                const status = ADJUSTMENT_STATUS[request.status];
                const kindLabel = PUNCH_STEPS.find((step) => step.kind === request.kind)?.label ?? request.kind;
                return (
                  <article key={request.id} className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{kindLabel}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatHistoryDate(agencyDateKey(new Date(request.requested_punched_at)))} · {formatPunchTime(request.requested_punched_at)}
                        </p>
                      </div>
                      <StatusBadge variant={status.variant} size="sm">{status.label}</StatusBadge>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{request.reason}</p>
                    {request.review_note && (
                      <p className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                        Retorno da análise: {request.review_note}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-8">
          <SectionHeader
            title="Meus atestados"
            count={myAbsencesQuery.data?.length ?? 0}
            icon={Paperclip}
            action={<span className="text-xs text-muted-foreground">Atestados e abonos</span>}
          />

          {myAbsencesQuery.isLoading ? (
            <Skeleton className="mt-3 h-24 rounded-2xl" />
          ) : (myAbsencesQuery.data ?? []).length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-border/70 px-5 py-6 text-center text-sm text-muted-foreground">
              Você ainda não enviou nenhum atestado. Use “Adicionar atestado” no topo.
            </div>
          ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {(myAbsencesQuery.data ?? []).slice(0, 6).map((absence) => {
                const status = ADJUSTMENT_STATUS[absence.status];
                return (
                  <article key={absence.id} className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{ABSENCE_KIND_LABEL[absence.kind]}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatHistoryDate(absence.start_date)}
                          {absence.end_date !== absence.start_date ? ` – ${formatHistoryDate(absence.end_date)}` : ""}
                        </p>
                      </div>
                      <StatusBadge variant={status.variant} size="sm">{status.label}</StatusBadge>
                    </div>
                    {absence.reason && <p className="mt-3 text-sm text-muted-foreground">{absence.reason}</p>}
                    {(absence.file_path || absence.review_note) && (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        {absence.file_path && (
                          <button
                            type="button"
                            onClick={() => openAbsenceFile(absence.file_path!)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                          >
                            <Paperclip className="h-3.5 w-3.5" /> Ver arquivo
                          </button>
                        )}
                        {absence.review_note && (
                          <span className="text-xs text-muted-foreground">Retorno: {absence.review_note}</span>
                        )}
                      </div>
                    )}
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

          {historyDays.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-3 py-1.5 text-xs">
                <span className="text-muted-foreground">Extras</span>
                <span className="font-semibold tabular-nums text-success">
                  {personalBalance.extras > 0 ? formatBalance(personalBalance.extras) : "0h 00min"}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-3 py-1.5 text-xs">
                <span className="text-muted-foreground">Negativas</span>
                <span className="font-semibold tabular-nums text-destructive">
                  {personalBalance.negativas > 0 ? formatBalance(-personalBalance.negativas) : "0h 00min"}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-3 py-1.5 text-xs">
                <span className="text-muted-foreground">Banco de horas</span>
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    personalBalance.saldo > 0 && "text-success",
                    personalBalance.saldo < 0 && "text-destructive",
                  )}
                >
                  {formatBalance(personalBalance.saldo)}
                </span>
              </span>
            </div>
          )}

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
                    <TableHead className="min-w-28">Saldo</TableHead>
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
                        {(() => {
                          const balance = dayBalanceSeconds(day);
                          if (balance === null) return <span className="text-muted-foreground">—</span>;
                          return (
                            <span
                              className={cn(
                                "font-semibold tabular-nums",
                                balance > 0 && "text-success",
                                balance < 0 && "text-destructive",
                                balance === 0 && "text-muted-foreground",
                              )}
                            >
                              {formatBalance(balance)}
                            </span>
                          );
                        })()}
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
          <section id="ajustes-ponto" className="mt-12 scroll-mt-24 border-t border-border/70 pt-10">
            <SectionHeader
              title="Visão da equipe"
              count={teamHistoryDays.length}
              icon={BriefcaseBusiness}
              action={
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadPdf}
                    disabled={
                      !teamPeriodValid
                      || teamMembersQuery.isLoading
                      || teamPunchesQuery.isLoading
                      || teamPunchesQuery.isError
                      || reportTotals.length === 0
                    }
                  >
                    <Download className="mr-2 h-4 w-4" /> Baixar carga horária
                  </Button>
                  <StatusBadge variant="info" size="sm">Acesso ADM/Head</StatusBadge>
                </div>
              }
            />

            <div className="mt-4 rounded-2xl border border-warning/25 bg-warning/5 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold">Solicitações aguardando análise</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Confira o horário e a justificativa antes de aprovar.
                  </p>
                </div>
                <StatusBadge variant="warning" size="sm">
                  {pendingAdjustmentsQuery.data?.length ?? 0} pendente(s)
                </StatusBadge>
              </div>

              {pendingAdjustmentsQuery.isLoading ? (
                <Skeleton className="mt-4 h-24 rounded-xl" />
              ) : pendingAdjustmentsQuery.isError ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  A fila ficará disponível após a migration de ajustes do ponto ser aplicada.
                </p>
              ) : (pendingAdjustmentsQuery.data ?? []).length === 0 ? (
                <p className="mt-4 rounded-xl bg-card/70 px-4 py-5 text-center text-sm text-muted-foreground">
                  Nenhuma solicitação pendente.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {(pendingAdjustmentsQuery.data ?? []).map((request) => {
                    const member = teamMembersQuery.data?.find((item) => item.user_id === request.user_id);
                    const kindLabel = PUNCH_STEPS.find((step) => step.kind === request.kind)?.label ?? request.kind;
                    const reviewing = reviewAdjustment.isPending && reviewAdjustment.variables?.id === request.id;
                    return (
                      <article key={request.id} className="rounded-xl border border-border/70 bg-card p-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-medium">{member?.display_name ?? "Colaborador"}</p>
                            {member?.job_title && <p className="text-xs text-muted-foreground">{member.job_title}</p>}
                            <p className="mt-2 text-sm font-medium">
                              {kindLabel} · {formatHistoryDate(agencyDateKey(new Date(request.requested_punched_at)))} às {formatPunchTime(request.requested_punched_at)}
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">{request.reason}</p>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              disabled={reviewing}
                              onClick={() => reviewAdjustment.mutate({ id: request.id, status: "rejected" })}
                            >
                              <XCircle className="mr-1.5 h-4 w-4" /> Rejeitar
                            </Button>
                            <Button
                              size="sm"
                              disabled={reviewing}
                              onClick={() => reviewAdjustment.mutate({ id: request.id, status: "approved" })}
                            >
                              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Aprovar
                            </Button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-6">
              <SectionHeader
                title="Atestados pendentes"
                icon={Paperclip}
                action={
                  <StatusBadge variant="warning" size="sm">
                    {(teamAbsencesQuery.data ?? []).filter((absence) => absence.status === "pending").length} pendente(s)
                  </StatusBadge>
                }
              />
              {teamAbsencesQuery.isLoading ? (
                <Skeleton className="mt-4 h-24 rounded-2xl" />
              ) : (teamAbsencesQuery.data ?? []).filter((absence) => absence.status === "pending").length === 0 ? (
                <p className="mt-4 rounded-2xl border border-dashed border-border/70 px-5 py-6 text-center text-sm text-muted-foreground">
                  Nenhum atestado aguardando análise.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {(teamAbsencesQuery.data ?? [])
                    .filter((absence) => absence.status === "pending")
                    .map((absence) => {
                      const member = teamMembersQuery.data?.find((item) => item.user_id === absence.user_id);
                      const reviewing = reviewAbsence.isPending && reviewAbsence.variables?.id === absence.id;
                      return (
                        <article key={absence.id} className="rounded-xl border border-border/70 bg-card p-4">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="font-medium">{member?.display_name ?? "Colaborador"}</p>
                              {member?.job_title && <p className="text-xs text-muted-foreground">{member.job_title}</p>}
                              <p className="mt-2 text-sm font-medium">
                                {ABSENCE_KIND_LABEL[absence.kind]} · {formatHistoryDate(absence.start_date)}
                                {absence.end_date !== absence.start_date ? ` – ${formatHistoryDate(absence.end_date)}` : ""}
                              </p>
                              {absence.reason && <p className="mt-1 text-sm text-muted-foreground">{absence.reason}</p>}
                              {absence.file_path && (
                                <button
                                  type="button"
                                  onClick={() => openAbsenceFile(absence.file_path!)}
                                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                                >
                                  <Paperclip className="h-3.5 w-3.5" /> Ver atestado
                                </button>
                              )}
                            </div>
                            <div className="flex shrink-0 gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                disabled={reviewing}
                                onClick={() => reviewAbsence.mutate({ id: absence.id, status: "rejected" })}
                              >
                                <XCircle className="mr-1.5 h-4 w-4" /> Rejeitar
                              </Button>
                              <Button
                                size="sm"
                                disabled={reviewing}
                                onClick={() => reviewAbsence.mutate({ id: absence.id, status: "approved" })}
                              >
                                <CheckCircle2 className="mr-1.5 h-4 w-4" /> Aprovar
                              </Button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                </div>
              )}
            </div>

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
                        <TableHead className="text-right">Extras</TableHead>
                        <TableHead className="text-right">Negativas</TableHead>
                        <TableHead className="text-right">Banco de horas</TableHead>
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
                          <TableCell className="text-right tabular-nums text-success">
                            {total.extras > 0 ? formatBalance(total.extras) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-destructive">
                            {total.negativas > 0 ? formatBalance(-total.negativas) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            <span
                              className={cn(
                                total.saldo > 0 && "text-success",
                                total.saldo < 0 && "text-destructive",
                              )}
                            >
                              {formatBalance(total.saldo)}
                            </span>
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
                        <TableHead className="min-w-28">Saldo</TableHead>
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
                            {(() => {
                              const balance = dayBalanceSeconds(day);
                              if (balance === null) return <span className="text-muted-foreground">—</span>;
                              return (
                                <span
                                  className={cn(
                                    "font-semibold tabular-nums",
                                    balance > 0 && "text-success",
                                    balance < 0 && "text-destructive",
                                    balance === 0 && "text-muted-foreground",
                                  )}
                                >
                                  {formatBalance(balance)}
                                </span>
                              );
                            })()}
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

      <Dialog open={adjustmentOpen} onOpenChange={(open) => !requestAdjustment.isPending && setAdjustmentOpen(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar horário para análise</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              requestAdjustment.mutate();
            }}
          >
            <p className="text-sm text-muted-foreground">
              O horário não entra diretamente no ponto. A ADM precisa analisar e aprovar a solicitação.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="adjustment-date">Data</Label>
                <Input
                  id="adjustment-date"
                  type="date"
                  value={adjustmentDate}
                  max={agencyDateKey()}
                  onChange={(event) => setAdjustmentDate(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adjustment-time">Horário</Label>
                <Input
                  id="adjustment-time"
                  type="time"
                  value={adjustmentTime}
                  onChange={(event) => setAdjustmentTime(event.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de registro</Label>
              <Select value={adjustmentKind} onValueChange={(value: PunchKind) => setAdjustmentKind(value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PUNCH_STEPS.map((step) => (
                    <SelectItem key={step.kind} value={step.kind}>{step.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adjustment-reason">Justificativa</Label>
              <Textarea
                id="adjustment-reason"
                value={adjustmentReason}
                onChange={(event) => setAdjustmentReason(event.target.value)}
                placeholder="Explique por que este horário precisa ser incluído"
                rows={4}
                minLength={5}
                maxLength={1000}
                required
              />
              <p className="text-right text-[11px] text-muted-foreground">{adjustmentReason.length}/1000</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAdjustmentOpen(false)} disabled={requestAdjustment.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={requestAdjustment.isPending || adjustmentReason.trim().length < 5}>
                {requestAdjustment.isPending ? "Enviando..." : "Enviar para análise"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={absenceOpen} onOpenChange={(open) => !createAbsence.isPending && setAbsenceOpen(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar atestado</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              createAbsence.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="absence-start">Início</Label>
                <Input
                  id="absence-start"
                  type="date"
                  value={absenceStart}
                  onChange={(event) => setAbsenceStart(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="absence-end">Fim</Label>
                <Input
                  id="absence-end"
                  type="date"
                  value={absenceEnd}
                  onChange={(event) => setAbsenceEnd(event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="absence-kind">Tipo</Label>
              <Select value={absenceKind} onValueChange={(value: AbsenceKind) => setAbsenceKind(value)}>
                <SelectTrigger id="absence-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="atestado">Atestado</SelectItem>
                  <SelectItem value="folga">Folga</SelectItem>
                  <SelectItem value="ferias">Férias</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="absence-file">
                Arquivo (foto ou PDF){absenceKind === "atestado" ? " *" : ""}
              </Label>
              <Input
                id="absence-file"
                type="file"
                accept="image/*,application/pdf"
                onChange={(event) => setAbsenceFile(event.target.files?.[0] ?? null)}
              />
              <p className="text-[11px] text-muted-foreground">
                Máximo 10MB. Só você e a ADM/Head conseguem ver o arquivo.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="absence-reason">Observação (opcional)</Label>
              <Textarea
                id="absence-reason"
                value={absenceReason}
                onChange={(event) => setAbsenceReason(event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Ex.: consulta médica pela manhã"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setAbsenceOpen(false)} disabled={createAbsence.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createAbsence.isPending}>
                {createAbsence.isPending ? "Enviando…" : "Enviar atestado"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
