import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { PullFromProductionDialog } from "@/components/tasks/PullFromProductionDialog";
import { ProjectRail } from "@/components/tasks/ProjectRail";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isBefore, parseISO, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertCircle,
  CalendarDays,
  Clock3,
  Filter,
  GripVertical,
  ListChecks,
  ListTodo,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  UserCheck,
  UserRound,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { useOrganizationRole } from "@/hooks/useOrganizationRole";
import { usePersistedState } from "@/hooks/usePersistedState";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { DateRangeFields } from "@/components/filters/DateRangeFields";
import { isDayWithinRange } from "@/lib/dateRange";

type TaskStatus = "todo" | "doing" | "review" | "done";

// Quantos dias de trabalho entregue o quadro mostra por padrao. O kanban serve
// ao trabalho em andamento; o mes inteiro de concluidas e historico, e vira uma
// parede que empurra as outras colunas para fora da tela.
const DIAS_CONCLUIDAS_VISIVEIS = 7;
type TaskPriority = "low" | "medium" | "high";
type TaskFilters = {
  assigneeId: string;
  clientId: string;
  priority: "all" | TaskPriority;
  functionId: string;
  dueFrom: string;
  dueTo: string;
};

type TaskRecord = {
  id: string;
  organization_id: string;
  client_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string;
  due_date: string;
  tags: string[];
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  done: boolean;
  done_at: string | null;
};

type TaskSubtask = {
  id: string;
  task_id: string;
  title: string;
  done: boolean;
  position: number;
  assignee_id: string | null;
  due_date: string | null;
  done_at: string | null;
};

type TaskTimeEntry = {
  id: string;
  task_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
};

type ClientOption = { id: string; name: string; logo_url: string | null; accent_color: string | null };
type MemberOption = {
  userId: string;
  name: string;
  jobTitle: string | null;
  avatarUrl: string | null;
};

type TaskAssigneeRow = {
  user_id: string;
  display_name: string;
  job_title: string | null;
  avatar_url: string | null;
};

type FunctionOption = {
  id: string;
  name: string;
  color: string;
};

type MemberFunctionAssignment = {
  user_id: string;
  tag_id: string;
};

type QueryError = { message: string; code?: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };

// As tabelas desta feature so entram nos tipos gerados depois que a migration
// for aplicada. Este adaptador mantém a página tipada sem editar types.ts antes
// da hora e sem espalhar casts `any` pela implementação.
interface UntypedFilterBuilder<T> extends PromiseLike<QueryResult<T>> {
  select(columns?: string): UntypedFilterBuilder<T>;
  eq(column: string, value: unknown): UntypedFilterBuilder<T>;
  in(column: string, values: readonly unknown[]): UntypedFilterBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): UntypedFilterBuilder<T>;
  update(values: Record<string, unknown>): UntypedFilterBuilder<T>;
  insert(values: Record<string, unknown> | Array<Record<string, unknown>>): UntypedFilterBuilder<T>;
  delete(): UntypedFilterBuilder<T>;
  single(): PromiseLike<QueryResult<T>>;
}

const taskSupabase = supabase as unknown as {
  from<T>(relation: string): UntypedFilterBuilder<T>;
  rpc<T>(functionName: string, params: Record<string, unknown>): PromiseLike<QueryResult<T>>;
};

type LinhasAfetadas = Array<{ id: string }>;

/**
 * Confere que a escrita pegou alguma linha.
 *
 * Um UPDATE ou DELETE barrado por RLS no PostgREST volta com ZERO linhas e
 * `error` nulo. Sem esta checagem o `onSuccess` dispara, a tela mostra "Tarefa
 * atualizada" e nada foi gravado — o mesmo bug que já custou o rascunho de
 * posts inteiros no editor de planejamento. `productionToTask.ts` documenta o
 * padrão; este arquivo não seguia.
 */
function exigirLinhaEscrita(
  resultado: QueryResult<LinhasAfetadas>,
  semPermissao: string,
): void {
  if (resultado.error) throw new Error(resultado.error.message);
  if (!resultado.data?.length) throw new Error(semPermissao);
}

function isMissingTaskAssigneeRpc(error: QueryError) {
  if (error.code === "PGRST202" || error.code === "42883") return true;

  return /get_task_assignees/i.test(error.message)
    && /(schema cache|does not exist|could not find)/i.test(error.message);
}

async function loadLegacyTaskAssignees(organizationId: string): Promise<TaskAssigneeRow[]> {
  const membersResult = await taskSupabase
    .from<Array<{ user_id: string }>>("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("status", "active");

  if (membersResult.error) throw membersResult.error;

  const memberRows = membersResult.data ?? [];
  const memberIds = memberRows.map((member) => member.user_id);
  if (memberIds.length === 0) return [];

  const profilesResult = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url")
    .in("id", memberIds);

  if (profilesResult.error) throw profilesResult.error;

  return memberRows.map((member) => {
    const profile = profilesResult.data?.find((item) => item.id === member.user_id);
    return {
      user_id: member.user_id,
      display_name: profile?.full_name?.trim() || "Usuário",
      job_title: null,
      avatar_url: profile?.avatar_url ?? null,
    };
  });
}

const COLUMNS: Array<{
  id: TaskStatus;
  label: string;
  dotClass: string;
  surfaceClass: string;
}> = [
  { id: "todo", label: "A fazer", dotClass: "bg-slate-400", surfaceClass: "bg-slate-500/5" },
  { id: "doing", label: "Fazendo", dotClass: "bg-blue-500", surfaceClass: "bg-blue-500/5" },
  { id: "review", label: "Revisão", dotClass: "bg-amber-500", surfaceClass: "bg-amber-500/5" },
  { id: "done", label: "Concluído", dotClass: "bg-emerald-500", surfaceClass: "bg-emerald-500/5" },
];

const PRIORITIES: Record<TaskPriority, { label: string; className: string }> = {
  low: { label: "Baixa", className: "border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  medium: { label: "Média", className: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  high: { label: "Alta", className: "border-destructive/20 bg-destructive/10 text-destructive" },
};

const DEFAULT_FILTERS: TaskFilters = {
  assigneeId: "all",
  clientId: "all",
  priority: "all",
  functionId: "all",
  dueFrom: "",
  dueTo: "",
};

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?";
}

function memberLabel(member: MemberOption) {
  return member.jobTitle ? `${member.name} — ${member.jobTitle}` : member.name;
}

function elapsedSeconds(entry: TaskTimeEntry, nowMs: number) {
  if (entry.duration_seconds !== null) return entry.duration_seconds;
  return Math.max(0, Math.floor((nowMs - new Date(entry.started_at).getTime()) / 1000));
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function TaskCardContent({
  task,
  client,
  assignee,
  subtasks = [],
  timeEntries = [],
  currentUserId,
  activeTimerTaskId,
  nowMs = Date.now(),
  timerPending = false,
  onToggleTimer,
  dragging = false,
  dragHandle,
  onEdit,
}: {
  task: TaskRecord;
  client?: ClientOption;
  assignee?: MemberOption;
  subtasks?: TaskSubtask[];
  timeEntries?: TaskTimeEntry[];
  currentUserId?: string;
  activeTimerTaskId?: string;
  nowMs?: number;
  timerPending?: boolean;
  onToggleTimer?: (taskId: string) => void;
  dragging?: boolean;
  dragHandle?: ReactNode;
  onEdit?: () => void;
}) {
  const overdue = task.status !== "done" && isBefore(parseISO(task.due_date), startOfDay(new Date()));
  const priority = PRIORITIES[task.priority];
  const completedSubtasks = subtasks.filter((subtask) => subtask.done).length;
  // Etapa vencida dentro de uma peça que ainda está no prazo: o prazo da
  // tarefa-mãe só estoura no fim, então sem este aviso o atraso da arte só
  // aparece quando já é tarde para a legenda e a edição que dependem dela.
  const subtarefaAtrasada = subtasks.some(
    (subtask) => !subtask.done && subtask.due_date
      && isBefore(parseISO(subtask.due_date), startOfDay(new Date())),
  );
  const totalSeconds = timeEntries.reduce((total, entry) => total + elapsedSeconds(entry, nowMs), 0);
  const hasRunningTimer = timeEntries.some((entry) => entry.ended_at === null);
  const currentUserTimerRunning = timeEntries.some(
    (entry) => entry.user_id === currentUserId && entry.ended_at === null
  );
  const timerBlockedByOtherTask = !!activeTimerTaskId && activeTimerTaskId !== task.id;

  return (
    <div
      role={onEdit ? "button" : undefined}
      tabIndex={onEdit ? 0 : undefined}
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (onEdit && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onEdit();
        }
      }}
      className={cn(
        "group rounded-2xl border border-border/70 bg-card p-4 text-left shadow-sm transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        onEdit && "cursor-pointer",
        dragging ? "rotate-1 shadow-xl ring-2 ring-primary/20" : "hover:shadow-md"
      )}
    >
      <div className="flex items-start gap-2">
        {dragHandle ?? (
          <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />
        )}
        <p className="min-w-0 flex-1 text-sm font-semibold leading-5 text-card-foreground">{task.title}</p>
        {onEdit && (
          <span className="mt-0.5 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" aria-hidden="true">
            <Pencil className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {client?.name ?? "Sem cliente"}
        </p>
        <Badge variant="outline" className={cn("shrink-0 text-[10px] font-medium", priority.className)}>
          {priority.label}
        </Badge>
      </div>

      {(timeEntries.length > 0 || onToggleTimer) && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-muted/45 px-2.5 py-2">
          <div
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-xs font-medium tabular-nums",
              hasRunningTimer ? "text-primary" : "text-muted-foreground"
            )}
            title="Tempo total acumulado pela equipe"
          >
            <Clock3 className={cn("h-3.5 w-3.5", hasRunningTimer && "animate-pulse")} />
            {formatDuration(totalSeconds)}
          </div>

          {onToggleTimer && (
            <Button
              type="button"
              variant={currentUserTimerRunning ? "destructive" : "outline"}
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              disabled={timerPending || timerBlockedByOtherTask}
              title={timerBlockedByOtherTask ? "Pare o timer ativo em outra tarefa primeiro" : undefined}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onToggleTimer(task.id);
              }}
            >
              {currentUserTimerRunning ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
              {currentUserTimerRunning ? "Parar" : "Iniciar"}
            </Button>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
        <div className={cn("flex items-center gap-1.5 text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
          <CalendarDays className="h-3.5 w-3.5" />
          <span>{format(parseISO(task.due_date), "dd MMM", { locale: ptBR })}</span>
        </div>

        {subtasks.length > 0 && (
          <div
            className={cn(
              "flex items-center gap-1 text-[11px] font-medium",
              subtarefaAtrasada
                ? "text-destructive"
                : completedSubtasks === subtasks.length ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
            )}
            title={subtarefaAtrasada
              ? `${completedSubtasks} de ${subtasks.length} concluídas · há etapa com prazo vencido`
              : `${completedSubtasks} de ${subtasks.length} subtarefas concluídas`}
          >
            <ListChecks className="h-3.5 w-3.5" />
            {completedSubtasks}/{subtasks.length}
          </div>
        )}

        <Avatar
          className="h-7 w-7 border-2 border-background"
          title={assignee ? memberLabel(assignee) : "Responsável"}
        >
          {assignee?.avatarUrl && <AvatarImage src={assignee.avatarUrl} alt={assignee.name} />}
          <AvatarFallback className="bg-primary/10 text-[9px] font-semibold text-primary">
            {initials(assignee?.name ?? "Responsável")}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}

function SortableTaskCard({
  task,
  client,
  assignee,
  subtasks,
  timeEntries,
  currentUserId,
  activeTimerTaskId,
  nowMs,
  timerPending,
  onToggleTimer,
  disabled,
  onEdit,
}: {
  task: TaskRecord;
  client?: ClientOption;
  assignee?: MemberOption;
  subtasks: TaskSubtask[];
  timeEntries: TaskTimeEntry[];
  currentUserId?: string;
  activeTimerTaskId?: string;
  nowMs: number;
  timerPending: boolean;
  onToggleTimer?: (taskId: string) => void;
  disabled: boolean;
  onEdit?: (task: TaskRecord) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", task },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "opacity-30")}
    >
      <TaskCardContent
        task={task}
        client={client}
        assignee={assignee}
        subtasks={subtasks}
        timeEntries={timeEntries}
        currentUserId={currentUserId}
        activeTimerTaskId={activeTimerTaskId}
        nowMs={nowMs}
        timerPending={timerPending}
        onToggleTimer={onToggleTimer}
        onEdit={onEdit ? () => onEdit(task) : undefined}
        dragHandle={
          disabled ? (
            <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/30" aria-hidden="true" />
          ) : (
            <button
              type="button"
              className="mt-0.5 shrink-0 cursor-grab touch-none rounded text-muted-foreground/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
              aria-label={`Mover tarefa ${task.title}`}
              onClick={(event) => event.stopPropagation()}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )
        }
      />
    </div>
  );
}

function TaskColumn({
  column,
  tasks,
  clientsById,
  membersById,
  subtasksByTaskId,
  timeEntriesByTaskId,
  currentUserId,
  activeTimerTaskId,
  nowMs,
  timerPending,
  onToggleTimer,
  draggingDisabled,
  onEdit,
  hasActiveFilters,
  ocultas,
  onVerTodas,
}: {
  column: (typeof COLUMNS)[number];
  tasks: TaskRecord[];
  clientsById: Map<string, ClientOption>;
  membersById: Map<string, MemberOption>;
  subtasksByTaskId: Map<string, TaskSubtask[]>;
  timeEntriesByTaskId: Map<string, TaskTimeEntry[]>;
  currentUserId?: string;
  activeTimerTaskId?: string;
  nowMs: number;
  timerPending: boolean;
  onToggleTimer?: (taskId: string) => void;
  draggingDisabled: boolean;
  onEdit?: (task: TaskRecord) => void;
  hasActiveFilters: boolean;
  ocultas?: number;
  onVerTodas?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: "column", status: column.id },
  });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex min-h-[520px] w-[285px] shrink-0 flex-col rounded-3xl border border-border/60 p-3 transition-colors xl:w-auto xl:min-w-0",
        column.surfaceClass,
        isOver && "border-primary/40 bg-primary/5 ring-2 ring-primary/10"
      )}
    >
      <div className="mb-3 flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", column.dotClass)} />
          <h2 className="text-sm font-semibold">{column.label}</h2>
        </div>
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-background/70 px-1.5 text-[11px] font-medium text-muted-foreground">
          {tasks.length}
        </span>
      </div>

      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2.5">
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              client={task.client_id ? clientsById.get(task.client_id) : undefined}
              assignee={membersById.get(task.assignee_id)}
              subtasks={subtasksByTaskId.get(task.id) ?? []}
              timeEntries={timeEntriesByTaskId.get(task.id) ?? []}
              currentUserId={currentUserId}
              activeTimerTaskId={activeTimerTaskId}
              nowMs={nowMs}
              timerPending={timerPending}
              onToggleTimer={onToggleTimer}
              disabled={draggingDisabled}
              onEdit={onEdit}
            />
          ))}

          {tasks.length === 0 && (
            <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border/70 px-4 py-10 text-center text-xs text-muted-foreground">
              {hasActiveFilters ? "Nenhuma tarefa com estes filtros" : "Arraste uma tarefa para cá"}
            </div>
          )}

          {/* O que ficou fora da janela é contado, não some calado: some sem
              aviso e a pessoa procura uma tarefa que jura ter concluído. */}
          {!!ocultas && ocultas > 0 && onVerTodas && (
            <button
              type="button"
              onClick={onVerTodas}
              className="mt-1 rounded-xl border border-dashed border-border/70 px-3 py-2.5 text-center text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              +{ocultas} {ocultas === 1 ? "concluída há mais tempo" : "concluídas há mais tempo"}
            </button>
          )}
        </div>
      </SortableContext>
    </section>
  );
}

export default function Tasks() {
  const { user } = useAuth();
  const { organizationId, isLegacy, loading: organizationLoading } = useOrganization();
  const { canEditContent } = useOrganizationRole();
  const queryClient = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [localTasks, setLocalTasks] = useState<TaskRecord[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState("none");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [tagsInput, setTagsInput] = useState("");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  // Subtarefas em rascunho ao CRIAR uma tarefa (a tarefa ainda não existe, então
  // guardamos localmente e inserimos depois que ela é criada).
  const [draftSubtasks, setDraftSubtasks] = useState<string[]>([]);
  const [mostrarTodasConcluidas, setMostrarTodasConcluidas] = useState(false);
  const [puxarProducaoAberto, setPuxarProducaoAberto] = useState(false);
  const { boardClientId } = useParams();
  const rotaInterna = useLocation().pathname === "/tasks/interno";

  const [filtersByOrganization, setFiltersByOrganization] = usePersistedState<Record<string, TaskFilters>>(
    "norteia.tasks.filters.v1",
    {}
  );

  const storedFilters = organizationId
    ? filtersByOrganization[organizationId] ?? DEFAULT_FILTERS
    : DEFAULT_FILTERS;

  const updateFilters = (patch: Partial<TaskFilters>) => {
    if (!organizationId) return;
    setFiltersByOrganization({
      ...filtersByOrganization,
      [organizationId]: { ...storedFilters, ...patch },
    });
  };

  const boardQuery = useQuery({
    queryKey: ["tasks-board", organizationId],
    queryFn: async () => {
      const [tasksResult, clientsResult, assigneesResult, functionsResult, memberFunctionsResult] = await Promise.all([
        taskSupabase
          .from<TaskRecord[]>("tasks")
          .select("*")
          .eq("organization_id", organizationId!)
          .order("position", { ascending: true }),
        supabase
          .from("clients")
          .select("id, name, logo_url, accent_color")
          .eq("organization_id", organizationId!)
          .order("name", { ascending: true }),
        taskSupabase.rpc<TaskAssigneeRow[]>("get_task_assignees", {
          _organization_id: organizationId!,
        }),
        taskSupabase
          .from<FunctionOption[]>("team_function_tags")
          .select("id, name, color")
          .eq("organization_id", organizationId!)
          .order("name", { ascending: true }),
        taskSupabase
          .from<MemberFunctionAssignment[]>("team_member_functions")
          .select("user_id, tag_id")
          .eq("organization_id", organizationId!),
      ]);

      if (tasksResult.error) throw tasksResult.error;
      if (clientsResult.error) throw clientsResult.error;
      if (functionsResult.error) throw functionsResult.error;
      if (memberFunctionsResult.error) throw memberFunctionsResult.error;

      let assigneeRows = assigneesResult.data ?? [];
      let hasConfiguredDirectory = true;
      if (assigneesResult.error) {
        if (!isMissingTaskAssigneeRpc(assigneesResult.error)) throw assigneesResult.error;
        assigneeRows = await loadLegacyTaskAssignees(organizationId!);
        hasConfiguredDirectory = false;
      }

      const taskRows = (tasksResult.data ?? []) as TaskRecord[];
      let subtasks: TaskSubtask[] = [];
      let timeEntries: TaskTimeEntry[] = [];
      if (taskRows.length > 0) {
        const taskIds = taskRows.map((task) => task.id);
        const [subtasksResult, timeEntriesResult] = await Promise.all([
          taskSupabase
            .from<TaskSubtask[]>("task_subtasks")
            .select("*")
            .in("task_id", taskIds)
            .order("position", { ascending: true }),
          taskSupabase
            .from<TaskTimeEntry[]>("task_time_entries")
            .select("*")
            .in("task_id", taskIds)
            .order("started_at", { ascending: false }),
        ]);
        if (subtasksResult.error) throw subtasksResult.error;
        if (timeEntriesResult.error) throw timeEntriesResult.error;
        subtasks = subtasksResult.data ?? [];
        timeEntries = timeEntriesResult.data ?? [];
      }

      return {
        tasks: taskRows,
        subtasks,
        timeEntries,
        clients: (clientsResult.data ?? []) as ClientOption[],
        functions: functionsResult.data ?? [],
        memberFunctions: memberFunctionsResult.data ?? [],
        members: assigneeRows
          .filter((member) => !hasConfiguredDirectory || Boolean(member.job_title?.trim()))
          .map((member) => ({
            userId: member.user_id,
            name: member.display_name,
            jobTitle: member.job_title,
            avatarUrl: member.avatar_url,
          } satisfies MemberOption)),
      };
    },
    enabled: !!user && !!organizationId && !isLegacy,
  });

  useEffect(() => {
    if (boardQuery.data?.tasks) setLocalTasks(boardQuery.data.tasks);
  }, [boardQuery.data?.tasks]);

  useEffect(() => {
    if (!assigneeId && boardQuery.data?.members.length) {
      const preferred = boardQuery.data.members.find((member) => member.userId === user?.id);
      setAssigneeId(preferred?.userId ?? boardQuery.data.members[0].userId);
    }
  }, [assigneeId, boardQuery.data?.members, user?.id]);

  const clientsById = useMemo(
    () => new Map((boardQuery.data?.clients ?? []).map((client) => [client.id, client])),
    [boardQuery.data?.clients]
  );
  const membersById = useMemo(
    () => new Map((boardQuery.data?.members ?? []).map((member) => [member.userId, member])),
    [boardQuery.data?.members]
  );
  const functionIds = useMemo(
    () => new Set((boardQuery.data?.functions ?? []).map((item) => item.id)),
    [boardQuery.data?.functions]
  );
  const functionMembersByTagId = useMemo(() => {
    const grouped = new Map<string, Set<string>>();
    for (const assignment of boardQuery.data?.memberFunctions ?? []) {
      const members = grouped.get(assignment.tag_id) ?? new Set<string>();
      members.add(assignment.user_id);
      grouped.set(assignment.tag_id, members);
    }
    return grouped;
  }, [boardQuery.data?.memberFunctions]);
  const subtasksByTaskId = useMemo(() => {
    const grouped = new Map<string, TaskSubtask[]>();
    for (const subtask of boardQuery.data?.subtasks ?? []) {
      const current = grouped.get(subtask.task_id) ?? [];
      current.push(subtask);
      grouped.set(subtask.task_id, current);
    }
    return grouped;
  }, [boardQuery.data?.subtasks]);
  const timeEntriesByTaskId = useMemo(() => {
    const grouped = new Map<string, TaskTimeEntry[]>();
    for (const entry of boardQuery.data?.timeEntries ?? []) {
      const current = grouped.get(entry.task_id) ?? [];
      current.push(entry);
      grouped.set(entry.task_id, current);
    }
    return grouped;
  }, [boardQuery.data?.timeEntries]);

  const hasRunningTimer = (boardQuery.data?.timeEntries ?? []).some((entry) => entry.ended_at === null);
  const activeUserTimer = (boardQuery.data?.timeEntries ?? []).find(
    (entry) => entry.user_id === user?.id && entry.ended_at === null
  );

  useEffect(() => {
    if (!hasRunningTimer) return;
    setNowMs(Date.now());
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [hasRunningTimer]);

  const editingSubtasks = editingTask ? subtasksByTaskId.get(editingTask.id) ?? [] : [];

  // Valores antigos ou pertencentes a outra equipe nunca devem produzir um
  // quadro vazio sem explicação. Como a persistência é por organização, a
  // seleção original continua intacta ao alternar entre organizações.
  const functionFilter = storedFilters.functionId === "all" || functionIds.has(storedFilters.functionId)
    ? storedFilters.functionId
    : "all";
  const membersForFunction = useMemo(
    () => functionFilter === "all"
      ? null
      : functionMembersByTagId.get(functionFilter) ?? new Set<string>(),
    [functionFilter, functionMembersByTagId]
  );
  const assigneeFilter = storedFilters.assigneeId === "all"
    || (membersById.has(storedFilters.assigneeId) && (!membersForFunction || membersForFunction.has(storedFilters.assigneeId)))
    ? storedFilters.assigneeId
    : "all";
  // Quadro de projeto: o cliente vem da ROTA e vence o filtro guardado.
  // /tasks/interno reusa o valor "none" que o filtro já entende como "sem cliente".
  const clienteDaRota = boardClientId ?? (rotaInterna ? "none" : null);
  const quadroFixo = clienteDaRota !== null;
  const filtroGuardadoValido = storedFilters.clientId === "all"
    || storedFilters.clientId === "none"
    || clientsById.has(storedFilters.clientId)
    ? storedFilters.clientId
    : "all";
  const clientFilter = clienteDaRota ?? filtroGuardadoValido;
  const tituloDoQuadro = !quadroFixo
    ? "Tarefas"
    : rotaInterna
      ? "Interno"
      : clientsById.get(boardClientId!)?.name ?? "Projeto";
  const priorityFilter: TaskFilters["priority"] = ["all", "low", "medium", "high"].includes(storedFilters.priority)
    ? storedFilters.priority
    : "all";
  const dueFromFilter = typeof storedFilters.dueFrom === "string" ? storedFilters.dueFrom : "";
  const dueToFilter = typeof storedFilters.dueTo === "string" ? storedFilters.dueTo : "";

  const hasActiveFilters = assigneeFilter !== "all"
    || clientFilter !== "all"
    || priorityFilter !== "all"
    || functionFilter !== "all"
    || Boolean(dueFromFilter || dueToFilter);
  const onlyMineActive = !!user && assigneeFilter === user.id;

  const filteredTasks = useMemo(
    () => localTasks.filter((task) => {
      if (assigneeFilter !== "all" && task.assignee_id !== assigneeFilter) return false;
      if (membersForFunction && !membersForFunction.has(task.assignee_id)) return false;
      if (clientFilter === "none" && task.client_id !== null) return false;
      if (clientFilter !== "all" && clientFilter !== "none" && task.client_id !== clientFilter) return false;
      if (priorityFilter !== "all" && task.priority !== priorityFilter) return false;
      if (!isDayWithinRange(task.due_date, dueFromFilter, dueToFilter)) return false;
      return true;
    }),
    [assigneeFilter, clientFilter, dueFromFilter, dueToFilter, localTasks, membersForFunction, priorityFilter]
  );

  const moveTask = useMutation({
    mutationFn: async ({ previous, next }: { previous: TaskRecord[]; next: TaskRecord[] }) => {
      const previousById = new Map(previous.map((task) => [task.id, task]));
      const changed = next.filter((task) => {
        const oldTask = previousById.get(task.id);
        return oldTask && (oldTask.status !== task.status || oldTask.position !== task.position);
      });

      await Promise.all(
        changed.map(async (task) => {
          const { error } = await taskSupabase
            .from<null>("tasks")
            .update({ status: task.status, position: task.position })
            .eq("id", task.id)
            .eq("organization_id", organizationId!);
          if (error) throw error;
        })
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks-board", organizationId] }),
    onError: (error, variables) => {
      setLocalTasks(variables.previous);
      toast.error(error instanceof Error ? error.message : "Não foi possível mover a tarefa");
      queryClient.invalidateQueries({ queryKey: ["tasks-board", organizationId] });
    },
  });

  const saveTask = useMutation({
    mutationFn: async () => {
      const normalizedTags = Array.from(
        new Set(
          tagsInput
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        )
      );
      const values = {
        client_id: clientId === "none" ? null : clientId,
        title: title.trim(),
        description: description.trim() || null,
        priority,
        assignee_id: assigneeId,
        due_date: dueDate,
        tags: normalizedTags,
      };

      if (editingTask) {
        exigirLinhaEscrita(
          await taskSupabase
            .from<LinhasAfetadas>("tasks")
            .update(values)
            .eq("id", editingTask.id)
            .eq("organization_id", organizationId!)
            .select("id"),
          "Sem permissão para editar esta tarefa.",
        );
        return "updated" as const;
      }

      const todoCount = localTasks.filter((task) => task.status === "todo").length;
      const { data: created, error } = await taskSupabase
        .from<{ id: string }>("tasks")
        .insert({
          organization_id: organizationId!,
          ...values,
          status: "todo",
          position: todoCount,
          created_by: user!.id,
        })
        .select("id")
        .single();
      if (error) throw error;

      // Subtarefas em rascunho adicionadas na criação.
      const drafts = draftSubtasks.map((t) => t.trim()).filter(Boolean);
      if (created?.id && drafts.length > 0) {
        const rows = drafts.map((title, index) => ({
          task_id: created.id,
          title,
          position: index,
        }));
        const { error: subError } = await taskSupabase.from<null>("task_subtasks").insert(rows);
        if (subError) throw subError;
      }
      return "created" as const;
    },
    onSuccess: (action) => {
      queryClient.invalidateQueries({ queryKey: ["tasks-board", organizationId] });
      setTaskDialogOpen(false);
      setEditingTask(null);
      setDraftSubtasks([]);
      toast.success(action === "created" ? "Tarefa criada" : "Tarefa atualizada");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível salvar a tarefa"),
  });

  const deleteTask = useMutation({
    mutationFn: async () => {
      if (!editingTask) return;
      exigirLinhaEscrita(
        await taskSupabase
          .from<LinhasAfetadas>("tasks")
          .delete()
          .eq("id", editingTask.id)
          .eq("organization_id", organizationId!)
          .select("id"),
        "Sem permissão para excluir esta tarefa.",
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks-board", organizationId] });
      setTaskDialogOpen(false);
      setEditingTask(null);
      toast.success("Tarefa excluída");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível excluir a tarefa"),
  });

  const addSubtask = useMutation({
    mutationFn: async () => {
      if (!editingTask || !subtaskTitle.trim()) return;
      const nextPosition = Math.max(-1, ...editingSubtasks.map((subtask) => subtask.position)) + 1;
      const { error } = await taskSupabase.from<null>("task_subtasks").insert({
        task_id: editingTask.id,
        title: subtaskTitle.trim(),
        done: false,
        position: nextPosition,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setSubtaskTitle("");
      queryClient.invalidateQueries({ queryKey: ["tasks-board", organizationId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível adicionar a subtarefa"),
  });

  const toggleSubtask = useMutation({
    mutationFn: async ({ id, taskId, done }: { id: string; taskId: string; done: boolean }) => {
      exigirLinhaEscrita(
        await taskSupabase
          .from<LinhasAfetadas>("task_subtasks")
          // done_at junto do done: sem ele, "o que a equipe entregou esta
          // semana" nao tem como ser respondido — done e um booleano sem memoria.
          .update({ done, done_at: done ? new Date().toISOString() : null })
          .eq("id", id)
          .eq("task_id", taskId)
          .select("id"),
        "Sem permissão para alterar esta subtarefa.",
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks-board", organizationId] }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível atualizar a subtarefa"),
  });

  const removeSubtask = useMutation({
    mutationFn: async ({ id, taskId }: { id: string; taskId: string }) => {
      exigirLinhaEscrita(
        await taskSupabase
          .from<LinhasAfetadas>("task_subtasks")
          .delete()
          .eq("id", id)
          .eq("task_id", taskId)
          .select("id"),
        "Sem permissão para remover esta subtarefa.",
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks-board", organizationId] }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível remover a subtarefa"),
  });

  const setSubtaskDueDate = useMutation({
    mutationFn: async ({ id, dueDate }: { id: string; dueDate: string | null }) => {
      exigirLinhaEscrita(
        await taskSupabase
          .from<LinhasAfetadas>("task_subtasks")
          .update({ due_date: dueDate })
          .eq("id", id)
          .select("id"),
        "Sem permissão para alterar o prazo desta subtarefa.",
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks-board", organizationId] }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Nao foi possivel salvar o prazo"),
  });
  const setSubtaskAssignee = useMutation({
    mutationFn: async ({ id, assigneeId }: { id: string; assigneeId: string | null }) => {
      exigirLinhaEscrita(
        await taskSupabase
          .from<LinhasAfetadas>("task_subtasks")
          .update({ assignee_id: assigneeId })
          .eq("id", id)
          .select("id"),
        "Sem permissão para direcionar esta subtarefa.",
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks-board", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["my-subtasks"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível direcionar a subtarefa"),
  });

  const toggleTimer = useMutation({
    mutationFn: async (taskId: string) => {
      if (!user) throw new Error("Sessão inválida");

      if (activeUserTimer) {
        if (activeUserTimer.task_id !== taskId) {
          throw new Error("Pare o timer ativo em outra tarefa antes de iniciar este");
        }

        const { error } = await taskSupabase
          .from<null>("task_time_entries")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", activeUserTimer.id)
          .eq("task_id", taskId)
          .eq("user_id", user.id);
        if (error) throw error;
        return "stopped" as const;
      }

      const { error } = await taskSupabase.from<null>("task_time_entries").insert({
        task_id: taskId,
        user_id: user.id,
        started_at: new Date().toISOString(),
        ended_at: null,
        duration_seconds: null,
      });
      if (error) throw error;
      return "started" as const;
    },
    onSuccess: (action) => {
      setNowMs(Date.now());
      queryClient.invalidateQueries({ queryKey: ["tasks-board", organizationId] });
      // Atualiza o cronômetro flutuante global na hora.
      queryClient.invalidateQueries({ queryKey: ["running-timer"] });
      toast.success(action === "started" ? "Timer iniciado" : "Tempo registrado");
    },
    onError: (error) => {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : null;
      if (code === "23505") {
        toast.error("Você já possui um timer ativo. Pare-o antes de iniciar outro.");
        return;
      }
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o timer");
    },
  });

  const preferredAssigneeId = () => {
    const members = boardQuery.data?.members ?? [];
    return members.find((member) => member.userId === user?.id)?.userId ?? members[0]?.userId ?? "";
  };

  const openCreateTask = () => {
    setEditingTask(null);
    setTitle("");
    setDescription("");
    setClientId("none");
    setAssigneeId(preferredAssigneeId());
    setPriority("medium");
    setDueDate(format(new Date(), "yyyy-MM-dd"));
    setTagsInput("");
    setSubtaskTitle("");
    setDraftSubtasks([]);
    setTaskDialogOpen(true);
  };

  const openEditTask = (task: TaskRecord) => {
    setEditingTask(task);
    setTitle(task.title);
    setDescription(task.description ?? "");
    setClientId(task.client_id ?? "none");
    setAssigneeId(task.assignee_id);
    setPriority(task.priority);
    setDueDate(task.due_date);
    setTagsInput(task.tags.join(", "));
    setSubtaskTitle("");
    setDraftSubtasks([]);
    setTaskDialogOpen(true);
  };

  // Concluídas fora da janela. Guardado à parte para o rodapé da coluna poder
  // dizer quantas ficaram de fora em vez de simplesmente escondê-las.
  const concluidasAntigas = useMemo(() => {
    if (mostrarTodasConcluidas) return 0;
    const limite = new Date();
    limite.setDate(limite.getDate() - DIAS_CONCLUIDAS_VISIVEIS);
    return filteredTasks.filter(
      (task) => task.status === "done" && task.done_at !== null && new Date(task.done_at) < limite,
    ).length;
  }, [filteredTasks, mostrarTodasConcluidas]);

  // Contadores da lateral. Saem de localTasks (a organizacao inteira), nao de
  // filteredTasks: a lateral tem que dizer o estado de TODOS os clientes,
  // inclusive o daquele que voce nao esta olhando agora.
  const { abertasPorCliente, atrasadasPorCliente } = useMemo(() => {
    const abertas = new Map<string, number>();
    const atrasadas = new Map<string, number>();
    const hoje = startOfDay(new Date());
    const soma = (mapa: Map<string, number>, chave: string) =>
      mapa.set(chave, (mapa.get(chave) ?? 0) + 1);

    for (const task of localTasks) {
      if (task.done) continue;
      const chave = task.client_id ?? "__interno__";
      soma(abertas, chave);
      soma(abertas, "__todas__");
      if (isBefore(parseISO(task.due_date), hoje)) {
        soma(atrasadas, chave);
        soma(atrasadas, "__todas__");
      }
    }
    return { abertasPorCliente: abertas, atrasadasPorCliente: atrasadas };
  }, [localTasks]);
  const tasksByStatus = useMemo(() => {
    const limite = new Date();
    limite.setDate(limite.getDate() - DIAS_CONCLUIDAS_VISIVEIS);

    return Object.fromEntries(
      COLUMNS.map((column) => [
        column.id,
        filteredTasks
          .filter((task) => {
            if (task.status !== column.id) return false;
            if (column.id !== "done" || mostrarTodasConcluidas) return true;
            // Sem done_at a data é desconhecida (concluída antes da coluna
            // existir): fica visível, porque esconder por falta de dado seria
            // sumir com trabalho sem conseguir explicar o motivo.
            if (task.done_at === null) return true;
            return new Date(task.done_at) >= limite;
          })
          .sort((a, b) => a.position - b.position),
      ])
    ) as Record<TaskStatus, TaskRecord[]>;
  }, [filteredTasks, mostrarTodasConcluidas]);

  const activeTask = activeTaskId ? localTasks.find((task) => task.id === activeTaskId) : undefined;

  const handleDragStart = ({ active }: DragStartEvent) => setActiveTaskId(String(active.id));

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveTaskId(null);
    if (!over || active.id === over.id || moveTask.isPending) return;

    const movingTask = localTasks.find((task) => task.id === active.id);
    if (!movingTask) return;

    const overType = over.data.current?.type;
    const targetStatus = (overType === "column"
      ? over.data.current?.status
      : over.data.current?.task?.status) as TaskStatus | undefined;
    if (!targetStatus) return;

    const previous = localTasks;
    let next: TaskRecord[];

    if (movingTask.status === targetStatus) {
      // Reordena contra a coluna completa, inclusive cards ocultos pelos
      // filtros, para não gerar posições duplicadas no banco.
      const columnTasks = localTasks
        .filter((task) => task.status === targetStatus)
        .sort((a, b) => a.position - b.position);
      const oldIndex = columnTasks.findIndex((task) => task.id === movingTask.id);
      const newIndex = overType === "task"
        ? columnTasks.findIndex((task) => task.id === over.id)
        : columnTasks.length - 1;
      if (oldIndex < 0 || newIndex < 0) return;
      if (oldIndex === newIndex) return;

      const reordered = arrayMove(columnTasks, oldIndex, newIndex).map((task, position) => ({ ...task, position }));
      const reorderedById = new Map(reordered.map((task) => [task.id, task]));
      next = localTasks.map((task) => reorderedById.get(task.id) ?? task);
    } else {
      const targetTasks = localTasks
        .filter((task) => task.status === targetStatus && task.id !== movingTask.id)
        .sort((a, b) => a.position - b.position);
      const targetIndex = overType === "task"
        ? Math.max(0, targetTasks.findIndex((task) => task.id === over.id))
        : targetTasks.length;

      targetTasks.splice(targetIndex, 0, { ...movingTask, status: targetStatus });
      const normalizedTarget = targetTasks.map((task, position) => ({ ...task, position }));
      const sourceTasks = localTasks
        .filter((task) => task.status === movingTask.status && task.id !== movingTask.id)
        .sort((a, b) => a.position - b.position)
        .map((task, position) => ({ ...task, position }));
      const changedById = new Map([...normalizedTarget, ...sourceTasks].map((task) => [task.id, task]));
      next = localTasks.map((task) => changedById.get(task.id) ?? task);
    }

    setLocalTasks(next);
    moveTask.mutate({ previous, next });
  };

  if (organizationLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <div className="grid grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-[520px] rounded-3xl" />)}
        </div>
      </div>
    );
  }

  if (isLegacy) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600">
          <AlertCircle className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold">Organização necessária</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          O módulo de tarefas depende do modo multi-organização para manter os dados de cada equipe isolados.
        </p>
      </div>
    );
  }

  return (
    <div className="nrt-surface -mx-4 -mt-4 min-h-[calc(100vh-4rem)] px-4 pb-10 pt-6 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-8">
      <div className="mx-auto flex max-w-[1500px] gap-5">
        <ProjectRail
          clients={boardQuery.data?.clients ?? []}
          abertasPorCliente={abertasPorCliente}
          atrasadasPorCliente={atrasadasPorCliente}
          loading={boardQuery.isLoading}
        />
        <div className="min-w-0 flex-1">
        <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <ListTodo className="h-4 w-4" /> Gestão da equipe
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">{tituloDoQuadro}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {quadroFixo
                ? "Somente as tarefas deste projeto. O filtro de cliente fica travado aqui."
                : "Acompanhe o trabalho da equipe e mova os cards conforme avançam."}
            </p>
            {quadroFixo && (
              <Link to="/tasks" className="mt-1.5 inline-block text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                ← Ver todas as tarefas
              </Link>
            )}
          </div>

          {canEditContent && (
            <>
              {/* Subtarefa deixou de ser assunto de topo desta tela: ela é um
                  detalhe DENTRO de uma tarefa, e vive no card (contador x/y) e
                  no diálogo de edição. O quadro paralelo por responsável e o
                  botão avulso davam a ela peso de entidade independente e
                  faziam a página abrir com duas leituras concorrentes. */}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" className="gap-2" onClick={() => setPuxarProducaoAberto(true)}>
                  <Workflow className="h-4 w-4" /> Puxar da Produção
                </Button>
                <Button className="gap-2" onClick={openCreateTask}>
                  <Plus className="h-4 w-4" /> Nova tarefa
                </Button>
              </div>

              <Dialog
                open={taskDialogOpen}
                onOpenChange={(open) => {
                  if (saveTask.isPending || deleteTask.isPending) return;
                  setTaskDialogOpen(open);
                  if (!open) setEditingTask(null);
                }}
              >
              <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingTask ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
                </DialogHeader>
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!title.trim() || !assigneeId || !dueDate) return;
                    saveTask.mutate();
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="task-title">Título</Label>
                    <Input
                      id="task-title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Ex.: Revisar calendário de agosto"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="task-description">Descrição</Label>
                    <Textarea
                      id="task-description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Contexto, orientações e resultado esperado"
                      className="min-h-24 resize-y"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Cliente</Label>
                      <Select value={clientId} onValueChange={setClientId}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sem cliente</SelectItem>
                          {(boardQuery.data?.clients ?? []).map((client) => (
                            <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Prioridade</Label>
                      <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Baixa</SelectItem>
                          <SelectItem value="medium">Média</SelectItem>
                          <SelectItem value="high">Alta</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Responsável</Label>
                      <Select value={assigneeId} onValueChange={setAssigneeId} required>
                        <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {(boardQuery.data?.members ?? []).map((member) => (
                            <SelectItem key={member.userId} value={member.userId}>
                              {memberLabel(member)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="task-due-date">Prazo</Label>
                      <Input
                        id="task-due-date"
                        type="date"
                        value={dueDate}
                        onChange={(event) => setDueDate(event.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="task-tags">Tags</Label>
                    <Input
                      id="task-tags"
                      value={tagsInput}
                      onChange={(event) => setTagsInput(event.target.value)}
                      placeholder="conteúdo, urgente, aprovação"
                    />
                    <p className="text-xs text-muted-foreground">Separe as tags por vírgulas.</p>
                  </div>

                  {editingTask && (
                    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <ListChecks className="h-4 w-4 text-muted-foreground" />
                          <Label>Subtarefas</Label>
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">
                          {editingSubtasks.filter((subtask) => subtask.done).length}/{editingSubtasks.length}
                        </span>
                      </div>

                      {editingSubtasks.length > 0 ? (
                        <div className="space-y-1.5">
                          {editingSubtasks.map((subtask) => {
                            const subAssignee = subtask.assignee_id ? membersById.get(subtask.assignee_id) : null;
                            return (
                            <div
                              key={subtask.id}
                              className={cn(
                                "group/subtask flex items-center gap-2 rounded-lg bg-background/70 px-2.5 py-2",
                                subtask.assignee_id && "border-l-2 border-brand/60"
                              )}
                            >
                              <Checkbox
                                id={`subtask-${subtask.id}`}
                                checked={subtask.done}
                                disabled={toggleSubtask.isPending || removeSubtask.isPending}
                                onCheckedChange={(checked) => toggleSubtask.mutate({
                                  id: subtask.id,
                                  taskId: editingTask.id,
                                  done: checked === true,
                                })}
                              />
                              <label
                                htmlFor={`subtask-${subtask.id}`}
                                className={cn(
                                  "min-w-0 flex-1 cursor-pointer text-sm",
                                  subtask.done && "text-muted-foreground line-through"
                                )}
                              >
                                {subtask.title}
                              </label>

                              {/* Prazo da etapa. Vazio significa "segue a
                                  tarefa-mãe" — a maioria das subtarefas não
                                  precisa de data própria, e obrigar uma faria
                                  todo mundo repetir o prazo de cima. Fica
                                  vermelho quando venceu e ainda não foi feita. */}
                              <input
                                type="date"
                                value={subtask.due_date ?? ""}
                                aria-label={`Prazo da subtarefa ${subtask.title}`}
                                title={subtask.due_date ? "Prazo da etapa" : "Sem prazo próprio — segue a tarefa"}
                                disabled={setSubtaskDueDate.isPending}
                                onChange={(e) => setSubtaskDueDate.mutate({
                                  id: subtask.id,
                                  dueDate: e.target.value || null,
                                })}
                                className={cn(
                                  "h-7 shrink-0 rounded-md border-none bg-transparent px-1.5 text-xs text-muted-foreground shadow-none outline-none hover:bg-muted focus:ring-0",
                                  !subtask.due_date && "opacity-50",
                                  subtask.due_date && !subtask.done
                                    && isBefore(parseISO(subtask.due_date), startOfDay(new Date()))
                                    && "font-medium text-destructive opacity-100",
                                )}
                              />

                              {/* Direcionar a subtarefa a uma pessoa */}
                              <Select
                                value={subtask.assignee_id ?? "none"}
                                onValueChange={(v) => setSubtaskAssignee.mutate({ id: subtask.id, assigneeId: v === "none" ? null : v })}
                              >
                                <SelectTrigger
                                  className="h-7 w-auto gap-1 border-none bg-transparent px-1.5 text-xs shadow-none hover:bg-muted focus:ring-0"
                                  aria-label="Responsável da subtarefa"
                                  title={subAssignee ? `Responsável: ${subAssignee.name}` : "Direcionar a alguém"}
                                >
                                  {subAssignee ? (
                                    <Avatar className="h-5 w-5">
                                      <AvatarImage src={subAssignee.avatarUrl ?? undefined} />
                                      <AvatarFallback className="text-[9px]">{initials(subAssignee.name)}</AvatarFallback>
                                    </Avatar>
                                  ) : (
                                    <UserRound className="h-4 w-4 text-muted-foreground/50" />
                                  )}
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Ninguém</SelectItem>
                                  {(boardQuery.data?.members ?? []).map((m) => (
                                    <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>

                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground opacity-60 hover:text-destructive group-hover/subtask:opacity-100"
                                aria-label={`Remover subtarefa ${subtask.title}`}
                                disabled={removeSubtask.isPending || toggleSubtask.isPending}
                                onClick={() => removeSubtask.mutate({ id: subtask.id, taskId: editingTask.id })}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
                          Nenhuma subtarefa adicionada.
                        </p>
                      )}

                      <div className="flex gap-2">
                        <Input
                          value={subtaskTitle}
                          onChange={(event) => setSubtaskTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            if (subtaskTitle.trim() && !addSubtask.isPending) addSubtask.mutate();
                          }}
                          placeholder="Adicionar uma subtarefa"
                          aria-label="Título da nova subtarefa"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0 gap-1.5"
                          disabled={!subtaskTitle.trim() || addSubtask.isPending}
                          onClick={() => addSubtask.mutate()}
                        >
                          <Plus className="h-4 w-4" /> Adicionar
                        </Button>
                      </div>
                    </div>
                  )}

                  {!editingTask && (
                    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3.5">
                      <div className="flex items-center gap-2">
                        <ListChecks className="h-4 w-4 text-muted-foreground" />
                        <Label>Subtarefas</Label>
                        {draftSubtasks.length > 0 && (
                          <span className="ml-auto text-xs font-medium text-muted-foreground">{draftSubtasks.length}</span>
                        )}
                      </div>

                      {draftSubtasks.length > 0 ? (
                        <div className="space-y-1.5">
                          {draftSubtasks.map((draft, index) => (
                            <div
                              key={index}
                              className="group/subtask flex items-center gap-2 rounded-lg bg-background/70 px-2.5 py-2"
                            >
                              <span className="min-w-0 flex-1 text-sm">{draft}</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground opacity-60 hover:text-destructive group-hover/subtask:opacity-100"
                                aria-label={`Remover subtarefa ${draft}`}
                                onClick={() => setDraftSubtasks((prev) => prev.filter((_, idx) => idx !== index))}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
                          Nenhuma subtarefa adicionada.
                        </p>
                      )}

                      <div className="flex gap-2">
                        <Input
                          value={subtaskTitle}
                          onChange={(event) => setSubtaskTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            if (subtaskTitle.trim()) {
                              setDraftSubtasks((prev) => [...prev, subtaskTitle.trim()]);
                              setSubtaskTitle("");
                            }
                          }}
                          placeholder="Adicionar uma subtarefa"
                          aria-label="Título da nova subtarefa"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="shrink-0 gap-1.5"
                          disabled={!subtaskTitle.trim()}
                          onClick={() => {
                            if (subtaskTitle.trim()) {
                              setDraftSubtasks((prev) => [...prev, subtaskTitle.trim()]);
                              setSubtaskTitle("");
                            }
                          }}
                        >
                          <Plus className="h-4 w-4" /> Adicionar
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className={cn("flex items-center gap-3 pt-2", editingTask ? "justify-between" : "justify-end")}>
                    {editingTask && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button type="button" variant="ghost" className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive">
                            <Trash2 className="h-4 w-4" /> Excluir
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir esta tarefa?</AlertDialogTitle>
                            <AlertDialogDescription>
                              A tarefa “{editingTask.title}” e suas subtarefas serão removidas. Esta ação não pode ser desfeita.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteTask.mutate()}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Excluir tarefa
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}

                    <Button
                      type="submit"
                      disabled={saveTask.isPending || deleteTask.isPending || !title.trim() || !assigneeId || !dueDate}
                    >
                      {saveTask.isPending ? "Salvando..." : editingTask ? "Salvar alterações" : "Criar tarefa"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
              </Dialog>
            </>
          )}
        </div>

        <div className="mb-5 rounded-2xl border border-border/70 bg-card/70 p-3 shadow-sm backdrop-blur-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="flex h-9 items-center gap-2 text-sm font-medium text-muted-foreground">
                <Filter className="h-4 w-4" /> Filtros
              </div>

              <Button
                type="button"
                size="sm"
                variant={onlyMineActive ? "default" : "outline"}
                className="h-9 gap-2"
                aria-pressed={onlyMineActive}
                disabled={!user || !membersById.has(user.id)}
                onClick={() => updateFilters({ assigneeId: onlyMineActive ? "all" : user!.id })}
              >
                <UserCheck className="h-4 w-4" /> Só as minhas
              </Button>

              <div className="min-w-[190px] flex-1 space-y-1 sm:max-w-[240px]">
                <Label className="text-[11px] text-muted-foreground">Função</Label>
                <Select value={functionFilter} onValueChange={(value) => updateFilters({ functionId: value })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as funções</SelectItem>
                    {(boardQuery.data?.functions ?? []).map((teamFunction) => (
                      <SelectItem key={teamFunction.id} value={teamFunction.id}>
                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: teamFunction.color }} />
                          {teamFunction.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-[190px] flex-1 space-y-1 sm:max-w-[240px]">
                <Label className="text-[11px] text-muted-foreground">Responsável</Label>
                <Select value={assigneeFilter} onValueChange={(value) => updateFilters({ assigneeId: value })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os responsáveis</SelectItem>
                    {(boardQuery.data?.members ?? [])
                      .filter((member) => !membersForFunction || membersForFunction.has(member.userId))
                      .map((member) => (
                      <SelectItem key={member.userId} value={member.userId}>
                        {memberLabel(member)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Num quadro de projeto o cliente já está decidido pela rota;
                  deixar o seletor aqui permitiria sair do projeto sem sair da
                  página, e o título passaria a mentir. */}
              <div className={cn("min-w-[190px] flex-1 space-y-1 sm:max-w-[240px]", quadroFixo && "hidden")}>
                <Label className="text-[11px] text-muted-foreground">Cliente</Label>
                <Select value={clientFilter} onValueChange={(value) => updateFilters({ clientId: value })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os clientes</SelectItem>
                    <SelectItem value="none">Sem cliente</SelectItem>
                    {(boardQuery.data?.clients ?? []).map((client) => (
                      <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-[170px] flex-1 space-y-1 sm:max-w-[210px]">
                <Label className="text-[11px] text-muted-foreground">Prioridade</Label>
                <Select
                  value={priorityFilter}
                  onValueChange={(value) => updateFilters({ priority: value as TaskFilters["priority"] })}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as prioridades</SelectItem>
                    <SelectItem value="low">Baixa</SelectItem>
                    <SelectItem value="medium">Média</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <DateRangeFields
                idPrefix="tasks-due"
                from={dueFromFilter}
                to={dueToFilter}
                fromLabel="Entrega de"
                toLabel="Entrega até"
                onFromChange={(value) => updateFilters({ dueFrom: value })}
                onToChange={(value) => updateFilters({ dueTo: value })}
              />
            </div>

            <div className="flex h-9 shrink-0 items-center justify-between gap-3 xl:justify-end">
              {!boardQuery.isLoading && (
                <span className="text-xs text-muted-foreground">
                  {filteredTasks.length} de {localTasks.length} {localTasks.length === 1 ? "tarefa" : "tarefas"}
                </span>
              )}
              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-muted-foreground"
                  onClick={() => updateFilters(DEFAULT_FILTERS)}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Limpar
                </Button>
              )}
            </div>
          </div>
        </div>

        {boardQuery.isLoading ? (
          <div className="grid min-w-[1160px] grid-cols-4 gap-4 overflow-hidden">
            {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-[520px] rounded-3xl" />)}
          </div>
        ) : boardQuery.isError ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center">
            <AlertCircle className="mx-auto h-6 w-6 text-destructive" />
            <p className="mt-3 font-medium">Não foi possível carregar as tarefas</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirme se a migration do módulo foi aplicada neste ambiente.
            </p>
            <Button variant="outline" className="mt-4" onClick={() => boardQuery.refetch()}>Tentar novamente</Button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragCancel={() => setActiveTaskId(null)}
            onDragEnd={handleDragEnd}
          >
            <div className="grid grid-flow-col gap-4 overflow-x-auto pb-4 xl:grid-flow-row xl:grid-cols-4">
              {COLUMNS.map((column) => (
                <TaskColumn
                  key={column.id}
                  column={column}
                  tasks={tasksByStatus[column.id]}
                  clientsById={clientsById}
                  membersById={membersById}
                  subtasksByTaskId={subtasksByTaskId}
                  timeEntriesByTaskId={timeEntriesByTaskId}
                  currentUserId={user?.id}
                  activeTimerTaskId={activeUserTimer?.task_id}
                  nowMs={nowMs}
                  timerPending={toggleTimer.isPending}
                  onToggleTimer={canEditContent ? (taskId) => toggleTimer.mutate(taskId) : undefined}
                  draggingDisabled={!canEditContent || moveTask.isPending}
                  onEdit={canEditContent ? openEditTask : undefined}
                  hasActiveFilters={hasActiveFilters}
                  ocultas={column.id === "done" ? concluidasAntigas : 0}
                  onVerTodas={column.id === "done" ? () => setMostrarTodasConcluidas(true) : undefined}
                />
              ))}
            </div>

            <DragOverlay>
              {activeTask ? (
                <div className="w-[285px]">
                  <TaskCardContent
                    task={activeTask}
                    client={activeTask.client_id ? clientsById.get(activeTask.client_id) : undefined}
                    assignee={membersById.get(activeTask.assignee_id)}
                    subtasks={subtasksByTaskId.get(activeTask.id) ?? []}
                    timeEntries={timeEntriesByTaskId.get(activeTask.id) ?? []}
                    currentUserId={user?.id}
                    activeTimerTaskId={activeUserTimer?.task_id}
                    nowMs={nowMs}
                    dragging
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {organizationId && user && (
          <PullFromProductionDialog
            open={puxarProducaoAberto}
            onOpenChange={setPuxarProducaoAberto}
            organizationId={organizationId}
            clientId={boardClientId ?? null}
            clientName={boardClientId ? (clientsById.get(boardClientId)?.name ?? null) : null}
            members={(boardQuery.data?.members ?? []).map((m) => ({ userId: m.userId, name: m.name }))}
            createdBy={user.id}
          />
        )}
        {!canEditContent && !boardQuery.isLoading && !boardQuery.isError && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <UserRound className="h-3.5 w-3.5" /> Seu papel possui acesso somente para visualização.
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
