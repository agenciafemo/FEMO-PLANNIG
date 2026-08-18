import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Square, Timer } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { elapsedFrom, fmtDuration, loadRunningTimer, stopTimerEntry } from "@/lib/runningTimer";

// Chip do cronômetro na navbar: aparece quando há um timer rodando E o usuário
// NÃO está na área de Tarefas (saiu dela, mas continua no app). Some com uma
// animação de surgir. Clicar leva de volta às Tarefas.

export function NavbarTaskTimer() {
  const { user } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [, setTick] = useState(0);

  const { data: running } = useQuery({
    queryKey: ["running-timer", user?.id],
    queryFn: () => loadRunningTimer(user!.id),
    enabled: !!user,
    refetchInterval: 15000,
  });

  // Tique de 1s só quando há timer (re-renderiza para atualizar o relógio).
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  const stop = useMutation({
    mutationFn: async () => {
      if (running) await stopTimerEntry(running.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["running-timer"] });
      queryClient.invalidateQueries({ queryKey: ["tasks-board"] });
    },
  });

  const onTasksPage = location.pathname.startsWith("/tasks");
  if (!running || onTasksPage) return null;

  return (
    <Link
      to="/tasks"
      title={`Cronômetro rodando: ${running.tasks?.title ?? "Tarefa"}`}
      className="flex items-center gap-2 rounded-full border border-border bg-card/70 py-1 pl-2.5 pr-1.5 text-sm shadow-sm transition-colors hover:bg-muted/60 animate-in fade-in slide-in-from-right-2 duration-300"
    >
      <Timer className="h-4 w-4 shrink-0 text-brand" />
      <span className="hidden max-w-[120px] truncate text-xs font-medium text-muted-foreground sm:inline">
        {running.tasks?.title ?? "Tarefa"}
      </span>
      <span className="font-semibold tabular-nums text-brand">{fmtDuration(elapsedFrom(running.started_at))}</span>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); stop.mutate(); }}
        disabled={stop.isPending}
        aria-label="Parar cronômetro"
        title="Parar"
        className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-60"
      >
        <Square className="h-3 w-3 fill-current" />
      </button>
    </Link>
  );
}
