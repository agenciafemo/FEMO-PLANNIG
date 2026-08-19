import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ListChecks, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

// Quadro dedicado de SUBTAREFAS: colunas por responsável (+ "Sem responsável"),
// cada card mostra a subtarefa, a tarefa-mãe e o cliente, com checkbox.

type SubtaskLite = { id: string; task_id: string; title: string; done: boolean; assignee_id: string | null };
type TaskLite = { id: string; title: string; client_id: string | null };
type ClientLite = { id: string; name: string };
type MemberLite = { userId: string; name: string; avatarUrl: string | null };

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("") || "?";
}

export function SubtasksBoard({
  subtasks,
  tasksById,
  clientsById,
  members,
  onlyMineUserId,
  onToggle,
  togglePending,
}: {
  subtasks: SubtaskLite[];
  tasksById: Map<string, TaskLite>;
  clientsById: Map<string, ClientLite>;
  members: MemberLite[];
  onlyMineUserId: string | null;
  onToggle: (id: string, taskId: string, done: boolean) => void;
  togglePending: boolean;
}) {
  const byAssignee = new Map<string, SubtaskLite[]>();
  const unassigned: SubtaskLite[] = [];
  for (const s of subtasks) {
    if (!s.assignee_id) { unassigned.push(s); continue; }
    const arr = byAssignee.get(s.assignee_id) ?? [];
    arr.push(s);
    byAssignee.set(s.assignee_id, arr);
  }

  let columns = members.filter((m) => byAssignee.has(m.userId));
  if (onlyMineUserId) columns = columns.filter((m) => m.userId === onlyMineUserId);
  const showUnassigned = !onlyMineUserId && unassigned.length > 0;

  const sortDone = (a: SubtaskLite, b: SubtaskLite) => Number(a.done) - Number(b.done);

  const Card = ({ s }: { s: SubtaskLite }) => {
    const task = tasksById.get(s.task_id);
    const client = task?.client_id ? clientsById.get(task.client_id) : null;
    return (
      <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/70 bg-card p-3 transition-opacity", s.done && "opacity-60")}>
        <Checkbox
          checked={s.done}
          disabled={togglePending}
          onCheckedChange={(c) => onToggle(s.id, s.task_id, c === true)}
          className="mt-0.5"
        />
        <div className="min-w-0">
          <p className={cn("text-sm font-medium leading-snug", s.done && "text-muted-foreground line-through")}>{s.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {task?.title ?? "Tarefa"}{client ? ` · ${client.name}` : ""}
          </p>
        </div>
      </label>
    );
  };

  if (columns.length === 0 && !showUnassigned) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
        <ListChecks className="mx-auto mb-2 h-6 w-6 opacity-50" />
        Nenhuma subtarefa direcionada ainda. Use <span className="font-medium text-foreground">"Nova subtarefa"</span> e escolha um responsável.
      </div>
    );
  }

  return (
    <div className="grid grid-flow-col auto-cols-[minmax(260px,300px)] gap-4 overflow-x-auto pb-4 xl:grid-flow-row xl:auto-cols-auto xl:grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
      {columns.map((m) => {
        const items = (byAssignee.get(m.userId) ?? []).slice().sort(sortDone);
        const pending = items.filter((s) => !s.done).length;
        return (
          <div key={m.userId} className="rounded-2xl border border-border/70 bg-card/40 p-3">
            <div className="mb-3 flex items-center gap-2">
              <Avatar className="h-7 w-7">
                <AvatarImage src={m.avatarUrl ?? undefined} />
                <AvatarFallback className="text-[10px]">{initials(m.name)}</AvatarFallback>
              </Avatar>
              <span className="truncate text-sm font-semibold">{m.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{pending} pend.</span>
            </div>
            <div className="space-y-2">{items.map((s) => <Card key={s.id} s={s} />)}</div>
          </div>
        );
      })}

      {showUnassigned && (
        <div className="rounded-2xl border border-dashed border-border/70 bg-card/20 p-3">
          <div className="mb-3 flex items-center gap-2 text-muted-foreground">
            <UserRound className="h-5 w-5" />
            <span className="text-sm font-semibold">Sem responsável</span>
            <span className="ml-auto shrink-0 text-xs">{unassigned.filter((s) => !s.done).length} pend.</span>
          </div>
          <div className="space-y-2">
            {unassigned.slice().sort(sortDone).map((s) => <Card key={s.id} s={s} />)}
          </div>
        </div>
      )}
    </div>
  );
}
