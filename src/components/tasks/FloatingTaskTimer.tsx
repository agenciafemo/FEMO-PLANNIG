import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Loader2, Square, Timer, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePersistedState } from "@/hooks/usePersistedState";

// Cronômetro flutuante GLOBAL: mostra a tarefa em andamento e o tempo correndo
// em qualquer página do app (fica montado no AppLayout, então sobrevive à
// navegação). Pode ser arrastado pela tela e escondido até o próximo timer.

type RunningEntry = {
  id: string;
  task_id: string;
  started_at: string;
  tasks: { title: string } | null;
};

function fmt(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function FloatingTaskTimer() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(Date.now());
  const [hiddenFor, setHiddenFor] = useState<string | null>(null); // id do timer escondido
  const [pos, setPos] = usePersistedState<{ x: number; y: number } | null>("nrt-timer-pos", null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // Timer em andamento do usuário (ended_at nulo). Refetch periódico para pegar
  // quando um timer é iniciado/parado em outra tela ou aba.
  const { data: running } = useQuery({
    queryKey: ["running-timer", user?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("task_time_entries")
        .select("id, task_id, started_at, tasks(title)")
        .eq("user_id", user!.id)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as RunningEntry | null) ?? null;
    },
    enabled: !!user,
    refetchInterval: 15000,
  });

  // Tique de 1s só enquanto há timer rodando.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  const stop = useMutation({
    mutationFn: async () => {
      if (!running) return;
      const { error } = await (supabase as any)
        .from("task_time_entries")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", running.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["running-timer"] });
      queryClient.invalidateQueries({ queryKey: ["tasks-board"] });
    },
  });

  // Arrastar pela tela.
  function onPointerDown(e: React.PointerEvent) {
    const card = (e.currentTarget as HTMLElement).closest("[data-timer-card]") as HTMLElement | null;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const w = 280, h = 64; // margem de clamp aproximada
    const x = Math.min(Math.max(8, e.clientX - dragRef.current.dx), window.innerWidth - w);
    const y = Math.min(Math.max(8, e.clientY - dragRef.current.dy), window.innerHeight - h);
    setPos({ x, y });
  }
  function onPointerUp(e: React.PointerEvent) {
    dragRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }

  if (!running) return null;
  if (hiddenFor === running.id) return null;

  const elapsed = Math.floor((now - new Date(running.started_at).getTime()) / 1000);
  const style = pos
    ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" as const }
    : { right: 20, bottom: 20 };

  return (
    <div
      data-timer-card
      style={style as React.CSSProperties}
      className="fixed z-[60] flex items-center gap-2 rounded-full border border-border bg-card/95 py-1.5 pl-1.5 pr-2 shadow-lg backdrop-blur-md"
    >
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="cursor-grab touch-none rounded-full p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="Arrastar cronômetro"
        title="Arrastar"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Timer className="h-4 w-4" />
      </span>

      <div className="min-w-0 max-w-[150px]">
        <p className="truncate text-xs font-medium leading-tight">{running.tasks?.title ?? "Tarefa"}</p>
        <p className="text-sm font-semibold tabular-nums leading-tight text-brand">{fmt(elapsed)}</p>
      </div>

      <button
        onClick={() => stop.mutate()}
        disabled={stop.isPending}
        className="ml-1 flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-60"
        title="Parar cronômetro"
      >
        {stop.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3 fill-current" />}
        Parar
      </button>

      <button
        onClick={() => setHiddenFor(running.id)}
        className="rounded-full p-1 text-muted-foreground hover:text-foreground"
        aria-label="Esconder cronômetro"
        title="Esconder (até o próximo timer)"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
