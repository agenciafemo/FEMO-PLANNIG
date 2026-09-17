import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  BriefcaseBusiness,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coffee,
  DoorOpen,
  Download,
  FileText,
  LogIn,
  LogOut,
  Paperclip,
  Pencil,
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
import { ReferenceClock } from "@/components/team/ReferenceClock";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import {
  ajusteCorrigeBatida,
  atrasou,
  batidaAposEntradaEsquecida,
  classificarBatida,
  contarDia,
  diasDoMes,
  direcaoNoHorario,
  estadoDoDia,
  perguntarPelaEntrada,
  saiuAntes,
  toleranciaDoDia,
  type PunchKind,
} from "@/lib/timeClockDia";

type IntervalTreatment = "abono" | "banco";

type TimeClockIntervalJustification = {
  id: string;
  organization_id: string;
  user_id: string;
  work_date: string;
  left_at: string;
  returned_at: string;
  minutes: number;
  reason: string;
  treatment: IntervalTreatment;
  status: AbsenceStatus;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

type TimeClockDayReview = {
  id: string;
  organization_id: string;
  user_id: string;
  work_date: string;
  motivos: string[];
  status: AbsenceStatus;
  review_note: string | null;
  reviewed_at: string | null;
};

type TimeClockDayNote = {
  id: string;
  organization_id: string;
  user_id: string;
  work_date: string;
  note: string;
  updated_at: string;
};

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
  in(column: string, values: unknown[]): TimeClockFilterBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): TimeClockFilterBuilder<T>;
  insert(values: Record<string, unknown>): TimeClockFilterBuilder<T>;
  update(values: Record<string, unknown>): TimeClockFilterBuilder<T>;
  upsert(values: Record<string, unknown>, options?: { onConflict?: string }): TimeClockFilterBuilder<T>;
  delete(): TimeClockFilterBuilder<T>;
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

// O retorno não tem horário de referência: acontece quando a pessoa volta.
const PASSO_VOLTA_INTERVALO = {
  kind: "volta_intervalo" as PunchKind,
  label: "Retorno",
  action: "Registrar retorno",
  reference: "—",
  icon: DoorOpen,
};

const PUNCH_KIND_LABEL: Record<PunchKind, string> = {
  entrada: "Entrada",
  saida_almoco: "Saída para almoço",
  volta_almoco: "Volta do almoço",
  saida: "Saída",
  saida_intervalo: "Saída no meio do dia",
  volta_intervalo: "Retorno",
};

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

// Mês no formato yyyy-MM deslocado em N meses.
function shiftMonth(monthKey: string, delta: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const total = year * 12 + (month - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthKey: string) {
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${monthKey}-15T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
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

/**
 * Traduz o estado do dia (regra compartilhada, espelho do servidor) no passo
 * que o botão principal oferece.
 */
function situacaoDoDia(punches: Array<{ kind: PunchKind }>) {
  const estado = estadoDoDia(punches.map((punch) => punch.kind));
  const principal =
    estado.proximo === null
      ? null
      : estado.proximo === "volta_intervalo"
        ? PASSO_VOLTA_INTERVALO
        : PUNCH_STEPS.find((step) => step.kind === estado.proximo) ?? null;
  return { ...estado, principal };
}

type HistoryDay = {
  dateKey: string;
  punches: Partial<Record<PunchKind, TimeClockPunch>>;
  /** Saídas no meio do dia já encerradas, na ordem em que aconteceram. */
  intervalos: Array<{ saida: TimeClockPunch; volta: TimeClockPunch; seconds: number }>;
  /** Saiu no meio do dia e ainda não voltou. */
  foraAgora: boolean;
  totalSeconds: number;
  /** Tempo fora abonado por ADM/Head: volta a contar como trabalhado. */
  abonoSeconds: number;
  /** Minutinhos perdoados pela tolerância (art. 58 §1º da CLT). */
  toleranciaSeconds: number;
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

      // A conta (pares entrou→saiu, tempo fora de fora) vive em timeClockDia,
      // testada à parte: é hora de gente.
      const conta = contarDia(ordered);
      const { totalSeconds, pares: pairCount, intervalos } = conta;

      // Marcações de horário respeitam 5 minutos de tolerância: 08:35 não é
      // atraso, 08:36 é. A conta das horas não muda com isso.
      const alerts: string[] = [];
      if (byKind.entrada && atrasou(agencySecondOfDay(byKind.entrada.punched_at), (8 * 60 + 30) * 60)) {
        alerts.push("Atraso na entrada");
      }
      if (byKind.saida_almoco && saiuAntes(agencySecondOfDay(byKind.saida_almoco.punched_at), 12 * 60 * 60)) {
        alerts.push("Saída antecipada de manhã");
      }
      if (byKind.volta_almoco && atrasou(agencySecondOfDay(byKind.volta_almoco.punched_at), 13 * 60 * 60)) {
        alerts.push("Atraso na volta");
      }
      if (byKind.saida && saiuAntes(agencySecondOfDay(byKind.saida.punched_at), (17 * 60 + 30) * 60)) {
        alerts.push("Saída antecipada");
      }

      if (intervalos.length > 0) {
        const foraSegundos = intervalos.reduce((soma, item) => soma + item.seconds, 0);
        alerts.push(`Saiu no meio do dia · ${formatWorkedDuration(foraSegundos)}`);
      }
      if (conta.foraAgora) alerts.push("Fora agora");

      const complete = PUNCH_STEPS.every((step) => byKind[step.kind]);
      if (!complete) alerts.push(dateKey === todayKey ? "Em andamento" : "Registro incompleto");

      return {
        dateKey,
        punches: byKind,
        intervalos,
        foraAgora: conta.foraAgora,
        totalSeconds,
        abonoSeconds: 0,
        toleranciaSeconds: toleranciaDoDia(
          Object.fromEntries(
            PUNCH_STEPS.filter((step) => byKind[step.kind]).map((step) => [
              step.kind,
              agencySecondOfDay(byKind[step.kind]!.punched_at),
            ]),
          ),
        ),
        partial: pairCount < 2,
        alerts,
      };
    })
    .sort((first, second) => second.dateKey.localeCompare(first.dateKey));
}

/**
 * Soma nos dias o tempo fora que ADM/Head abonou.
 *
 * O tempo entre a saída e o retorno já sai da conta sozinho (são duas batidas).
 * Abonar é justamente devolvê-lo: quem apresentou atestado não fica com hora
 * negativa. Pedido recusado ou "descontar do banco" não devolve nada.
 */
function aplicarAbonoDeIntervalos(
  days: HistoryDay[],
  justificativas: TimeClockIntervalJustification[],
): HistoryDay[] {
  if (justificativas.length === 0) return days;
  const abonoPorDia = new Map<string, number>();
  for (const item of justificativas) {
    if (item.status !== "approved" || item.treatment !== "abono") continue;
    abonoPorDia.set(item.work_date, (abonoPorDia.get(item.work_date) ?? 0) + item.minutes * 60);
  }
  if (abonoPorDia.size === 0) return days;
  return days.map((day) =>
    abonoPorDia.has(day.dateKey) ? { ...day, abonoSeconds: abonoPorDia.get(day.dateKey)! } : day,
  );
}

/** Dia sem nenhuma batida — existe só para aparecer na lista do mês. */
function diaVazio(dateKey: string, todayKey: string): HistoryDay {
  const futuro = dateKey > todayKey;
  const alerts: string[] = [];
  if (futuro) alerts.push("A registrar");
  else if (!isBusinessDay(dateKey)) alerts.push("Fim de semana");
  else alerts.push("Sem registro");

  return {
    dateKey,
    punches: {},
    intervalos: [],
    foraAgora: false,
    totalSeconds: 0,
    abonoSeconds: 0,
    toleranciaSeconds: 0,
    partial: false,
    alerts,
  };
}

/**
 * Mostra o mês inteiro, e não só os dias batidos.
 *
 * Quem olhava o histórico via apenas os dias com registro — o dia esquecido
 * simplesmente não existia na tela, e só aparecia como hora negativa no fim do
 * mês. Com o mês completo dá para ver o buraco na hora e anotar o motivo.
 */
function completarMes(days: HistoryDay[], monthKey: string, todayKey: string): HistoryDay[] {
  const datas = diasDoMes(monthKey);
  if (datas.length === 0) return days;
  const comRegistro = new Map(days.map((day) => [day.dateKey, day]));
  const completo: HistoryDay[] = datas.map(
    (dateKey) => comRegistro.get(dateKey) ?? diaVazio(dateKey, todayKey),
  );
  // Dias de outros meses (o histórico do mês corrente pode trazer a virada)
  // continuam na lista, para nada sumir.
  for (const day of days) {
    if (!day.dateKey.startsWith(`${monthKey}-`)) completo.push(day);
  }
  return completo.sort((first, second) => second.dateKey.localeCompare(first.dateKey));
}

const EXPECTED_DAILY_SECONDS = 8 * 60 * 60; // jornada padrão de 8h

function isBusinessDay(dateKey: string): boolean {
  const weekday = new Date(`${dateKey}T12:00:00-03:00`).getDay(); // 0=dom .. 6=sab
  return weekday >= 1 && weekday <= 5;
}

function isCompleteDay(day: HistoryDay): boolean {
  // Saiu no meio do dia e não voltou: o dia ainda está aberto, mesmo com as
  // quatro batidas principais registradas.
  if (day.foraAgora) return false;
  return PUNCH_STEPS.every((step) => day.punches[step.kind]);
}

// Saldo do dia em segundos (extra positivo / negativo). null = não entra no
// banco de horas (dia incompleto/em andamento). Dia útil espera 8h; fim de
// semana espera 0 (só gera extra, nunca negativa).
function dayBalanceSeconds(day: HistoryDay, abonoDates?: Set<string>): number | null {
  // Dia coberto por atestado aprovado é abonado: não gera negativa nem extra.
  if (abonoDates?.has(day.dateKey)) return null;
  if (!isCompleteDay(day)) return null;
  const diaUtil = isBusinessDay(day.dateKey);
  const expected = diaUtil ? EXPECTED_DAILY_SECONDS : 0;
  // O tempo fora abonado conta como trabalhado, e a tolerância devolve os
  // minutinhos de atraso/saída antecipada. No fim de semana não há horário de
  // referência, então não há o que tolerar.
  return day.totalSeconds + day.abonoSeconds + (diaUtil ? day.toleranciaSeconds : 0) - expected;
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
type TeamHourBankBaseline = { user_id: string; baseline_seconds: number; effective_from: string };

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
  // "outro" = a pessoa esteve fora e não sabe (nem precisa saber) se aquilo é
  // "saída no meio do dia" ou "retorno". Quem resolve é direcaoNoHorario.
  const [adjustmentKind, setAdjustmentKind] = useState<PunchKind | "outro">("entrada");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  // Primeira batida depois das 10h: chegando agora ou esqueceu a entrada?
  const [entradaEsquecidaOpen, setEntradaEsquecidaOpen] = useState(false);
  const [entradaEsquecidaHora, setEntradaEsquecidaHora] = useState("08:30");
  // Saída no meio do dia: o que fazer com as horas é perguntado na volta.
  const [justificarOpen, setJustificarOpen] = useState(false);
  const [justificarTratamento, setJustificarTratamento] = useState<IntervalTreatment>("abono");
  const [justificarMotivo, setJustificarMotivo] = useState("");
  const [intervaloParaJustificar, setIntervaloParaJustificar] = useState<
    { leftAt: string; returnedAt: string; minutos: number } | null
  >(null);
  // Observação numa data do histórico.
  const [notaData, setNotaData] = useState<string | null>(null);
  const [notaTexto, setNotaTexto] = useState("");
  const [absenceOpen, setAbsenceOpen] = useState(false);
  const [absenceStart, setAbsenceStart] = useState(() => agencyDateKey());
  const [absenceEnd, setAbsenceEnd] = useState(() => agencyDateKey());
  const [absenceKind, setAbsenceKind] = useState<AbsenceKind>("atestado");
  const [absenceReason, setAbsenceReason] = useState("");
  const [absenceFile, setAbsenceFile] = useState<File | null>(null);
  const currentMonth = todayKey.slice(0, 7);
  const [historyMonth, setHistoryMonth] = useState(currentMonth);
  const isCurrentHistoryMonth = historyMonth >= currentMonth;
  const historyRange = useMemo(
    () => ({
      start: agencyDayRange(`${historyMonth}-01`).start,
      end: isCurrentHistoryMonth
        ? dayRange.end
        : agencyDayRange(`${shiftMonth(historyMonth, 1)}-01`).start,
    }),
    [historyMonth, isCurrentHistoryMonth, dayRange.end]
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

  // Batidas já gravadas nos dias dos pedidos: quem aprova precisa ver que
  // "Entrada 08:30" vai TROCAR a entrada das 12:00, não criar outra.
  const pendingAdjustmentPunchesQuery = useQuery({
    queryKey: [
      "time-clock-pending-adjustment-punches",
      organizationId,
      (pendingAdjustmentsQuery.data ?? []).map((request) => request.id).join(","),
    ],
    queryFn: async () => {
      const pedidos = pendingAdjustmentsQuery.data ?? [];
      const dias = pedidos
        .map((pedido) => agencyDateKey(new Date(pedido.requested_punched_at)))
        .sort();
      const result = await timeClockSupabase
        .from<TimeClockPunch[]>("time_clock_punches")
        .select("*")
        .eq("organization_id", organizationId!)
        .in("user_id", [...new Set(pedidos.map((pedido) => pedido.user_id))])
        .gte("punched_at", agencyDayRange(dias[0]).start)
        .lt("punched_at", agencyDayRange(dias[dias.length - 1]).end)
        .order("punched_at", { ascending: true });
      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: !!organizationId && (pendingAdjustmentsQuery.data?.length ?? 0) > 0,
    retry: false,
  });

  const batidaQueOAjusteCorrige = (request: TimeClockAdjustmentRequest) => {
    if (!ajusteCorrigeBatida(request.kind)) return undefined;
    const dia = agencyDateKey(new Date(request.requested_punched_at));
    return (pendingAdjustmentPunchesQuery.data ?? []).find(
      (punch) =>
        punch.user_id === request.user_id &&
        punch.kind === request.kind &&
        agencyDateKey(new Date(punch.punched_at)) === dia,
    );
  };

  const pendingIntervalsQuery = useQuery({
    queryKey: ["time-clock-pending-intervals", organizationId],
    queryFn: async () => {
      const result = await timeClockSupabase
        .from<TimeClockIntervalJustification[]>("time_clock_interval_justifications")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("status", "pending")
        .order("work_date", { ascending: true });
      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: teamPermissionQuery.data === true && !!organizationId,
    refetchInterval: 30_000,
    retry: false,
  });

  const pendingDayReviewsQuery = useQuery({
    queryKey: ["time-clock-pending-day-reviews", organizationId],
    queryFn: async () => {
      const result = await timeClockSupabase
        .from<TimeClockDayReview[]>("time_clock_day_reviews")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("status", "pending")
        .order("work_date", { ascending: true });
      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: teamPermissionQuery.data === true && !!organizationId,
    refetchInterval: 30_000,
    retry: false,
  });

  // Observações da equipe no período consultado: dão contexto na hora de
  // aprovar (o "saí às 10h para o médico" fica junto do dia).
  const teamDayNotesQuery = useQuery({
    queryKey: ["time-clock-team-day-notes", organizationId, periodStart, periodEnd],
    queryFn: async () => {
      const result = await timeClockSupabase
        .from<TimeClockDayNote[]>("time_clock_day_notes")
        .select("*")
        .eq("organization_id", organizationId!)
        .gte("work_date", periodStart);
      if (result.error) throw result.error;
      // periodEnd é inclusivo na tela; o filtro do fim fica aqui para não
      // perder o último dia por causa do "menor que".
      return (result.data ?? []).filter((nota) => nota.work_date <= periodEnd);
    },
    enabled: teamPermissionQuery.data === true && !!organizationId && teamPeriodValid,
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

  // Memorizado porque entra em useMemo mais abaixo: `?? []` cria um array novo
  // a cada render e refaria a conta sem necessidade.
  const punches = useMemo(() => punchesQuery.data ?? [], [punchesQuery.data]);
  // Ajustes de hoje ainda em análise entram na sequência pelo horário pedido,
  // igual ao servidor (prepare_time_clock_punch). Sem isso o botão pediria de
  // novo uma batida que já está aguardando aprovação.
  const todayPendingAdjustments = useMemo(
    () =>
      (myAdjustmentsQuery.data ?? []).filter(
        (request) =>
          request.status === "pending" &&
          agencyDateKey(new Date(request.requested_punched_at)) === todayKey,
      ),
    [myAdjustmentsQuery.data, todayKey],
  );
  const situacaoDeHoje = situacaoDoDia(
    [
      ...punches.map((punch) => ({ kind: punch.kind, at: new Date(punch.punched_at).getTime() })),
      ...todayPendingAdjustments.map((request) => ({
        kind: request.kind,
        at: new Date(request.requested_punched_at).getTime(),
      })),
    ].sort((first, second) => first.at - second.at),
  );
  const nextStep = situacaoDeHoje.principal;
  // Rótulo neutro: o app não promete almoço às 08:47. Quem está dentro
  // "registra saída" — o horário é que decide se aquilo foi almoço, saída no
  // meio do dia ou fim de jornada.
  // Sem entrada e já passou das 10h: pode ser chegada tarde ou entrada
  // esquecida. O botão não promete "entrada" — a pergunta vem no clique.
  const semEntradaDepoisDaJanela = perguntarPelaEntrada(
    situacaoDeHoje,
    agencySecondOfDay(new Date().toISOString()),
  );
  const acaoDoBotao = situacaoDeHoje.encerrado
    ? "Jornada concluída"
    : semEntradaDepoisDaJanela
      ? "Registrar ponto"
      : situacaoDeHoje.proximo === "entrada"
      ? "Registrar entrada"
      : situacaoDeHoje.proximo === "volta_almoco" || situacaoDeHoje.proximo === "volta_intervalo"
        ? "Registrar retorno"
        : "Registrar saída";

  const historyQuery = useQuery({
    queryKey: ["time-clock-history", organizationId, user?.id, todayKey, historyMonth],
    queryFn: async () => {
      const result = await timeClockSupabase
        .from<TimeClockPunch[]>("time_clock_punches")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("user_id", user!.id)
        .gte("punched_at", historyRange.start)
        .lt("punched_at", historyRange.end)
        .order("punched_at", { ascending: false });

      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: !!user && !!organizationId && !isLegacy,
  });

  // Saídas no meio do dia: o que foi abonado volta para as horas do dia, e o
  // que está pendente aparece na lista para a pessoa cobrar resposta.
  const myIntervalsQuery = useQuery({
    queryKey: ["time-clock-my-intervals", organizationId, user?.id],
    queryFn: async () => {
      const result = await timeClockSupabase
        .from<TimeClockIntervalJustification[]>("time_clock_interval_justifications")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("user_id", user!.id)
        .order("work_date", { ascending: false });
      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: !!user && !!organizationId && !isLegacy,
    retry: false,
  });

  // Datas marcadas por batida fora da jornada (horário atípico ou fim de
  // semana). Quem resolve é ADM/Head.
  const myDayReviewsQuery = useQuery({
    queryKey: ["time-clock-my-day-reviews", organizationId, user?.id],
    queryFn: async () => {
      const result = await timeClockSupabase
        .from<TimeClockDayReview[]>("time_clock_day_reviews")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("user_id", user!.id)
        .order("work_date", { ascending: false });
      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: !!user && !!organizationId && !isLegacy,
    retry: false,
  });

  const revisaoPorDia = useMemo(() => {
    const mapa = new Map<string, TimeClockDayReview>();
    for (const revisao of myDayReviewsQuery.data ?? []) mapa.set(revisao.work_date, revisao);
    return mapa;
  }, [myDayReviewsQuery.data]);

  const myDayNotesQuery = useQuery({
    queryKey: ["time-clock-day-notes", organizationId, user?.id, historyMonth],
    queryFn: async () => {
      const result = await timeClockSupabase
        .from<TimeClockDayNote[]>("time_clock_day_notes")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("user_id", user!.id)
        .gte("work_date", `${historyMonth}-01`)
        .lt("work_date", `${shiftMonth(historyMonth, 1)}-01`);
      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: !!user && !!organizationId && !isLegacy,
    retry: false,
  });

  // Saídas de hoje que ainda não viraram pedido para a ADM.
  const intervalosDeHojeSemJustificativa = useMemo(() => {
    const pares: Array<{ leftAt: string; returnedAt: string; minutos: number; motivo: string }> = [];
    let aberta: TimeClockPunch | null = null;
    for (const punch of punches) {
      if (punch.kind === "saida_intervalo") {
        aberta = punch;
      } else if (punch.kind === "volta_intervalo" && aberta) {
        pares.push({
          leftAt: aberta.punched_at,
          returnedAt: punch.punched_at,
          minutos: Math.max(
            1,
            Math.round((new Date(punch.punched_at).getTime() - new Date(aberta.punched_at).getTime()) / 60000),
          ),
          motivo: aberta.note ?? "",
        });
        aberta = null;
      }
    }
    const jaEnviados = new Set(
      (myIntervalsQuery.data ?? []).map((item) => new Date(item.left_at).getTime()),
    );
    return pares.filter((par) => !jaEnviados.has(new Date(par.leftAt).getTime()));
  }, [punches, myIntervalsQuery.data]);

  // Horários pedidos e ainda não respondidos, por dia e tipo de batida: a
  // linha do histórico mostra o que foi solicitado, senão a pessoa manda o
  // pedido e continua vendo o dia vazio, sem saber se foi.
  const ajustePendentePara = useMemo(() => {
    const mapa = new Map<string, TimeClockAdjustmentRequest>();
    for (const pedido of myAdjustmentsQuery.data ?? []) {
      if (pedido.status !== "pending") continue;
      const chave = `${agencyDateKey(new Date(pedido.requested_punched_at))}|${pedido.kind}`;
      // Se houver mais de um para a mesma batida, o mais recente manda.
      mapa.set(chave, pedido);
    }
    return (dateKey: string, kind: PunchKind) => mapa.get(`${dateKey}|${kind}`);
  }, [myAdjustmentsQuery.data]);

  // Batidas de cada dia do mês em segundos, para resolver o horário "Outro".
  const batidasPorDia = useMemo(() => {
    const mapa = new Map<string, Array<{ kind: PunchKind; segundo: number }>>();
    for (const punch of historyQuery.data ?? []) {
      const dia = agencyDateKey(new Date(punch.punched_at));
      mapa.set(dia, [
        ...(mapa.get(dia) ?? []),
        { kind: punch.kind, segundo: agencySecondOfDay(punch.punched_at) },
      ]);
    }
    return mapa;
  }, [historyQuery.data]);

  const ajustesPendentesDoDia = useMemo(() => {
    const mapa = new Map<string, TimeClockAdjustmentRequest[]>();
    for (const pedido of myAdjustmentsQuery.data ?? []) {
      if (pedido.status !== "pending") continue;
      const dia = agencyDateKey(new Date(pedido.requested_punched_at));
      mapa.set(dia, [...(mapa.get(dia) ?? []), pedido]);
    }
    return (dateKey: string) => mapa.get(dateKey) ?? [];
  }, [myAdjustmentsQuery.data]);

  const notaPorDia = useMemo(() => {
    const mapa = new Map<string, TimeClockDayNote>();
    for (const nota of myDayNotesQuery.data ?? []) mapa.set(nota.work_date, nota);
    return mapa;
  }, [myDayNotesQuery.data]);

  const intervalosPorDia = useMemo(() => {
    const mapa = new Map<string, TimeClockIntervalJustification[]>();
    for (const item of myIntervalsQuery.data ?? []) {
      mapa.set(item.work_date, [...(mapa.get(item.work_date) ?? []), item]);
    }
    return mapa;
  }, [myIntervalsQuery.data]);

  const historyDays = useMemo(
    () =>
      completarMes(
        aplicarAbonoDeIntervalos(
          summarizeHistory(historyQuery.data ?? [], todayKey),
          myIntervalsQuery.data ?? [],
        ),
        historyMonth,
        todayKey,
      ),
    [historyQuery.data, todayKey, myIntervalsQuery.data, historyMonth]
  );

  const myAbonoDates = useMemo(
    () => abonoDatesFrom(myAbsencesQuery.data ?? []),
    [myAbsencesQuery.data],
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
    const days = aplicarAbonoDeIntervalos(
      summarizeHistory(bankPunchesQuery.data ?? [], todayKey),
      myIntervalsQuery.data ?? [],
    ).filter((day) => day.dateKey >= baseline.effective_from);
    return baseline.baseline_seconds + summarizeBalance(days, myAbonoDates).saldo;
  }, [bankBaselineQuery.data, bankPunchesQuery.data, todayKey, myAbonoDates, myIntervalsQuery.data]);

  // Resumo do mês escolhido. Horas trabalhadas contam todos os dias; extras,
  // negativas e saldo pulam os dias anteriores à data de corte, que já estão
  // dentro do saldo de abertura (contá-los de novo contradiz o acumulado).
  const personalBalance = useMemo(() => {
    const days = bankEffectiveFrom
      ? historyDays.filter((day) => day.dateKey >= bankEffectiveFrom)
      : historyDays;
    return {
      ...summarizeBalance(days, myAbonoDates),
      worked: historyDays.reduce((sum, day) => sum + day.totalSeconds, 0),
      // Só avisa da data de corte se existir ponto batido antes dela — a lista
      // agora traz o mês inteiro, e dia vazio não significa hora fora da conta.
      hasDaysBeforeCutoff: historyDays.some(
        (day) =>
          !!bankEffectiveFrom &&
          day.dateKey < bankEffectiveFrom &&
          Object.keys(day.punches).length > 0,
      ),
    };
  }, [historyDays, bankEffectiveFrom, myAbonoDates]);

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

  // Saldos de abertura (banco acumulado) de toda a equipe. Best-effort: se a
  // tabela não existir, o acúmulo simplesmente não aparece.
  const teamBaselinesQuery = useQuery({
    queryKey: ["time-clock-team-baselines", organizationId],
    queryFn: async () => {
      try {
        const result = await timeClockSupabase
          .from<TeamHourBankBaseline[]>("time_clock_hour_bank_baseline")
          .select("user_id,baseline_seconds,effective_from")
          .eq("organization_id", organizationId!);
        if (result.error) return [];
        return (result.data ?? []) as TeamHourBankBaseline[];
      } catch {
        return [];
      }
    },
    enabled: teamPermissionQuery.data === true && !!organizationId,
    retry: false,
  });
  const teamBankStart = useMemo(() => {
    const rows = teamBaselinesQuery.data ?? [];
    if (rows.length === 0) return null;
    return rows.reduce((min, row) => (row.effective_from < min ? row.effective_from : min), rows[0].effective_from);
  }, [teamBaselinesQuery.data]);
  // Pontos de toda a equipe desde a data de corte mais antiga (independente do
  // filtro de período), para acumular o banco sobre o baseline.
  const teamBankPunchesQuery = useQuery({
    queryKey: ["time-clock-team-bank-punches", organizationId, teamBankStart, todayKey],
    queryFn: async () => {
      const result = await timeClockSupabase
        .from<TimeClockPunch[]>("time_clock_punches")
        .select("*")
        .eq("organization_id", organizationId!)
        .gte("punched_at", agencyDayRange(teamBankStart!).start)
        .lt("punched_at", dayRange.end)
        .order("punched_at", { ascending: true });
      if (result.error) throw result.error;
      return result.data ?? [];
    },
    enabled: teamPermissionQuery.data === true && !!organizationId && !!teamBankStart,
  });
  const teamAccumulated = useMemo(() => {
    const baselines = new Map((teamBaselinesQuery.data ?? []).map((row) => [row.user_id, row]));
    const punchesByMember = new Map<string, TimeClockPunch[]>();
    (teamBankPunchesQuery.data ?? []).forEach((punch) => {
      punchesByMember.set(punch.user_id, [...(punchesByMember.get(punch.user_id) ?? []), punch]);
    });
    const map = new Map<string, number | null>();
    visibleTeamMembers.forEach((member) => {
      const baseline = baselines.get(member.user_id);
      if (!baseline) {
        map.set(member.user_id, null);
        return;
      }
      const days = summarizeHistory(punchesByMember.get(member.user_id) ?? [], todayKey)
        .filter((day) => day.dateKey >= baseline.effective_from);
      const { saldo } = summarizeBalance(days, teamAbonoByUser.get(member.user_id));
      map.set(member.user_id, baseline.baseline_seconds + saldo);
    });
    return map;
  }, [teamBaselinesQuery.data, teamBankPunchesQuery.data, visibleTeamMembers, todayKey, teamAbonoByUser]);

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

  /**
   * Um botão só. O horário decide o que é a batida (classificarBatida), e o
   * servidor confirma pelo relógio dele — o cliente só sugere.
   *
   * Antes a tela oferecia a próxima etapa da jornada: às 08:47, com a entrada
   * batida, o botão dizia "Registrar saída para almoço", e quem saísse às 09:00
   * para o médico gravava almoço sem querer.
   */
  const baterPonto = useMutation({
    // entradaEsquecida = "HH:mm" quando a pessoa diz que chegou antes e não
    // bateu. A entrada vai como pedido de ajuste ANTES da batida: o servidor
    // conta ajuste pendente na sequência, então a batida de agora já é saída.
    mutationFn: async (entradaEsquecida?: string) => {
      if (!user || !organizationId) throw new Error("Organização ou usuário indisponível.");

      const agora = new Date();
      const segundoAgora = agencySecondOfDay(agora.toISOString());
      let sugestao = classificarBatida(
        situacaoDeHoje,
        segundoAgora,
        punches.some((punch) => punch.kind === "saida_almoco"),
      );

      if (entradaEsquecida) {
        const entradaEm = new Date(`${todayKey}T${entradaEsquecida}:00-03:00`);
        if (Number.isNaN(entradaEm.getTime()) || entradaEm.getTime() >= agora.getTime()) {
          throw new Error("Informe um horário de chegada anterior a agora.");
        }
        const pedido = await timeClockSupabase
          .from<null>("time_clock_adjustment_requests")
          .insert({
            organization_id: organizationId,
            user_id: user.id,
            requested_punched_at: entradaEm.toISOString(),
            kind: "entrada",
            reason: "Esqueci de bater a entrada.",
          });
        if (pedido.error) throw pedido.error;
        sugestao = batidaAposEntradaEsquecida(segundoAgora);
      }

      const result = await timeClockSupabase.from<null>("time_clock_punches").insert({
        organization_id: organizationId,
        user_id: user.id,
        kind: sugestao,
      });
      if (result.error) throw result.error;

      const saidaAberta = [...punches].reverse().find((punch) => punch.kind === "saida_intervalo");
      return saidaAberta ?? null;
    },
    onSuccess: async (saidaAberta) => {
      setEntradaEsquecidaOpen(false);
      const atualizados = await punchesQuery.refetch();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-clock-my-adjustments", organizationId, user?.id] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-pending-adjustments", organizationId] }),
        queryClient.invalidateQueries({
          queryKey: ["time-clock-history", organizationId, user?.id, todayKey],
        }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-team-history", organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-my-day-reviews", organizationId, user?.id] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-pending-day-reviews", organizationId] }),
      ]);

      const registrada = (atualizados.data ?? []).at(-1);
      if (!registrada) {
        toast.success("Ponto registrado.");
        return;
      }

      // Diz o que ficou gravado: com um botão só, a pessoa precisa ver o tipo.
      toast.success(
        `${PUNCH_KIND_LABEL[registrada.kind]} às ${formatPunchTime(registrada.punched_at)}.`,
      );

      // Voltou de uma saída no meio do dia: é a hora de dizer o que fazer com
      // o tempo fora.
      if (registrada.kind === "volta_intervalo" && saidaAberta) {
        const minutos = Math.max(
          1,
          Math.round(
            (new Date(registrada.punched_at).getTime() - new Date(saidaAberta.punched_at).getTime()) / 60000,
          ),
        );
        setIntervaloParaJustificar({
          leftAt: saidaAberta.punched_at,
          returnedAt: registrada.punched_at,
          minutos,
        });
        setJustificarMotivo(saidaAberta.note ?? "");
        setJustificarTratamento("abono");
        setJustificarOpen(true);
      }
    },
    onError: async (error: QueryError) => {
      // Se o pedido da entrada saiu e só a batida falhou, a tela precisa saber
      // do pedido: no próximo clique o botão já não pergunta de novo.
      await queryClient.invalidateQueries({ queryKey: ["time-clock-my-adjustments", organizationId, user?.id] });
      toast.error(error.message || "Não foi possível registrar o ponto.");
    },
  });

  // O tempo fora sempre sai da conta do dia. Esta justificativa é o que decide
  // se ele volta (abono com atestado) ou sai mesmo do banco de horas — e ADM
  // ou Head precisa responder.
  const justificarIntervalo = useMutation({
    mutationFn: async () => {
      if (!user || !organizationId) throw new Error("Organização ou usuário indisponível.");
      if (!intervaloParaJustificar) throw new Error("Nenhuma saída para justificar.");
      if (justificarMotivo.trim().length < 3) throw new Error("Escreva o motivo da saída.");

      const result = await timeClockSupabase
        .from<null>("time_clock_interval_justifications")
        .insert({
          organization_id: organizationId,
          user_id: user.id,
          work_date: agencyDateKey(new Date(intervaloParaJustificar.leftAt)),
          left_at: intervaloParaJustificar.leftAt,
          returned_at: intervaloParaJustificar.returnedAt,
          minutes: intervaloParaJustificar.minutos,
          reason: justificarMotivo.trim(),
          treatment: justificarTratamento,
        });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["time-clock-my-intervals", organizationId, user?.id] });
      setJustificarOpen(false);
      setIntervaloParaJustificar(null);
      setJustificarMotivo("");
      toast.success("Enviado para a ADM responder.");
    },
    onError: (error: QueryError) => toast.error(error.message || "Não foi possível enviar a justificativa."),
  });

  const salvarObservacao = useMutation({
    mutationFn: async ({ dateKey, texto }: { dateKey: string; texto: string }) => {
      if (!user || !organizationId) throw new Error("Organização ou usuário indisponível.");
      const limpo = texto.trim();

      if (!limpo) {
        const result = await timeClockSupabase
          .from<null>("time_clock_day_notes")
          .delete()
          .eq("organization_id", organizationId)
          .eq("user_id", user.id)
          .eq("work_date", dateKey);
        if (result.error) throw result.error;
        return;
      }

      const result = await timeClockSupabase
        .from<null>("time_clock_day_notes")
        .upsert(
          {
            organization_id: organizationId,
            user_id: user.id,
            work_date: dateKey,
            note: limpo,
          },
          { onConflict: "organization_id,user_id,work_date" },
        );
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["time-clock-day-notes", organizationId, user?.id, historyMonth],
      });
      setNotaData(null);
      setNotaTexto("");
      toast.success("Observação salva.");
    },
    onError: (error: QueryError) => toast.error(error.message || "Não foi possível salvar a observação."),
  });

  const requestAdjustment = useMutation({
    // A data vem por parâmetro quando o pedido nasce de um dia do histórico:
    // guardar no estado antes de chamar não funcionaria, porque o setState só
    // vale no próximo render e a mutação leria a data anterior — erraria o dia.
    mutationFn: async (dataEscolhida?: string) => {
      if (!user || !organizationId) throw new Error("Organização ou usuário indisponível.");
      if (adjustmentReason.trim().length < 5) {
        throw new Error("Explique o motivo do ajuste com pelo menos 5 caracteres.");
      }
      const dia = dataEscolhida ?? adjustmentDate;
      const requestedAt = new Date(`${dia}T${adjustmentTime}:00-03:00`);
      // "Outro": o sistema descobre se falta a saída ou o retorno olhando onde
      // aquele horário cai na sequência do dia. A pessoa não precisa escolher
      // entre dois nomes que significam a mesma coisa para ela.
      const kindResolvido: PunchKind = adjustmentKind === "outro"
        ? direcaoNoHorario(
            batidasPorDia.get(dia) ?? [],
            agencySecondOfDay(requestedAt.toISOString()),
          )
        : adjustmentKind;
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
          kind: kindResolvido,
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
      // O painel do dia segue aberto de propósito: a pessoa vê o pedido
      // entrar na linha "Em análise pela ADM" daquele mesmo dia.
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
        queryClient.invalidateQueries({ queryKey: ["time-clock-pending-adjustment-punches", organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-punches", organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-history", organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-team-history", organizationId] }),
      ]);
      toast.success(variables.status === "approved" ? "Ajuste aprovado. O ponto foi atualizado." : "Ajuste rejeitado.");
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

  const reviewInterval = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      if (!organizationId) throw new Error("Organização indisponível.");
      const result = await timeClockSupabase
        .from<null>("time_clock_interval_justifications")
        .update({ status })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .eq("status", "pending");
      if (result.error) throw result.error;
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-clock-pending-intervals", organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-my-intervals", organizationId] }),
      ]);
      toast.success(
        variables.status === "approved"
          ? "Respondido: a pessoa já foi avisada."
          : "Pedido recusado. A pessoa foi avisada.",
      );
    },
    onError: (error: QueryError) => toast.error(error.message || "Não foi possível responder o pedido."),
  });

  const reviewDay = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      if (!organizationId) throw new Error("Organização indisponível.");
      const result = await timeClockSupabase
        .from<null>("time_clock_day_reviews")
        .update({ status })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .eq("status", "pending");
      if (result.error) throw result.error;
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-clock-pending-day-reviews", organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["time-clock-my-day-reviews", organizationId] }),
      ]);
      toast.success(
        variables.status === "approved" ? "Dia aprovado. A pessoa foi avisada." : "Dia recusado. A pessoa foi avisada.",
      );
    },
    onError: (error: QueryError) => toast.error(error.message || "Não foi possível responder a revisão."),
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

        <div className="mt-6 grid gap-4 sm:max-w-sm">
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
            <ReferenceClock timeZone={AGENCY_TIME_ZONE} />

            {/* Um botão só: o horário decide se é entrada, saída, almoço ou
                saída no meio do dia. Nada de oferecer "saída para o almoço"
                às 08:47 só porque é a próxima etapa da jornada. */}
            <Button
              type="button"
              size="lg"
              className="mt-7 h-16 w-full rounded-2xl text-base font-semibold shadow-md sm:text-lg"
              disabled={
                loading || baterPonto.isPending || situacaoDeHoje.encerrado
                || !organizationId || isLegacy
              }
              onClick={() => {
                // Confere na hora do clique, não no último render.
                if (perguntarPelaEntrada(situacaoDeHoje, agencySecondOfDay(new Date().toISOString()))) {
                  setEntradaEsquecidaHora("08:30");
                  setEntradaEsquecidaOpen(true);
                  return;
                }
                baterPonto.mutate(undefined);
              }}
            >
              <Clock3 className="mr-2 h-5 w-5" />
              {baterPonto.isPending ? "Registrando..." : acaoDoBotao}
            </Button>

            {situacaoDeHoje.proximo === "volta_intervalo" && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Você está fora desde {formatPunchTime(
                  [...punches].reverse().find((punch) => punch.kind === "saida_intervalo")?.punched_at
                    ?? new Date().toISOString(),
                )}. O tempo fora sai da conta do dia até a ADM responder.
              </p>
            )}

            {intervalosDeHojeSemJustificativa.length > 0 && (
              <div className="mt-4 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm">
                <p className="font-medium">Saída no meio do dia sem justificativa</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Diga o que fazer com esse tempo para a ADM responder — senão ele fica como hora negativa.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {intervalosDeHojeSemJustificativa.map((par) => (
                    <Button
                      key={par.leftAt}
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setIntervaloParaJustificar(par);
                        setJustificarMotivo(par.motivo);
                        setJustificarTratamento("abono");
                        setJustificarOpen(true);
                      }}
                    >
                      Justificar {formatPunchTime(par.leftAt)}–{formatPunchTime(par.returnedAt)} ({par.minutos} min)
                    </Button>
                  ))}
                </div>
              </div>
            )}

          </section>
        </div>

        <section className="mt-8">
          <SectionHeader
            title="Registros de hoje"
            count={punches.length + todayPendingAdjustments.length}
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
          ) : punches.length === 0 && todayPendingAdjustments.length === 0 ? (
            <EmptyState
              className="mt-4"
              icon={Clock3}
              title="Nenhum registro hoje"
              description={`Use o botão ${acaoDoBotao} para iniciar sua jornada.`}
            />
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {PUNCH_STEPS.map((step) => {
                const punch = findPunch(punches, step.kind);
                const pendingAdjustment = punch
                  ? undefined
                  : todayPendingAdjustments.find((request) => request.kind === step.kind);
                const isNext = nextStep?.kind === step.kind;
                const Icon = step.icon;

                return (
                  <article
                    key={step.kind}
                    className={cn(
                      "rounded-2xl border bg-card p-4 shadow-sm transition-colors",
                      punch && "border-success/25 bg-success/5",
                      pendingAdjustment && "border-warning/30 bg-warning/5",
                      isNext && "border-primary/35 ring-1 ring-primary/15"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-xl",
                        punch
                          ? "bg-success/10 text-success"
                          : pendingAdjustment
                            ? "bg-warning/10 text-warning"
                            : "bg-muted text-muted-foreground"
                      )}>
                        <Icon className="h-4.5 w-4.5" />
                      </div>
                      {punch && <CheckCircle2 className="h-4 w-4 text-success" />}
                      {pendingAdjustment && <StatusBadge variant="warning" size="sm">Em análise</StatusBadge>}
                    </div>
                    <p className="mt-4 text-sm font-medium">{step.label}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {punch
                        ? formatPunchTime(punch.punched_at)
                        : pendingAdjustment
                          ? formatPunchTime(pendingAdjustment.requested_punched_at)
                          : "--:--"}
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
            count={historyDays.filter((day) => Object.keys(day.punches).length > 0).length}
            icon={CalendarRange}
            action={
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Mês anterior"
                  onClick={() => setHistoryMonth((month) => shiftMonth(month, -1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-32 text-center text-sm font-medium tabular-nums">
                  {formatMonthLabel(historyMonth)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Próximo mês"
                  disabled={isCurrentHistoryMonth}
                  onClick={() => setHistoryMonth((month) => shiftMonth(month, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            }
          />

          {historyDays.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-3 py-1.5 text-xs">
                <span className="text-muted-foreground">Trabalhadas</span>
                <span className="font-semibold tabular-nums">{formatWorkedDuration(personalBalance.worked)}</span>
              </span>
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
                <span className="text-muted-foreground">Saldo do mês</span>
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
          {personalBalance.hasDaysBeforeCutoff && bankEffectiveFrom && (
            <p className="mt-2 text-xs text-muted-foreground">
              Extras, negativas e saldo contam a partir de {formatHistoryDate(bankEffectiveFrom)}. Antes disso, as horas
              já estão no saldo de abertura do banco.
            </p>
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
              title={isCurrentHistoryMonth ? "Histórico vazio" : "Nenhum registro neste mês"}
              description={
                isCurrentHistoryMonth
                  ? "Os dias com registros de ponto aparecerão aqui."
                  : "Não há pontos batidos em " + formatMonthLabel(historyMonth).toLowerCase() + "."
              }
            />
          ) : (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-border/70 bg-card shadow-sm">
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
                    <TableHead className="min-w-48">Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyDays.map((day) => {
                    const semRegistro = Object.keys(day.punches).length === 0;
                    const futuro = day.dateKey > todayKey;
                    const nota = notaPorDia.get(day.dateKey);
                    const pedidosDoDia = intervalosPorDia.get(day.dateKey) ?? [];
                    const revisaoDoDia = revisaoPorDia.get(day.dateKey);
                    return (
                    <TableRow
                      key={day.dateKey}
                      className={cn(
                        futuro && "opacity-55",
                        day.dateKey === todayKey && "bg-brand-soft/30",
                      )}
                    >
                      {/* O botão fica colado no dia: primeira coluna, sempre
                          visível, sem como errar a data. Na última coluna ele
                          exigia rolagem lateral e aparecia cortado. */}
                      <TableCell className={cn("align-top font-medium capitalize", semRegistro && "text-muted-foreground")}>
                        <div className="flex flex-col items-start gap-1">
                          <span>{formatHistoryDate(day.dateKey)}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-[11px] font-normal normal-case text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              setNotaData(day.dateKey);
                              setNotaTexto(nota?.note ?? "");
                              setAdjustmentDate(day.dateKey);
                              setAdjustmentReason("");
                            }}
                          >
                            <Pencil className="mr-1 h-3 w-3" /> Editar hora
                          </Button>
                          {nota && (
                            <span className="line-clamp-2 text-[11px] font-normal normal-case text-muted-foreground">
                              {nota.note}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      {PUNCH_STEPS.map((step) => {
                        const batida = day.punches[step.kind];
                        const pedido = ajustePendentePara(day.dateKey, step.kind);
                        return (
                          <TableCell key={step.kind} className="text-center font-medium tabular-nums">
                            {batida ? (
                              <>
                                {formatPunchTime(batida.punched_at)}
                                {/* Correção pedida: o horário atual só é
                                    trocado quando a ADM aprovar. */}
                                {pedido && (
                                  <span className="block text-[10px] font-normal text-warning" title="Aguardando a ADM aprovar">
                                    → {formatPunchTime(pedido.requested_punched_at)} em análise
                                  </span>
                                )}
                              </>
                            ) : pedido ? (
                              // O horário pedido aparece aqui na hora: antes a
                              // pessoa mandava e a linha continuava vazia, sem
                              // sinal de que a solicitação tinha saído.
                              <span className="text-warning" title="Aguardando a ADM aprovar">
                                {formatPunchTime(pedido.requested_punched_at)}
                                <span className="ml-1 text-[10px] font-normal">em análise</span>
                              </span>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        );
                      })}
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
                            <>
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
                            </>
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
                                variant={
                                  alert === "Em andamento" ? "info"
                                    : alert === "A registrar" || alert === "Fim de semana" ? "neutral"
                                      : "warning"
                                }
                                size="sm"
                              >
                                {alert}
                              </StatusBadge>
                            ))}
                          </div>
                        )}
                        {/* Bateu fora da jornada: a data espera ADM/Head. */}
                        {revisaoDoDia && (
                          <p
                            className={cn(
                              "mt-1 text-[11px]",
                              revisaoDoDia.status === "pending" && "text-warning",
                              revisaoDoDia.status === "approved" && "text-success",
                              revisaoDoDia.status === "rejected" && "text-destructive",
                            )}
                            title={revisaoDoDia.motivos.join(" · ")}
                          >
                            {revisaoDoDia.status === "pending"
                              ? "Fora do horário — em revisão pela ADM"
                              : revisaoDoDia.status === "approved"
                                ? "Fora do horário — aprovado"
                                : "Fora do horário — recusado"}
                          </p>
                        )}
                        {/* Confirmação visível de que o pedido saiu. Cobre
                            qualquer tipo: o "Outro" vira saída/retorno, que não
                            têm coluna própria e sumiriam da linha. */}
                        {ajustesPendentesDoDia(day.dateKey).length > 0 && (
                          <p className="mt-1 text-[11px] text-warning">
                            Enviado — aguardando a ADM:{" "}
                            {ajustesPendentesDoDia(day.dateKey)
                              .map((pedido) =>
                                `${PUNCH_KIND_LABEL[pedido.kind]} ${formatPunchTime(pedido.requested_punched_at)}`)
                              .join(" · ")}
                          </p>
                        )}
                        {/* O que a ADM respondeu (ou ainda não) sobre o tempo fora. */}
                        {pedidosDoDia.map((pedido) => (
                          <p key={pedido.id} className="mt-1 text-[11px] text-muted-foreground">
                            {pedido.minutes} min fora ·{" "}
                            {pedido.status === "pending"
                              ? "aguardando a ADM"
                              : pedido.status === "approved"
                                ? pedido.treatment === "abono" ? "abonado" : "descontado do banco"
                                : "recusado"}
                          </p>
                        ))}
                      </TableCell>
                    </TableRow>
                    );
                  })}
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
                    const kindLabel = PUNCH_KIND_LABEL[request.kind] ?? request.kind;
                    const reviewing = reviewAdjustment.isPending && reviewAdjustment.variables?.id === request.id;
                    const corrige = batidaQueOAjusteCorrige(request);
                    return (
                      <article key={request.id} className="rounded-xl border border-border/70 bg-card p-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-medium">{member?.display_name ?? "Colaborador"}</p>
                            {member?.job_title && <p className="text-xs text-muted-foreground">{member.job_title}</p>}
                            <p className="mt-2 text-sm font-medium">
                              {kindLabel} · {formatHistoryDate(agencyDateKey(new Date(request.requested_punched_at)))} às {formatPunchTime(request.requested_punched_at)}
                            </p>
                            {corrige && (
                              <p className="mt-1 text-xs font-medium text-warning">
                                Corrige o horário registrado às {formatPunchTime(corrige.punched_at)}
                              </p>
                            )}
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

            {(pendingDayReviewsQuery.data ?? []).length > 0 && (
              <div className="mt-4 rounded-2xl border border-warning/25 bg-warning/5 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">Dias fora do horário</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Batida em horário atípico ou em fim de semana. Confira o dia antes de aprovar.
                    </p>
                  </div>
                  <StatusBadge variant="warning" size="sm">
                    {pendingDayReviewsQuery.data?.length ?? 0} pendente(s)
                  </StatusBadge>
                </div>

                <div className="mt-4 space-y-3">
                  {(pendingDayReviewsQuery.data ?? []).map((revisao) => {
                    const member = teamMembersQuery.data?.find((item) => item.user_id === revisao.user_id);
                    const respondendo = reviewDay.isPending && reviewDay.variables?.id === revisao.id;
                    return (
                      <article key={revisao.id} className="rounded-xl border border-border/70 bg-card p-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-medium">{member?.display_name ?? "Colaborador"}</p>
                            {member?.job_title && <p className="text-xs text-muted-foreground">{member.job_title}</p>}
                            <p className="mt-2 text-sm font-medium capitalize">
                              {formatHistoryDate(revisao.work_date)}
                            </p>
                            <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                              {revisao.motivos.map((motivo) => (
                                <li key={motivo}>{motivo}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              disabled={respondendo}
                              onClick={() => reviewDay.mutate({ id: revisao.id, status: "rejected" })}
                            >
                              <XCircle className="mr-1.5 h-4 w-4" /> Recusar
                            </Button>
                            <Button
                              size="sm"
                              disabled={respondendo}
                              onClick={() => reviewDay.mutate({ id: revisao.id, status: "approved" })}
                            >
                              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Aprovar
                            </Button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Saídas no meio do dia: sempre exigem resposta — abonar devolve
                as horas, "banco" só precisa de ciência. */}
            {(pendingIntervalsQuery.data ?? []).length > 0 && (
              <div className="mt-4 rounded-2xl border border-warning/25 bg-warning/5 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">Saídas no meio do dia</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Aprovar significa aceitar o que a pessoa pediu: abono (com atestado) ou desconto do banco.
                    </p>
                  </div>
                  <StatusBadge variant="warning" size="sm">
                    {pendingIntervalsQuery.data?.length ?? 0} pendente(s)
                  </StatusBadge>
                </div>

                <div className="mt-4 space-y-3">
                  {(pendingIntervalsQuery.data ?? []).map((pedido) => {
                    const member = teamMembersQuery.data?.find((item) => item.user_id === pedido.user_id);
                    const respondendo = reviewInterval.isPending && reviewInterval.variables?.id === pedido.id;
                    return (
                      <article key={pedido.id} className="rounded-xl border border-border/70 bg-card p-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-medium">{member?.display_name ?? "Colaborador"}</p>
                            {member?.job_title && <p className="text-xs text-muted-foreground">{member.job_title}</p>}
                            <p className="mt-2 text-sm font-medium">
                              {formatHistoryDate(pedido.work_date)} · {formatPunchTime(pedido.left_at)} às{" "}
                              {formatPunchTime(pedido.returned_at)} ({pedido.minutes} min)
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">{pedido.reason}</p>
                            <p className="mt-2">
                              <StatusBadge variant={pedido.treatment === "abono" ? "info" : "neutral"} size="sm">
                                {pedido.treatment === "abono" ? "Pede abono (atestado)" : "Descontar do banco"}
                              </StatusBadge>
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              disabled={respondendo}
                              onClick={() => reviewInterval.mutate({ id: pedido.id, status: "rejected" })}
                            >
                              <XCircle className="mr-1.5 h-4 w-4" /> Recusar
                            </Button>
                            <Button
                              size="sm"
                              disabled={respondendo}
                              onClick={() => reviewInterval.mutate({ id: pedido.id, status: "approved" })}
                            >
                              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Aprovar
                            </Button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}

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
                        <TableHead className="text-right">Saldo do período</TableHead>
                        <TableHead className="text-right">Banco acumulado</TableHead>
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
                          <TableCell className="text-right font-semibold tabular-nums">
                            {(() => {
                              const acc = teamAccumulated.get(total.member.user_id);
                              if (acc === null || acc === undefined) {
                                return <span className="text-muted-foreground">—</span>;
                              }
                              return (
                                <span
                                  className={cn(
                                    acc > 0 && "text-success",
                                    acc < 0 && "text-destructive",
                                  )}
                                >
                                  {formatBalance(acc)}
                                </span>
                              );
                            })()}
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

      <Dialog open={justificarOpen} onOpenChange={(open) => !justificarIntervalo.isPending && setJustificarOpen(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>O que fazer com esse tempo?</DialogTitle></DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => { event.preventDefault(); justificarIntervalo.mutate(); }}
          >
            {intervaloParaJustificar && (
              <p className="text-sm text-muted-foreground">
                Você ficou <strong>{intervaloParaJustificar.minutos} min</strong> fora
                ({formatPunchTime(intervaloParaJustificar.leftAt)} às {formatPunchTime(intervaloParaJustificar.returnedAt)}).
                A ADM precisa responder.
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Como contar</Label>
              <Select
                value={justificarTratamento}
                onValueChange={(value: IntervalTreatment) => setJustificarTratamento(value)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="abono">Tenho atestado — pedir abono</SelectItem>
                  <SelectItem value="banco">Descontar do meu banco de horas</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {justificarTratamento === "abono"
                  ? "Se a ADM aprovar, o tempo volta a contar como trabalhado. Leve o atestado."
                  : "O tempo sai do seu banco de horas. A ADM só precisa tomar ciência."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="justificar-motivo">Motivo</Label>
              <Textarea
                id="justificar-motivo"
                rows={3}
                value={justificarMotivo}
                onChange={(event) => setJustificarMotivo(event.target.value)}
                placeholder="Ex.: consulta médica às 10h"
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setJustificarOpen(false)}>Depois</Button>
              <Button type="submit" disabled={justificarIntervalo.isPending || justificarMotivo.trim().length < 3}>
                {justificarIntervalo.isPending ? "Enviando..." : "Enviar para a ADM"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Painel do dia: batidas, horário para corrigir e observação no mesmo
          lugar. Antes, corrigir um horário exigia abrir o formulário do topo e
          digitar a data de novo — dava para errar o dia sem perceber. */}
      <Dialog
        open={notaData !== null}
        onOpenChange={(open) => {
          if (salvarObservacao.isPending || requestAdjustment.isPending) return;
          if (!open) setNotaData(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="capitalize">
              {notaData ? formatHistoryDate(notaData) : ""}
            </DialogTitle>
          </DialogHeader>

          {notaData && (() => {
            const diaAberto = historyDays.find((day) => day.dateKey === notaData);
            const futuro = notaData > todayKey;
            const batidasDoDia = [
              ...PUNCH_STEPS.map((step) => ({
                label: step.label,
                punch: diaAberto?.punches[step.kind],
              })),
            ];
            const pedidosDoDia = (myAdjustmentsQuery.data ?? []).filter(
              (request) =>
                request.status === "pending" &&
                agencyDateKey(new Date(request.requested_punched_at)) === notaData,
            );

            return (
              <div className="space-y-5">
                {/* O que já está registrado neste dia. */}
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-border/60 bg-muted/25 p-3 sm:grid-cols-4">
                  {batidasDoDia.map(({ label, punch }) => (
                    <div key={label}>
                      <p className="text-[11px] text-muted-foreground">{label}</p>
                      <p className="font-semibold tabular-nums">
                        {punch ? formatPunchTime(punch.punched_at) : "—"}
                      </p>
                    </div>
                  ))}
                </div>

                {pedidosDoDia.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Em análise pela ADM:{" "}
                    {pedidosDoDia
                      .map(
                        (request) =>
                          `${PUNCH_KIND_LABEL[request.kind] ?? request.kind} ${formatPunchTime(request.requested_punched_at)}`,
                      )
                      .join(" · ")}
                  </p>
                )}

                {futuro ? (
                  <p className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    Dia que ainda não chegou: dá para deixar a observação registrada, mas o horário
                    só pode ser pedido a partir do próprio dia.
                  </p>
                ) : (
                  <form
                    className="space-y-3 rounded-xl border border-border/60 p-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      requestAdjustment.mutate(notaData);
                    }}
                  >
                    <div>
                      <p className="text-sm font-medium">Adicionar ou corrigir horário</p>
                      <p className="text-xs text-muted-foreground">
                        Vai para a ADM aprovar. Só entra no ponto depois da aprovação.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Registro</Label>
                        <Select
                          value={adjustmentKind}
                          onValueChange={(value: PunchKind | "outro") => setAdjustmentKind(value)}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PUNCH_STEPS.map((step) => (
                              <SelectItem key={step.kind} value={step.kind}>{step.label}</SelectItem>
                            ))}
                            <SelectItem value="outro">Outro (explique no motivo)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="dia-horario">Horário</Label>
                        <Input
                          id="dia-horario"
                          type="time"
                          value={adjustmentTime}
                          onChange={(event) => setAdjustmentTime(event.target.value)}
                          required
                        />
                      </div>
                    </div>
                    {/* Deixa claro que é correção, não uma batida a mais. */}
                    {(() => {
                      if (adjustmentKind === "outro" || !ajusteCorrigeBatida(adjustmentKind)) return null;
                      const atual = diaAberto?.punches[adjustmentKind];
                      if (!atual) return null;
                      return (
                        <p className="rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
                          {PUNCH_KIND_LABEL[adjustmentKind]} deste dia está como{" "}
                          {formatPunchTime(atual.punched_at)}. Quando a ADM aprovar, fica o horário novo.
                        </p>
                      );
                    })()}
                    <div className="space-y-1.5">
                      <Label htmlFor="dia-motivo">Motivo</Label>
                      <Textarea
                        id="dia-motivo"
                        rows={2}
                        value={adjustmentReason}
                        onChange={(event) => setAdjustmentReason(event.target.value)}
                        placeholder="Ex.: esqueci de bater a saída"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="submit"
                        size="sm"
                        disabled={requestAdjustment.isPending || adjustmentReason.trim().length < 5}
                      >
                        {requestAdjustment.isPending ? "Enviando..." : "Enviar horário para a ADM"}
                      </Button>
                    </div>
                  </form>
                )}

                <form
                  className="space-y-3 rounded-xl border border-border/60 p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    salvarObservacao.mutate({ dateKey: notaData, texto: notaTexto });
                  }}
                >
                  <div>
                    <p className="text-sm font-medium">Observação do dia</p>
                    <p className="text-xs text-muted-foreground">
                      Fica no seu ponto e a ADM lê junto com o dia.
                    </p>
                  </div>
                  <Textarea
                    rows={3}
                    value={notaTexto}
                    onChange={(event) => setNotaTexto(event.target.value)}
                    placeholder="Ex.: saí às 10h para o médico, volto depois do almoço"
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setNotaData(null)}>
                      Fechar
                    </Button>
                    <Button type="submit" size="sm" variant="outline" disabled={salvarObservacao.isPending}>
                      {salvarObservacao.isPending
                        ? "Salvando..."
                        : notaTexto.trim() ? "Salvar observação" : "Apagar observação"}
                    </Button>
                  </div>
                </form>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Primeira batida depois das 10h. Antes, ela virava entrada sempre: a
          saída para o almoço das 12:00 era gravada como chegada e o dia todo
          ficava deslocado. */}
      <Dialog
        open={entradaEsquecidaOpen}
        onOpenChange={(open) => !baterPonto.isPending && setEntradaEsquecidaOpen(open)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sua entrada de hoje não foi registrada</DialogTitle>
            <DialogDescription>
              Você está chegando agora ou esqueceu de bater a entrada?
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const vira = PUNCH_KIND_LABEL[batidaAposEntradaEsquecida(agencySecondOfDay(new Date().toISOString()))];
            return (
              <div className="space-y-3">
                <form
                  className="space-y-3 rounded-xl border border-border/60 p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    baterPonto.mutate(entradaEsquecidaHora);
                  }}
                >
                  <div>
                    <p className="text-sm font-medium">Esqueci de bater a entrada</p>
                    <p className="text-xs text-muted-foreground">
                      O horário de chegada vai para a ADM aprovar. Esta batida fica como{" "}
                      <span className="font-medium text-foreground">{vira.toLowerCase()}</span>.
                    </p>
                  </div>
                  <div className="flex items-end gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="entrada-esquecida">Cheguei às</Label>
                      <Input
                        id="entrada-esquecida"
                        type="time"
                        value={entradaEsquecidaHora}
                        onChange={(event) => setEntradaEsquecidaHora(event.target.value)}
                        required
                      />
                    </div>
                    <Button type="submit" className="flex-1" disabled={baterPonto.isPending || !entradaEsquecidaHora}>
                      {baterPonto.isPending && baterPonto.variables ? "Registrando..." : `Registrar ${vira.toLowerCase()}`}
                    </Button>
                  </div>
                </form>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={baterPonto.isPending}
                  onClick={() => baterPonto.mutate(undefined)}
                >
                  {baterPonto.isPending && !baterPonto.variables ? "Registrando..." : "Estou chegando agora"}
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={adjustmentOpen} onOpenChange={(open) => !requestAdjustment.isPending && setAdjustmentOpen(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar horário para análise</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              requestAdjustment.mutate(undefined);
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
              <Select value={adjustmentKind} onValueChange={(value: PunchKind | "outro") => setAdjustmentKind(value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PUNCH_STEPS.map((step) => (
                    <SelectItem key={step.kind} value={step.kind}>{step.label}</SelectItem>
                  ))}
                  <SelectItem value="outro">Outro (explique no motivo)</SelectItem>
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
