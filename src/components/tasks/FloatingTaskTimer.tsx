import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { elapsedFrom, fmtDuration, loadRunningTimer, type RunningEntry, stopTimerEntry } from "@/lib/runningTimer";

// Cronômetro em Picture-in-Picture: NÃO mostra nada dentro da aba. Quando há um
// timer rodando e o usuário SAI da aba do Norteia, abre uma janelinha flutuante
// (tipo o Google Meet) sobre tudo, com o tempo correndo + botão parar. Ao voltar
// para a aba, fecha. Requer Chrome/Edge recente (Document Picture-in-Picture).

export function FloatingTaskTimer() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const pipApi = typeof window !== "undefined"
    ? (window as unknown as { documentPictureInPicture?: { requestWindow: (o?: { width?: number; height?: number }) => Promise<Window> } }).documentPictureInPicture
    : undefined;
  const pipSupported = !!pipApi;
  const pipWinRef = useRef<Window | null>(null);
  const runningRef = useRef<RunningEntry | null>(null);

  const { data: running } = useQuery({
    queryKey: ["running-timer", user?.id],
    queryFn: () => loadRunningTimer(user!.id),
    enabled: !!user,
    refetchInterval: 15000,
  });
  useEffect(() => { runningRef.current = running ?? null; }, [running]);

  const stop = useMutation({
    mutationFn: async () => {
      const current = runningRef.current;
      if (current) await stopTimerEntry(current.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["running-timer"] });
      queryClient.invalidateQueries({ queryKey: ["tasks-board"] });
    },
  });

  function closePip() {
    if (pipWinRef.current) {
      try { pipWinRef.current.close(); } catch { /* noop */ }
      pipWinRef.current = null;
    }
  }

  // Abre a janelinha PiP. O relógio roda DENTRO dela (pip.setInterval) para não
  // congelar quando a aba principal fica em segundo plano.
  async function openPip() {
    if (!pipSupported || pipWinRef.current || !runningRef.current) return;
    try {
      const pip = await pipApi!.requestWindow({ width: 300, height: 104 });
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
      time.textContent = fmtDuration(runningRef.current ? elapsedFrom(runningRef.current.started_at) : 0);
      info.appendChild(title);
      info.appendChild(time);
      const stopBtn = doc.createElement("button");
      stopBtn.textContent = "Parar";
      stopBtn.style.cssText = "background:#dc2626;color:#fff;border:none;border-radius:999px;padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer;";
      stopBtn.onclick = () => { stop.mutate(); closePip(); };
      wrap.appendChild(info);
      wrap.appendChild(stopBtn);
      doc.body.appendChild(wrap);

      const ticker = pip.setInterval(() => {
        time.textContent = fmtDuration(runningRef.current ? elapsedFrom(runningRef.current.started_at) : 0);
      }, 1000);
      pip.addEventListener("pagehide", () => {
        pip.clearInterval(ticker);
        pipWinRef.current = null;
      });
    } catch {
      // Bloqueado (sem gesto) ou não suportado — sem janelinha.
    }
  }

  // Abre ao SAIR da aba (com timer rodando); fecha ao voltar.
  useEffect(() => {
    if (!running || !pipSupported) return;
    const onVisibility = () => {
      if (document.hidden) {
        if (!pipWinRef.current) void openPip();
      } else {
        closePip();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, pipSupported]);

  // Fecha se o timer parar ou o componente desmontar.
  useEffect(() => {
    if (!running) closePip();
    return () => closePip();
  }, [running]);

  return null; // nada dentro da aba; só a janelinha PiP ao sair
}
