import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { addDays, addWeeks, format, isSameDay, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Instagram,
  Loader2,
  Send,
  X,
} from "lucide-react";
import {
  cancelScheduledPost,
  createScheduledPost,
  getScheduledPosts,
  runPublishWorker,
  type ScheduledPost,
} from "@/lib/metaScheduleRpc";
import { getClientMetaStatus } from "@/lib/metaRpc";
import { usePersistedState } from "@/hooks/usePersistedState";

interface ApprovedPost {
  id: string;
  caption: string | null;
  cover_image_url: string | null;
  content_type: string | null;
}

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function statusChip(status: string): { label: string; cls: string } {
  switch (status) {
    case "published":
      return { label: "Publicado", cls: "bg-success/15 text-success" };
    case "processing":
      return { label: "Publicando", cls: "bg-info/15 text-info" };
    case "failed":
      return { label: "Falhou", cls: "bg-destructive/15 text-destructive" };
    default:
      return { label: "Agendado", cls: "bg-info/15 text-info" };
  }
}

export default function Programacao() {
  const { user } = useAuth();
  const { organizationId, isLegacy } = useOrganization();
  const queryClient = useQueryClient();

  const [selected, setSelected] = usePersistedState<string>("prog-client", "");
  const [weekOffset, setWeekOffset] = useState(0);
  const [scheduling, setScheduling] = useState<ApprovedPost | null>(null);
  const [receipt, setReceipt] = useState<ScheduledPost | null>(null);
  const [scheduleDate, setScheduleDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [scheduleTime, setScheduleTime] = useState("12:00");

  const { data: clients } = useQuery({
    queryKey: ["prog-clients", organizationId],
    queryFn: async () => {
      let q = supabase.from("clients").select("id, name") as any;
      if (!isLegacy) q = q.eq("organization_id", organizationId!);
      const { data, error } = await q.order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: !!user && (isLegacy || !!organizationId),
  });

  const clientId = selected || clients?.[0]?.id || "";

  const { data: statusRows } = useQuery({
    queryKey: ["prog-conn", clientId],
    queryFn: () => getClientMetaStatus(clientId),
    enabled: !!clientId,
  });
  const connectionId = statusRows?.find((r) => r.connection_status === "active")?.connection_id ?? null;

  const { data: approved } = useQuery({
    queryKey: ["prog-approved", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("posts")
        .select("id, caption, cover_image_url, content_type, plannings!inner(client_id)") as any)
        .eq("status", "approved")
        .eq("plannings.client_id", clientId);
      if (error) throw error;
      return ((data ?? []) as ApprovedPost[]).filter((p) => p.cover_image_url);
    },
    enabled: !!clientId,
  });

  const rangeFrom = useMemo(
    () => addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), -52).toISOString(),
    [],
  );
  const rangeTo = useMemo(
    () => addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), 52).toISOString(),
    [],
  );
  const { data: scheduled } = useQuery({
    queryKey: ["prog-scheduled", clientId],
    queryFn: () => getScheduledPosts(rangeFrom, rangeTo, clientId),
    enabled: !!clientId,
  });

  const scheduledIds = new Set((scheduled ?? []).map((s) => s.post_id).filter(Boolean) as string[]);
  const backlog = (approved ?? []).filter((p) => !scheduledIds.has(p.id));

  const weekStart = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["prog-scheduled"] });
    queryClient.invalidateQueries({ queryKey: ["prog-approved"] });
  };

  const publishNow = useMutation({
    mutationFn: async (post: ApprovedPost) => {
      if (!connectionId) throw new Error("Cliente sem Instagram conectado");
      await createScheduledPost({
        clientId,
        connectionId,
        imageUrl: post.cover_image_url!,
        caption: post.caption ?? "",
        postId: post.id,
      });
      return runPublishWorker();
    },
    onSuccess: (res) => {
      toast.success(res.published > 0 ? "Publicado no Instagram!" : "Enviado — processando…");
      invalidate();
    },
    onError: (e: unknown) => toast.error("Erro ao publicar: " + (e as Error).message),
  });

  const schedule = useMutation({
    mutationFn: async () => {
      if (!connectionId || !scheduling) throw new Error("Cliente sem Instagram conectado");
      const when = new Date(`${scheduleDate}T${scheduleTime}:00`);
      if (isNaN(when.getTime())) throw new Error("Data/hora inválida");
      await createScheduledPost({
        clientId,
        connectionId,
        imageUrl: scheduling.cover_image_url!,
        caption: scheduling.caption ?? "",
        scheduledFor: when.toISOString(),
        postId: scheduling.id,
      });
    },
    onSuccess: () => {
      toast.success("Post agendado!");
      setScheduling(null);
      invalidate();
    },
    onError: (e: unknown) => toast.error("Erro ao agendar: " + (e as Error).message),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelScheduledPost(id),
    onSuccess: () => {
      toast.success("Agendamento cancelado");
      invalidate();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const itemsForDay = (day: Date): ScheduledPost[] =>
    (scheduled ?? []).filter((s) => isSameDay(new Date(s.scheduled_for), day));

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-brand" />
          <h1 className="text-2xl font-semibold tracking-tight">Programação</h1>
        </div>
        <Select value={clientId} onValueChange={setSelected}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Cliente" /></SelectTrigger>
          <SelectContent>
            {(clients ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Aviso: cliente sem conexão */}
      {clientId && statusRows && !connectionId && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-600">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Este cliente ainda não tem Instagram conectado. Conecte em <span className="font-medium">Clientes</span> para programar.
        </div>
      )}

      {/* Navegação de semana */}
      <div className="flex items-center justify-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setWeekOffset((w) => w - 1)} aria-label="Semana anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">
          {format(weekStart, "d 'de' MMM", { locale: ptBR })} – {format(addDays(weekStart, 6), "d 'de' MMM", { locale: ptBR })}
        </span>
        <Button variant="ghost" size="icon" onClick={() => setWeekOffset((w) => w + 1)} aria-label="Próxima semana">
          <ChevronRight className="h-4 w-4" />
        </Button>
        {weekOffset !== 0 && (
          <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)}>Hoje</Button>
        )}
      </div>

      {/* Fila "A programar" */}
      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-600">
          <Clock className="h-4 w-4" /> A programar — {backlog.length} {backlog.length === 1 ? "post aprovado" : "posts aprovados"}
        </p>
        {backlog.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">Nenhum post aprovado com imagem para programar.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {backlog.map((post) => (
              <div key={post.id} className="w-40 shrink-0 rounded-xl border border-border bg-card p-2">
                <div className="mb-2 h-24 w-full overflow-hidden rounded-lg bg-muted">
                  {post.cover_image_url && <img src={post.cover_image_url} alt="" className="h-full w-full object-cover" />}
                </div>
                {!post.caption?.trim() && (
                  <p className="mb-1 flex items-center gap-1 text-[10px] text-amber-600"><AlertTriangle className="h-3 w-3" /> sem legenda</p>
                )}
                <div className="flex gap-1">
                  <Button size="sm" className="h-7 flex-1 px-2 text-[11px]" disabled={!connectionId || publishNow.isPending}
                    onClick={() => publishNow.mutate(post)}>
                    {publishNow.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Send className="mr-1 h-3 w-3" /> Agora</>}
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 flex-1 px-2 text-[11px]" disabled={!connectionId}
                    onClick={() => { setScheduling(post); setScheduleDate(format(new Date(), "yyyy-MM-dd")); setScheduleTime("12:00"); }}>
                    <CalendarClock className="mr-1 h-3 w-3" /> Agendar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Calendário da semana */}
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((day, i) => (
          <div key={day.toISOString()} className="text-center text-xs text-muted-foreground">
            {WEEKDAYS[i]} {format(day, "d")}
          </div>
        ))}
        {days.map((day) => {
          const items = itemsForDay(day);
          const isToday = isSameDay(day, new Date());
          return (
            <div key={day.toISOString()} className={`min-h-28 rounded-lg border p-1.5 ${isToday ? "border-brand/40" : "border-border"}`}>
              <div className="flex flex-col gap-1.5">
                {items.map((it) => {
                  const chip = statusChip(it.status);
                  return (
                    <div key={it.id} className="rounded-md bg-muted/60 p-1.5">
                      <div className="flex items-center justify-between gap-1">
                        <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${chip.cls}`}>{chip.label}</span>
                        <span className="text-[9px] text-muted-foreground">{format(new Date(it.scheduled_for), "HH:mm")}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        <button onClick={() => setReceipt(it)} className="flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground" aria-label="Recibo">
                          <FileText className="h-2.5 w-2.5" /> recibo
                        </button>
                        {it.status === "published" && it.permalink && (
                          <a href={it.permalink} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-[9px] text-info hover:underline">
                            <ExternalLink className="h-2.5 w-2.5" /> ver
                          </a>
                        )}
                        {it.status === "published" && <CheckCircle2 className="h-3 w-3 text-success" />}
                        {(it.status === "queued" || it.status === "failed") && (
                          <button onClick={() => cancel.mutate(it.id)} className="flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-destructive" aria-label="Cancelar">
                            <X className="h-2.5 w-2.5" /> cancelar
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legenda */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Instagram className="h-3.5 w-3.5" /> Publica no Instagram do cliente selecionado.</span>
      </div>

      {/* Comprovante (recibo) do agendamento */}
      <Dialog open={!!receipt} onOpenChange={(v) => { if (!v) setReceipt(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Comprovante do agendamento</DialogTitle></DialogHeader>
          {receipt && (
            <div className="space-y-3 text-sm">
              <div className="h-40 w-full overflow-hidden rounded-lg bg-muted">
                <img src={receipt.image_url} alt="" className="h-full w-full object-cover" />
              </div>
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Cliente</dt>
                  <dd className="font-medium">{clients?.find((c) => c.id === receipt.client_id)?.name ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>{statusChip(receipt.status).label}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Agendado para</dt>
                  <dd className="font-medium">{format(new Date(receipt.scheduled_for), "dd/MM/yyyy 'às' HH:mm")}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Criado em</dt>
                  <dd>{format(new Date(receipt.created_at), "dd/MM/yyyy HH:mm")}</dd>
                </div>
                {receipt.error_code && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Erro</dt>
                    <dd className="text-destructive">{receipt.error_code}</dd>
                  </div>
                )}
              </dl>
              {receipt.caption?.trim() && (
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="mb-1 text-xs text-muted-foreground">Legenda</p>
                  <p className="whitespace-pre-wrap text-xs">{receipt.caption}</p>
                </div>
              )}
              {receipt.status === "published" && receipt.permalink && (
                <a href={receipt.permalink} target="_blank" rel="noreferrer" className="block">
                  <Button className="w-full"><ExternalLink className="mr-1.5 h-4 w-4" /> Ver post no Instagram</Button>
                </a>
              )}
              {receipt.status === "published" && receipt.permalink && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `Olá! A publicação foi feita no Instagram 🎉\nConfira aqui: ${receipt.permalink}`,
                    );
                    toast.success("Mensagem copiada!");
                  }}
                >
                  <Copy className="mr-1.5 h-4 w-4" /> Copiar mensagem para o cliente
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog de agendamento */}
      <Dialog open={!!scheduling} onOpenChange={(v) => { if (!v) setScheduling(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Agendar publicação</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {scheduling && !scheduling.caption?.trim() && (
              <p className="flex items-center gap-1 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" /> Este post está sem legenda. Você pode agendar mesmo assim.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Data</Label>
                <Input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hora</Label>
                <Input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
              </div>
            </div>
            <Button className="w-full" disabled={schedule.isPending} onClick={() => schedule.mutate()}>
              {schedule.isPending ? "Agendando…" : "Confirmar agendamento"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
