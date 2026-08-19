import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// Drawer minimalista com as subtarefas DIRECIONADAS ao usuário logado (de
// qualquer tarefa), agrupadas por tarefa/cliente, com checkbox para concluir.
// O gatilho (ícone + contador) só aparece quando há subtarefas suas.

type MySubtask = {
  id: string;
  title: string;
  done: boolean;
  task_id: string;
  tasks: { title: string | null; clients: { name: string | null } | null } | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export function MySubtasksDrawer() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: subs = [] } = useQuery({
    queryKey: ["my-subtasks", user?.id],
    queryFn: async () => {
      const { data } = await (supabase as AnyClient)
        .from("task_subtasks")
        .select("id, title, done, task_id, tasks!inner(title, client_id, clients(name))")
        .eq("assignee_id", user!.id)
        .order("done", { ascending: true });
      return (data as MySubtask[]) ?? [];
    },
    enabled: !!user,
    refetchInterval: 30000,
  });

  const toggle = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      const { error } = await (supabase as AnyClient)
        .from("task_subtasks")
        .update({ done })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-subtasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks-board"] });
    },
  });

  if (subs.length === 0) return null;

  const pending = subs.filter((s) => !s.done).length;

  // Agrupa por tarefa-mãe.
  const groups = Object.values(
    subs.reduce((acc, s) => {
      if (!acc[s.task_id]) {
        acc[s.task_id] = {
          taskId: s.task_id,
          taskTitle: s.tasks?.title ?? "Tarefa",
          clientName: s.tasks?.clients?.name ?? null,
          items: [] as MySubtask[],
        };
      }
      acc[s.task_id].items.push(s);
      return acc;
    }, {} as Record<string, { taskId: string; taskTitle: string; clientName: string | null; items: MySubtask[] }>),
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Minhas subtarefas"
          title="Minhas subtarefas"
        >
          <ListChecks className="h-5 w-5" />
          {pending > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
              {pending}
            </span>
          )}
        </button>
      </SheetTrigger>

      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-brand" /> Minhas subtarefas
          </SheetTitle>
          <SheetDescription>
            {pending > 0 ? `${pending} pendente${pending === 1 ? "" : "s"}` : "Tudo concluído por aqui 🎉"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {groups.map((group) => (
            <div key={group.taskId}>
              <div className="mb-2">
                <Link
                  to="/tasks"
                  onClick={() => setOpen(false)}
                  className="text-sm font-semibold hover:text-brand"
                >
                  {group.taskTitle}
                </Link>
                {group.clientName && (
                  <span className="ml-2 text-xs text-muted-foreground">· {group.clientName}</span>
                )}
              </div>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border/70 bg-card/50 px-3 py-2"
                  >
                    <Checkbox
                      checked={item.done}
                      disabled={toggle.isPending}
                      onCheckedChange={(checked) => toggle.mutate({ id: item.id, done: checked === true })}
                    />
                    <span className={cn("text-sm", item.done && "text-muted-foreground line-through")}>
                      {item.title}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
