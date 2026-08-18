import { supabase } from "@/integrations/supabase/client";

// Timer de tarefa em andamento (ended_at nulo). Compartilhado pelo chip da
// navbar e pela janelinha Picture-in-Picture (mesma query key -> um fetch só).

export type RunningEntry = {
  id: string;
  task_id: string;
  started_at: string;
  tasks: { title: string } | null;
};

// deno-lint-ignore-file
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export async function loadRunningTimer(userId: string): Promise<RunningEntry | null> {
  const { data } = await (supabase as AnyClient)
    .from("task_time_entries")
    .select("id, task_id, started_at, tasks(title)")
    .eq("user_id", userId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as RunningEntry | null) ?? null;
}

export async function stopTimerEntry(entryId: string): Promise<void> {
  const { error } = await (supabase as AnyClient)
    .from("task_time_entries")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", entryId);
  if (error) throw error;
}

export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function elapsedFrom(startedAt: string): number {
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
}
