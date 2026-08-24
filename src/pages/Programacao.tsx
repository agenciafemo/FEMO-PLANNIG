import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { usePersistedState } from "@/hooks/usePersistedState";
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
  Facebook,
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
  canPublishToFacebook,
  type PublishTarget,
  type ScheduledPost,
} from "@/lib/metaScheduleRpc";
import { getClientMetaStatus } from "@/lib/metaRpc";

interface ApprovedPost {
  id: string;
  caption: string | null;
  hashtags: string | null;
  cover_image_url: string | null;
  video_url: string | null;
  content_type: string | null;
  media_urls: unknown;
}

// Extrai as imagens https de um post de carrossel (media_urls é Json no banco).
// Ignora vídeos e links do Drive (a Meta baixa cada image_url direto).
function carouselImageUrls(post: ApprovedPost): string[] {
  const raw = Array.isArray(post.media_urls) ? post.media_urls : [];
  return raw.filter(
    (u): u is string =>
      typeof u === "string" &&
      /^https:\/\//.test(u) &&
      !u.includes("drive.google.com") &&
      !/\.(mp4|mov|webm|avi|mkv|m4v|ogv)(\?|$)/i.test(u),
  );
}

// A legenda publicada no Instagram = legenda + hashtags (que ficam num campo
// separado no editor). Sem isso, o post sai sem as #.
function buildCaption(post: { caption: string | null; hashtags: string | null }): string {
  return [post.caption?.trim(), post.hashtags?.trim()].filter(Boolean).join("\n\n");
}

/**
 * Monta o payload de publicação a partir do post, conforme o tipo.
 * Reels exige um arquivo de vídeo DIRETO e público (a Meta baixa a URL);
 * link do Drive não serve — bloqueia com mensagem clara.
 */
const REDE_LABEL: Record<PublishTarget, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
};

type FalhaDestino = { target: PublishTarget; msg: string };

/**
 * Enfileira um item por destino e NUNCA aborta no primeiro erro. Cada destino e
 * uma publicacao independente: se o Facebook falhar, o Instagram ja enfileirado
 * vai publicar do mesmo jeito. Abortar cedo e reportar erro total faria a
 * pessoa tentar de novo e duplicar o que deu certo.
 */
async function enfileirarDestinos(
  destinos: PublishTarget[],
  criar: (target: PublishTarget) => Promise<unknown>,
): Promise<{ criados: PublishTarget[]; falhas: FalhaDestino[] }> {
  const criados: PublishTarget[] = [];
  const falhas: FalhaDestino[] = [];
  for (const target of destinos) {
    try {
      await criar(target);
      criados.push(target);
    } catch (e) {
      falhas.push({ target, msg: (e as Error).message });
    }
  }
  return { criados, falhas };
}

function resumoFalhas(falhas: FalhaDestino[]): string {
  return falhas.map((f) => `${REDE_LABEL[f.target]}: ${f.msg}`).join(" · ");
}

/** Mensagem honesta do que foi e do que nao foi. */
function resumoEnfileiramento(
  criados: PublishTarget[],
  falhas: FalhaDestino[],
  verbo: string,
): string {
  const ok = criados.map((t) => REDE_LABEL[t]).join(" e ");
  if (!falhas.length) return `${verbo} ${ok ? `(${ok})` : ""}`.trim();
  return `${verbo} em ${ok}, mas falhou em ${resumoFalhas(falhas)}`;
}

function buildScheduleInput(post: ApprovedPost) {
  if (post.content_type === "reels") {
    const v = post.video_url ?? "";
    const isDirectVideo = /\.(mp4|mov|m4v)(\?|$)/i.test(v) && !v.includes("drive.google.com");
    if (!isDirectVideo) {
      throw new Error(
        "Reels sem vídeo válido. Abra o post e faça upload do arquivo (mp4/mov) — link do Google Drive não pode ser publicado.",
      );
    }
    return {
      mediaType: "reels" as const,
      videoUrl: v,
      coverUrl: post.cover_image_url ?? undefined,
    };
  }
  if (post.content_type === "carousel") {
    const imgs = carouselImageUrls(post);
    if (imgs.length < 2) {
      throw new Error(
        "Carrossel precisa de pelo menos 2 imagens https. Abra o post e adicione as imagens do carrossel.",
      );
    }
    return { mediaType: "carousel" as const, childrenUrls: imgs.slice(0, 10) };
  }
  if (post.content_type === "story") {
    // Story pode ser vídeo (usa o arquivo direto) ou imagem (usa a capa).
    const v = post.video_url ?? "";
    const isDirectVideo = /\.(mp4|mov|m4v)(\?|$)/i.test(v) && !v.includes("drive.google.com");
    if (isDirectVideo) {
      return { mediaType: "story" as const, videoUrl: v };
    }
    if (post.cover_image_url) {
      return { mediaType: "story" as const, imageUrl: post.cover_image_url };
    }
    throw new Error(
      "Story sem mídia válida. Adicione uma imagem de capa ou faça upload de um vídeo (mp4/mov) — link do Google Drive não pode ser publicado.",
    );
  }
  if (!post.cover_image_url) throw new Error("Post sem imagem de capa.");
  return { mediaType: "image" as const, imageUrl: post.cover_image_url };
}

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

// Sugestão de horário ao abrir o agendamento: próxima hora cheia a partir de
// agora. Evita cair no passado quando já passou do meio-dia (default antigo).
function defaultScheduleSlot(): { date: string; time: string } {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  return { date: format(d, "yyyy-MM-dd"), time: format(d, "HH:mm") };
}

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

  // Posts "escondidos" da fila (ex.: já postados manualmente em meses anteriores).
  // Guardado por navegador (localStorage); não apaga o post — só some da fila.
  const [dismissed, setDismissed] = usePersistedState<string[]>("prog-dismissed", []);

  const { data: statusRows } = useQuery({
    queryKey: ["prog-conn", clientId],
    queryFn: () => getClientMetaStatus(clientId),
    enabled: !!clientId,
  });
  const activeRow = statusRows?.find((r) => r.connection_status === "active") ?? null;
  const connectionId = activeRow?.connection_id ?? null;
  // A Pagina so aceita publicacao com pages_manage_posts no token. Sem esse
  // escopo a Meta recusa, entao nem oferecemos o destino — e explicamos por que.
  const facebookLiberado = canPublishToFacebook(activeRow?.granted_scopes);
  const [targets, setTargets] = usePersistedState<PublishTarget[]>(
    "programacao-destinos", ["instagram"],
  );
  // Sem permissao, Facebook nunca entra na lista efetiva.
  const destinos: PublishTarget[] = facebookLiberado
    ? (targets.length ? targets : ["instagram"])
    : ["instagram"];

  const { data: approved } = useQuery({
    queryKey: ["prog-approved", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("posts")
        .select("id, caption, hashtags, cover_image_url, video_url, content_type, media_urls, plannings!inner(client_id)") as any)
        .eq("status", "approved")
        .eq("plannings.client_id", clientId);
      if (error) throw error;
      return ((data ?? []) as ApprovedPost[]).filter(
        (p) =>
          p.cover_image_url ||
          (p.content_type === "reels" && p.video_url) ||
          (p.content_type === "story" && p.video_url) ||
          (p.content_type === "carousel" && carouselImageUrls(p).length >= 2),
      );
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
  const dismissedSet = new Set(dismissed);
  const backlog = (approved ?? []).filter((p) => !scheduledIds.has(p.id) && !dismissedSet.has(p.id));
  // Quantos posts DESTE cliente estão ocultos (para oferecer "reexibir").
  const clientApprovedIds = new Set((approved ?? []).map((p) => p.id));
  const hiddenCount = (approved ?? []).filter(
    (p) => !scheduledIds.has(p.id) && dismissedSet.has(p.id),
  ).length;

  const weekStart = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["prog-scheduled"] });
    queryClient.invalidateQueries({ queryKey: ["prog-approved"] });
  };

  const publishNow = useMutation({
    mutationFn: async (post: ApprovedPost) => {
      if (!connectionId) throw new Error("Cliente sem conta conectada");
      // Uma linha da fila por destino. Se um destino falhar, o outro JA foi
      // enfileirado e vai publicar — reportar erro total faria a pessoa clicar
      // de novo e duplicar o que ja deu certo.
      const { criados, falhas } = await enfileirarDestinos(destinos, (target) =>
        createScheduledPost({
          clientId,
          connectionId,
          ...buildScheduleInput(post),
          caption: buildCaption(post),
          postId: post.id,
          target,
        }));
      if (!criados.length) throw new Error(resumoFalhas(falhas));
      const res = await runPublishWorker();
      return { ...res, criados, falhas };
    },
    onSuccess: (res) => {
      // Diz a rede certa, e avisa quando so uma parte deu certo.
      const base = res.published > 0 ? "Publicado" : "Enviado — processando";
      const msg = resumoEnfileiramento(res.criados, res.falhas, base);
      if (res.falhas.length) toast.warning(msg); else toast.success(msg);
      invalidate();
    },
    onError: (e: unknown) => toast.error("Erro ao publicar: " + (e as Error).message),
  });

  const schedule = useMutation({
    mutationFn: async () => {
      if (!connectionId || !scheduling) throw new Error("Cliente sem conta conectada");
      const when = new Date(`${scheduleDate}T${scheduleTime}:00`);
      if (isNaN(when.getTime())) throw new Error("Data/hora inválida");
      // Reforço: não deixa agendar no passado (publicaria na hora ou falharia).
      if (when.getTime() <= Date.now() + 60 * 1000) {
        throw new Error("Escolha uma data e hora no futuro.");
      }
      const { criados, falhas } = await enfileirarDestinos(destinos, (target) =>
        createScheduledPost({
          clientId,
          connectionId,
          ...buildScheduleInput(scheduling),
          caption: buildCaption(scheduling),
          scheduledFor: when.toISOString(),
          postId: scheduling.id,
          target,
        }));
      if (!criados.length) throw new Error(resumoFalhas(falhas));
      return { criados, falhas };
    },
    onSuccess: (res) => {
      toast.success(resumoEnfileiramento(res.criados, res.falhas, "Post agendado"));
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
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber-600">
            <Clock className="h-4 w-4" /> A programar — {backlog.length} {backlog.length === 1 ? "post aprovado" : "posts aprovados"}
          </p>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setDismissed(dismissed.filter((id) => !clientApprovedIds.has(id)))}
              className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Reexibir {hiddenCount} oculto{hiddenCount === 1 ? "" : "s"}
            </button>
          )}
        </div>
        {backlog.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">Nenhum post aprovado com imagem para programar.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {backlog.map((post) => (
              <div key={post.id} className="relative w-40 shrink-0 rounded-xl border border-border bg-card p-2">
                <button
                  type="button"
                  onClick={() => setDismissed([...dismissed, post.id])}
                  title="Remover da fila (ex.: já postado). Não apaga o post."
                  aria-label="Remover da fila"
                  className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-background hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <div className="mb-2 h-24 w-full overflow-hidden rounded-lg bg-muted">
                  {post.cover_image_url && <img src={post.cover_image_url} alt="" className="h-full w-full object-cover" />}
                </div>
                {!post.caption?.trim() && (
                  <p className="mb-1 flex items-center gap-1 text-[10px] text-amber-600"><AlertTriangle className="h-3 w-3" /> sem legenda</p>
                )}
                <div className="flex flex-col gap-1">
                  <Button size="sm" className="h-7 w-full min-w-0 justify-center px-2 text-[11px]" disabled={!connectionId || publishNow.isPending}
                    onClick={() => publishNow.mutate(post)}>
                    {publishNow.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Send className="mr-1 h-3 w-3 shrink-0" /> Publicar agora</>}
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 w-full min-w-0 justify-center px-2 text-[11px]" disabled={!connectionId}
                    onClick={() => { const slot = defaultScheduleSlot(); setScheduling(post); setScheduleDate(slot.date); setScheduleTime(slot.time); }}>
                    <CalendarClock className="mr-1 h-3 w-3 shrink-0" /> Agendar
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
          const isPast = format(day, "yyyy-MM-dd") < format(new Date(), "yyyy-MM-dd");
          return (
            <div key={day.toISOString()} className={`min-h-28 rounded-lg border p-1.5 ${isToday ? "border-brand/40" : "border-border"} ${isPast ? "bg-muted/20 opacity-60" : ""}`}>
              <div className="flex flex-col gap-1.5">
                {items.map((it) => {
                  const chip = statusChip(it.status);
                  return (
                    <div key={it.id} className="flex items-start gap-1.5 rounded-md bg-muted/60 p-1.5">
                      {(it.image_url || it.cover_url) && (
                        <img src={it.image_url ?? it.cover_url ?? undefined} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${chip.cls}`}>{chip.label}</span>
                          <span className="text-[9px] text-muted-foreground">{format(new Date(it.scheduled_for), "HH:mm")}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
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
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Destino da publicacao */}
      {connectionId && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-medium">Onde publicar</p>
          <div className="flex flex-wrap items-center gap-2">
            {([
              { key: "instagram" as const, label: "Instagram", Icon: Instagram },
              { key: "facebook" as const, label: "Facebook", Icon: Facebook },
            ]).map(({ key, label, Icon }) => {
              const bloqueado = key === "facebook" && !facebookLiberado;
              const marcado = destinos.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  disabled={bloqueado}
                  title={bloqueado
                    ? "Esta conexao nao tem permissao para publicar na Pagina"
                    : undefined}
                  onClick={() => setTargets(
                    // Nunca deixa ficar sem nenhum destino.
                    marcado
                      ? (destinos.length > 1 ? destinos.filter((t) => t !== key) : destinos)
                      : [...destinos, key],
                  )}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    bloqueado
                      ? "cursor-not-allowed border-border text-muted-foreground opacity-50"
                      : marcado
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              );
            })}
          </div>
          {!facebookLiberado && (
            <p className="mt-2 text-xs text-muted-foreground">
              Para publicar na Pagina, este cliente precisa reconectar concedendo a
              permissao de publicacao. Ate la, so o Instagram fica disponivel.
            </p>
          )}
          {destinos.length > 1 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Cada destino vira um item separado na fila — se um falhar, o outro segue.
            </p>
          )}
        </div>
      )}

      {/* Comprovante (recibo) do agendamento */}
      <Dialog open={!!receipt} onOpenChange={(v) => { if (!v) setReceipt(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Comprovante do agendamento</DialogTitle></DialogHeader>
          {receipt && (
            <div className="space-y-3 text-sm">
              <div className="h-40 w-full overflow-hidden rounded-lg bg-muted">
                <img src={receipt.image_url ?? receipt.cover_url ?? undefined} alt="" className="h-full w-full object-cover" />
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
                <Input type="date" min={format(new Date(), "yyyy-MM-dd")} value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
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
