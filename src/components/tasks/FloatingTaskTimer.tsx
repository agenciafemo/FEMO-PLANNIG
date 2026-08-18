import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Loader2, PictureInPicture2, Square, Timer, X } from "lucide-react";
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

  // Picture-in-Picture (janelinha que flutua sobre tudo, tipo o Google Meet).
  // Só existe no Chrome recente (Document Picture-in-Picture API).
  const pipApi = (typeof window !== "undefined" ? (window as any).documentPictureInPicture : undefined);
  const pipSupported = !!pipApi;
  const pipWinRef = useRef<Window | null>(null);
  const pipTimeRef = useRef<HTMLElement | null>(null);
  const runningRef = useRef<RunningEntry | null>(null);

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

  const stop = useMutation({
    mutationFn: async () => {
      const current = runningRef.current;
      if (!current) return;
      const { error } = await (supabase as any)
        .from("task_time_entries")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", current.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["running-timer"] });
      queryClient.invalidateQueries({ queryKey: ["tasks-board"] });
    },
  });

  const elapsedNow = () => {
    const c = runningRef.current;
    return c ? Math.floor((Date.now() - new Date(c.started_at).getTime()) / 1000) : 0;
  };

  // Abre a janelinha PiP (flutua sobre tudo). Exige gesto do usuário (clique).
  async function openPip() {
    if (!pipSupported || pipWinRef.current || !runningRef.current) return;
    try {
      const pip: Window = await pipApi.requestWindow({ width: 300, height: 104 });
      pipWinRef.current = pip;
      const doc = pip.document;
      doc.body.style.cssText = "margin:0;font-family:system-ui,-apple-system,sans-serif;background:#0b0c0e;color:#fff;";
      const wrap = doc.createElement("div");
      wrap.style.cssText = "display:flex;align-items:center;gap:12px;padding:14px 16px;height:100%;box-sizing:border-box;";
      const info = doc.createElement("div");
      info.style.cssText = "flex:1;min-width:0;";
      const title = doc.createElement("div");
      title.textContent = runningRef.current.tasks?.title ?? "Tarefa";
      title.style.cssText = "font-size:12px;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      const time = doc.createElement("div");
      time.style.cssText = "font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;color:#2dd4bf;line-height:1.1;";
      time.textContent = fmt(elapsedNow());
      pipTimeRef.current = time;
      info.appendChild(title);
      info.appendChild(time);
      const stopBtn = doc.createElement("button");
      stopBtn.textContent = "Parar";
      stopBtn.style.cssText = "background:#dc2626;color:#fff;border:none;border-radius:999px;padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer;";
      stopBtn.onclick = () => stop.mutate();
      wrap.appendChild(info);
      wrap.appendChild(stopBtn);
      doc.body.appendChild(wrap);
      pip.addEventListener("pagehide", () => {
        pipWinRef.current = null;
        pipTimeRef.current = null;
      });
    } catch {
      // Bloqueado (sem gesto) ou não suportado — mantém o widget dentro do app.
    }
  }

  // Mantém a ref do timer atual (para o PiP e o botão parar).
  useEffect(() => { runningRef.current = running ?? null; }, [running]);

  // Tique de 1s: atualiza o widget e a janelinha PiP (se aberta).
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      setNow(Date.now());
      if (pipTimeRef.current) pipTimeRef.current.textContent = fmt(elapsedNow());
    }, 1000);
    return () => window.clearInterval(t);
  }, [running]);

  // Ao SAIR da aba, tenta abrir a janelinha sozinho; ao voltar, fecha.
  // (O navegador pode exigir o clique no botão — por isso o botão existe.)
  useEffect(() => {
    if (!running || !pipSupported) return;
    const onVisibility = () => {
      if (document.hidden) {
        if (!pipWinRef.current) void openPip();
      } else if (pipWinRef.current) {
        pipWinRef.current.close();
        pipWinRef.current = null;
        pipTimeRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, pipSupported]);

  // Fecha a janelinha quando o timer para ou o componente desmonta.
  useEffect(() => {
    if (!running && pipWinRef.current) {
      pipWinRef.current.close();
      pipWinRef.current = null;
      pipTimeRef.current = null;
    }
  }, [running]);

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

      {pipSupported && (
        <button
          onClick={() => void openPip()}
          className="rounded-full p-1 text-muted-foreground hover:text-brand"
          aria-label="Abrir janela flutuante"
          title="Flutuar sobre tudo (fica visível fora da aba)"
        >
          <PictureInPicture2 className="h-3.5 w-3.5" />
        </button>
      )}

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
