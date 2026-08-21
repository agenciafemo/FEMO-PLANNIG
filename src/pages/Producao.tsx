import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock, Check, ChevronDown, ChevronRight, CircleCheck, ExternalLink, Flag,
  Loader2, Plus, Send, Settings2, UserRound, Workflow, X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { loadFunctionAssignees } from "@/lib/subtaskTemplates";
import {
  EMPTY_ROLE_MAP, PIECE_LABEL, ROLE_LABELS, STEP_KIND_LABELS, assigneeForRole,
  isCustomStep, loadRoleMap, newCustomKey, pieceProgress, reasonsFor, saveRoleMap,
  stepsFor, stepsToReopen,
  type RoleKey, type RoleMap, type StepKind,
} from "@/lib/productionPipeline";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

type Step = {
  id: string;
  step_key: string;
  label: string;
  kind: "check" | "data" | "gate" | "acao";
  position: number;
  done: boolean;
  scheduled_at: string | null;
  outcome: string | null;
  reason_codes: string[] | null;
  reason_note: string | null;
  assignee_id: string | null;
};

type Item = {
  id: string;
  content_type: string;
  piece_number: number;
  title: string | null;
  client_id: string | null;
  planning_id: string | null;
  notes: string | null;
  position: number;
  production_item_steps: Step[];
};

type Member = { user_id: string; display_name: string; avatar_url: string | null };
type ClientRow = { id: string; name: string };

const GROUP_ORDER = ["reels", "carousel", "static", "story", "blog", "extra"];

// Rótulos dos motivos — tanto os internos quanto os que o cliente escolhe no portal.
const REASON_LABELS: Record<string, string> = {
  legenda_video: "Legenda do vídeo", legenda_post: "Legenda do post",
  design: "Erro de design", portugues: "Erro de português", edicao: "Edição",
  pauta: "Pauta / tema", abordagem: "Abordagem", texto: "Texto / escrita",
  legenda: "Erro de legenda", estrategia: "Mudança de estratégia",
  pedido_cliente: "Pedido do cliente",
};

const MONTH_SLUGS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const slugify = (str: string) => str.normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const KIND_ICON = {
  check: CircleCheck,
  data: CalendarClock,
  gate: Flag,
  acao: Send,
} as const;

export default function Producao() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const [selectedClient, setSelectedClient] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [configOpen, setConfigOpen] = useState(false);
  const [roleDraft, setRoleDraft] = useState<RoleMap>(EMPTY_ROLE_MAP);

  const { data: clients = [] } = useQuery({
    queryKey: ["prod-clients", organizationId],
    queryFn: async () => {
      const { data } = await (supabase as AnyClient).from("clients")
        .select("id, name").eq("organization_id", organizationId!).order("name");
      return (data ?? []) as ClientRow[];
    },
    enabled: !!organizationId,
  });

  // Planejamentos, só para montar o link "Abrir no planejamento".
  const { data: plannings = [] } = useQuery({
    queryKey: ["prod-plannings", organizationId],
    queryFn: async () => {
      const { data } = await (supabase as AnyClient).from("plannings")
        .select("id, month, year, client_id").eq("organization_id", organizationId!);
      return (data ?? []) as Array<{ id: string; month: number; year: number; client_id: string }>;
    },
    enabled: !!organizationId,
  });

  const planningHref = (piece: Item): string | null => {
    if (!piece.planning_id) return null;
    const pl = plannings.find((p) => p.id === piece.planning_id);
    const client = clients.find((c) => c.id === piece.client_id);
    if (!pl || !client) return null;
    return `/plannings/${slugify(client.name)}/${MONTH_SLUGS[pl.month - 1]}-${pl.year}`;
  };

  const { data: members = [] } = useQuery({
    queryKey: ["prod-members", organizationId],
    queryFn: async () => {
      const { data } = await (supabase as AnyClient)
        .rpc("get_task_assignees", { _organization_id: organizationId });
      return (data ?? []) as Member[];
    },
    enabled: !!organizationId,
  });
  const memberOf = (id: string | null) => members.find((m) => m.user_id === id);

  // Peças + etapas de toda a organização (o resumo precisa de todos os clientes).
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["production-items", organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase as AnyClient).from("production_items")
        .select("id, content_type, piece_number, title, client_id, planning_id, notes, position, production_item_steps(id, step_key, label, kind, position, done, scheduled_at, outcome, reason_codes, reason_note, assignee_id)")
        .eq("organization_id", organizationId!)
        .order("position");
      if (error) throw new Error(error.message);
      return (data ?? []) as Item[];
    },
    enabled: !!organizationId,
    // O planejamento marca etapas por gatilho no banco, então o quadro precisa
    // buscar de novo ao voltar para a aba (o padrão global não refaz).
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });

  // ---- Resumo por cliente (onde está o gargalo da operação) ----
  const summary = useMemo(() => {
    return clients.map((client) => {
      const own = items.filter((i) => i.client_id === client.id);
      const steps = own.flatMap((i) => i.production_item_steps ?? []);
      const done = steps.filter((s) => s.done).length;
      const pct = steps.length === 0 ? 0 : Math.round((done / steps.length) * 100);
      // Gargalo = etapa com mais peças pendentes.
      const pending = new Map<string, number>();
      for (const s of steps) {
        if (!s.done) pending.set(s.label, (pending.get(s.label) ?? 0) + 1);
      }
      const worst = [...pending.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        client,
        pieces: own.length,
        pct,
        total: steps.length,
        bottleneck: worst ? { label: worst[0], count: worst[1] } : null,
      };
    }).filter((row) => row.pieces > 0);
  }, [clients, items]);

  // Cliente atual: o escolhido, ou o primeiro que tem produção.
  const activeClient = selectedClient || summary[0]?.client.id || "";
  const clientItems = items.filter((i) => i.client_id === activeClient);

  const groups = useMemo(() => {
    return GROUP_ORDER
      .map((ct) => ({ ct, pieces: clientItems.filter((i) => i.content_type === ct) }))
      .filter((g) => g.pieces.length > 0);
  }, [clientItems]);

  // ---- Marcar / desmarcar etapa ----
  const toggleStep = useMutation({
    mutationFn: async (step: Step) => {
      const next = !step.done;
      const patch: Record<string, unknown> = {
        done: next,
        done_by: next ? user!.id : null,
        done_at: next ? new Date().toISOString() : null,
      };
      // Fase 1: aprovar o portão marca "aprovado". O fluxo de reprovação com
      // motivo entra na Fase 2.
      if (step.kind === "gate") patch.outcome = next ? "aprovado" : null;
      const { error } = await (supabase as AnyClient).from("production_item_steps")
        .update(patch).eq("id", step.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["production-items", organizationId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const setCaptacao = useMutation({
    mutationFn: async ({ step, value }: { step: Step; value: string }) => {
      const { error } = await (supabase as AnyClient).from("production_item_steps")
        .update({ scheduled_at: value ? new Date(value).toISOString() : null })
        .eq("id", step.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["production-items", organizationId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Portões: aprovar ou reprovar com motivo ----
  // Reprovar não é só uma etiqueta: ele DEVOLVE o trabalho, desmarcando a etapa
  // que causou o problema e avisando quem precisa refazer.
  const [gate, setGate] = useState<{ item: Item; step: Step } | null>(null);
  const [gateReasons, setGateReasons] = useState<string[]>([]);
  const [gateNote, setGateNote] = useState("");

  const resolveGate = useMutation({
    mutationFn: async (decision: "aprovado" | "reprovado") => {
      if (!gate) return;
      const db = supabase as AnyClient;

      if (decision === "aprovado") {
        const { error } = await db.from("production_item_steps").update({
          done: true, outcome: "aprovado", done_by: user!.id,
          done_at: new Date().toISOString(), reason_codes: null, reason_note: null,
        }).eq("id", gate.step.id);
        if (error) throw new Error(error.message);
        return { reabertas: 0 };
      }

      if (gateReasons.length === 0) throw new Error("Escolha ao menos um motivo.");
      const { error } = await db.from("production_item_steps").update({
        done: false, outcome: "reprovado", done_by: user!.id, done_at: null,
        reason_codes: gateReasons, reason_note: gateNote.trim() || null,
      }).eq("id", gate.step.id);
      if (error) throw new Error(error.message);

      // Reabre as etapas responsáveis pelo motivo apontado.
      const keys = stepsToReopen(gate.item.content_type, gate.step.step_key, gateReasons);
      const alvo = (gate.item.production_item_steps ?? []).filter((s) => keys.includes(s.step_key));
      if (alvo.length === 0) return { reabertas: 0 };

      await db.from("production_item_steps")
        .update({ done: false, done_at: null })
        .in("id", alvo.map((s) => s.id));

      // Avisa quem precisa refazer.
      const motivos = gateReasons
        .map((c) => reasonsFor(gate.step.step_key).find((r) => r.code === c)?.label ?? c)
        .join(", ");
      const cliente = clients.find((c) => c.id === gate.item.client_id)?.name ?? "";
      const notifs = alvo
        .filter((s) => s.assignee_id)
        .map((s) => ({
          organization_id: organizationId!,
          user_id: s.assignee_id,
          title: `↩️ Refazer: ${s.label}`,
          body: `${cliente} · ${motivos}`,
          type: "production_reopen",
          read: false,
        }));
      if (notifs.length > 0) {
        try { await db.from("notifications").insert(notifs); } catch { /* best-effort */ }
      }
      return { reabertas: alvo.length };
    },
    onSuccess: (res) => {
      const n = res?.reabertas ?? 0;
      toast.success(n > 0
        ? `Devolvido: ${n} ${n === 1 ? "etapa reaberta" : "etapas reabertas"} e responsáveis avisados.`
        : "Registrado.");
      setGate(null); setGateReasons([]); setGateNote("");
      queryClient.invalidateQueries({ queryKey: ["production-items", organizationId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Nova produção (peça avulsa ou tarefa extra, para qualquer cliente) ----
  const [novaOpen, setNovaOpen] = useState(false);
  const [nova, setNova] = useState({ clientId: "", tipo: "extra", titulo: "", qtd: "1" });

  const criarProducao = useMutation({
    mutationFn: async () => {
      const clientId = nova.clientId || activeClient;
      if (!clientId) throw new Error("Escolha o cliente.");
      const isExtra = nova.tipo === "extra";
      if (isExtra && !nova.titulo.trim()) throw new Error("Dê um nome à tarefa extra.");
      const qtd = isExtra ? 1 : Math.max(1, Math.min(20, Number(nova.qtd) || 1));

      const roleMap = await loadRoleMap(organizationId!);
      const resolve = await loadFunctionAssignees(organizationId!);
      const db = supabase as AnyClient;

      // Continua a numeração das peças daquele tipo, para o mesmo cliente.
      const usados = items
        .filter((i) => i.client_id === clientId && i.content_type === nova.tipo)
        .map((i) => i.piece_number);
      const base = usados.length ? Math.max(...usados) : 0;

      const rows = Array.from({ length: qtd }, (_, k) => ({
        organization_id: organizationId!,
        client_id: clientId,
        planning_id: null,
        content_type: nova.tipo,
        piece_number: base + k + 1,
        title: isExtra ? nova.titulo.trim() : null,
        stage: stepsFor(nova.tipo)[0]?.key ?? "concluir",
        position: 9000 + base + k,
      }));

      const { data: created, error } = await db.from("production_items")
        .insert(rows).select("id, organization_id, content_type");
      if (error) throw new Error(error.message);

      const steps = ((created ?? []) as Array<{ id: string; organization_id: string; content_type: string }>)
        .flatMap((item) => stepsFor(item.content_type).map((s, index) => ({
          organization_id: item.organization_id,
          item_id: item.id,
          step_key: s.key,
          label: s.label,
          kind: s.kind,
          position: index,
          done: false,
          assignee_id: assigneeForRole(s.role, roleMap, resolve),
        })));
      if (steps.length > 0) {
        const { error: stepErr } = await db.from("production_item_steps").insert(steps);
        if (stepErr) throw new Error(stepErr.message);
      }
      return clientId;
    },
    onSuccess: (clientId) => {
      toast.success("Adicionado à produção.");
      setNovaOpen(false);
      setNova({ clientId: "", tipo: "extra", titulo: "", qtd: "1" });
      setSelectedClient(clientId);
      queryClient.invalidateQueries({ queryKey: ["production-items", organizationId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Acrescentar / remover etapa de uma peça ----
  const [stepOpen, setStepOpen] = useState<Item | null>(null);
  const [novaEtapa, setNovaEtapa] = useState<{ label: string; kind: StepKind; assignee: string }>(
    { label: "", kind: "check", assignee: "none" },
  );

  const addStep = useMutation({
    mutationFn: async () => {
      if (!stepOpen) return;
      if (!novaEtapa.label.trim()) throw new Error("Dê um nome à etapa.");
      const atuais = stepOpen.production_item_steps ?? [];
      const pos = atuais.length ? Math.max(...atuais.map((s) => s.position)) + 1 : 0;
      const { error } = await (supabase as AnyClient).from("production_item_steps").insert({
        organization_id: organizationId!,
        item_id: stepOpen.id,
        step_key: newCustomKey(),
        label: novaEtapa.label.trim(),
        kind: novaEtapa.kind,
        position: pos,
        done: false,
        assignee_id: novaEtapa.assignee === "none" ? null : novaEtapa.assignee,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Etapa acrescentada.");
      setStepOpen(null);
      setNovaEtapa({ label: "", kind: "check", assignee: "none" });
      queryClient.invalidateQueries({ queryKey: ["production-items", organizationId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeStep = useMutation({
    mutationFn: async (step: Step) => {
      const { error } = await (supabase as AnyClient)
        .from("production_item_steps").delete().eq("id", step.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["production-items", organizationId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Config de responsáveis ----
  const openConfig = async () => {
    if (!organizationId) return;
    setRoleDraft(await loadRoleMap(organizationId));
    setConfigOpen(true);
  };

  const saveConfig = useMutation({
    mutationFn: async () => {
      await saveRoleMap(organizationId!, user!.id, roleDraft);
      // Reatribui as etapas ainda não concluídas conforme o novo mapa.
      const resolve = await loadFunctionAssignees(organizationId!);
      void resolve;
    },
    onSuccess: () => {
      toast.success("Responsáveis salvos. Vale para as próximas peças.");
      setConfigOpen(false);
      queryClient.invalidateQueries({ queryKey: ["production-items", organizationId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="nrt-surface -mx-4 -mt-4 min-h-screen px-4 pb-16 pt-6 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-8">
      <div className="mx-auto max-w-[1200px] space-y-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <Workflow className="h-4 w-4" /> Produção
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Quadro de Produção</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
              Todas as etapas de cada peça já estão aqui — marque conforme conclui, em qualquer ordem.
              O que você preenche no planejamento (mídia, vídeo, legenda) e a aprovação do cliente
              marcam sozinhos.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="gap-2" onClick={() => { setNova((n) => ({ ...n, clientId: activeClient })); setNovaOpen(true); }}>
              <Plus className="h-4 w-4" /> Adicionar produção
            </Button>
            <Button variant="outline" className="gap-2" onClick={openConfig}>
              <Settings2 className="h-4 w-4" /> Responsáveis
            </Button>
          </div>
        </div>

        {/* Resumo geral: onde está o gargalo de cada cliente */}
        {summary.length > 0 && (
          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {summary.map((row) => {
              const active = row.client.id === activeClient;
              return (
                <button
                  key={row.client.id}
                  onClick={() => setSelectedClient(row.client.id)}
                  className={cn(
                    "min-w-[190px] shrink-0 rounded-xl border p-3 text-left transition-colors",
                    active ? "border-brand/50 bg-brand-soft/25" : "border-border/70 bg-card/50 hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{row.client.name}</p>
                    <span className={cn("text-xs font-bold tabular-nums", active ? "text-brand" : "text-muted-foreground")}>
                      {row.pct}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${row.pct}%` }} />
                  </div>
                  <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                    {row.bottleneck
                      ? `Travado em ${row.bottleneck.label} (${row.bottleneck.count})`
                      : "Tudo concluído"}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {/* Seletor de cliente */}
        <div className="flex items-center gap-2">
          <Select value={activeClient} onValueChange={setSelectedClient}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Escolha o cliente" /></SelectTrigger>
            <SelectContent>
              {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {clientItems.length} {clientItems.length === 1 ? "peça" : "peças"} em produção
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-2xl border border-border/70 bg-card/50 px-6 py-14 text-center">
            <Workflow className="mx-auto h-7 w-7 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-medium">Nenhuma peça em produção</p>
            <p className="mt-1 text-xs text-muted-foreground">
              As peças aparecem aqui quando um planejamento é criado para este cliente.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => {
              const isOpen = !collapsed[group.ct];
              const allSteps = group.pieces.flatMap((p) => p.production_item_steps ?? []);
              const gp = pieceProgress(allSteps);
              return (
                <div key={group.ct} className="overflow-hidden rounded-2xl border border-border/70 bg-card/60">
                  {/* Cabeçalho do grupo: "Reels (8)" com expandir */}
                  <button
                    onClick={() => setCollapsed((c) => ({ ...c, [group.ct]: isOpen }))}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <span className="font-semibold">{PIECE_LABEL[group.ct] ?? group.ct}</span>
                    <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand">
                      {group.pieces.length}
                    </span>
                    <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">{gp.pct}%</span>
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${gp.pct}%` }} />
                      </span>
                    </span>
                  </button>

                  {isOpen && (
                    <div className="divide-y divide-border/60 border-t border-border/60">
                      {group.pieces.map((piece) => {
                        const steps = [...(piece.production_item_steps ?? [])].sort((a, b) => a.position - b.position);
                        const pp = pieceProgress(steps);
                        return (
                          <div key={piece.id} className="p-4">
                            <div className="mb-2.5 flex items-center gap-2">
                              <span className="text-sm font-medium">
                                {piece.title
                                  ? piece.title
                                  : `${PIECE_LABEL[piece.content_type] ?? piece.content_type} ${piece.piece_number}`}
                              </span>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {pp.done}/{pp.total}
                              </span>
                              {pp.pct === 100 && (
                                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                                  Concluída
                                </span>
                              )}
                              {planningHref(piece) && (
                                <Link
                                  to={planningHref(piece)!}
                                  className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-brand/50 hover:text-brand"
                                >
                                  <ExternalLink className="h-3 w-3" /> Abrir no planejamento
                                </Link>
                              )}
                            </div>

                            {/* Correção pedida pelo cliente */}
                            {(() => {
                              const rep = steps.find((s) => s.outcome === "reprovado");
                              if (!rep) return null;
                              const codes = rep.reason_codes ?? [];
                              return (
                                <div className="mb-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2">
                                  <p className="text-[11px] font-semibold text-destructive">
                                    Correção pedida em “{rep.label}”
                                  </p>
                                  {codes.length > 0 && (
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                                      {codes.map((c) => REASON_LABELS[c] ?? c).join(" · ")}
                                    </p>
                                  )}
                                  {rep.reason_note && (
                                    <p className="mt-1 text-[11px] italic text-foreground/80">“{rep.reason_note}”</p>
                                  )}
                                </div>
                              );
                            })()}

                            {piece.notes && (
                              <p className="mb-2.5 rounded-lg bg-brand-soft/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                                {piece.notes}
                              </p>
                            )}

                            {/* Checklist de etapas */}
                            <div className="flex flex-wrap gap-1.5">
                              {steps.map((step) => {
                                const Icon = KIND_ICON[step.kind] ?? CircleCheck;
                                const who = memberOf(step.assignee_id);
                                return (
                                  <div
                                    key={step.id}
                                    className={cn(
                                      "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors",
                                      step.outcome === "reprovado"
                                        ? "border-destructive/50 bg-destructive/10"
                                        : step.done
                                          ? "border-success/40 bg-success/10"
                                          : "border-border/70 bg-background hover:border-brand/40",
                                    )}
                                  >
                                    <button
                                      onClick={() => {
                                        // Portões abrem a decisão (aprovar / reprovar com motivo).
                                        if (step.kind === "gate") {
                                          setGate({ item: piece, step });
                                          setGateReasons([]); setGateNote("");
                                        } else {
                                          toggleStep.mutate(step);
                                        }
                                      }}
                                      disabled={toggleStep.isPending}
                                      className="flex items-center gap-1.5"
                                      title={who ? `Responsável: ${who.display_name}` : "Sem responsável"}
                                    >
                                      <span className={cn(
                                        "flex h-4 w-4 items-center justify-center rounded border",
                                        step.done ? "border-success bg-success text-white" : "border-muted-foreground/40",
                                      )}>
                                        {step.done && <Check className="h-3 w-3" />}
                                      </span>
                                      <Icon className={cn("h-3.5 w-3.5", step.done ? "text-success" : "text-muted-foreground")} />
                                      <span className={cn("text-xs", step.done && "line-through opacity-70")}>
                                        {step.label}
                                      </span>
                                    </button>

                                    {step.kind === "data" && (
                                      <Input
                                        type="datetime-local"
                                        className="h-6 w-[165px] px-1.5 text-[11px]"
                                        value={step.scheduled_at ? step.scheduled_at.slice(0, 16) : ""}
                                        onChange={(e) => setCaptacao.mutate({ step, value: e.target.value })}
                                      />
                                    )}

                                    {who && (
                                      <Avatar className="h-4 w-4">
                                        {who.avatar_url && <AvatarImage src={who.avatar_url} alt={who.display_name} />}
                                        <AvatarFallback className="bg-brand-soft text-[8px] font-bold text-brand">
                                          {who.display_name.charAt(0).toUpperCase()}
                                        </AvatarFallback>
                                      </Avatar>
                                    )}

                                    {/* Etapas acrescentadas pela equipe podem ser removidas */}
                                    {isCustomStep(step.step_key) && (
                                      <button
                                        onClick={() => removeStep.mutate(step)}
                                        title="Remover esta etapa"
                                        className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}

                              <button
                                onClick={() => { setStepOpen(piece); setNovaEtapa({ label: "", kind: "check", assignee: "none" }); }}
                                className="flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand/50 hover:text-foreground"
                              >
                                <Plus className="h-3.5 w-3.5" /> Etapa
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Portão: aprovar ou reprovar com motivo */}
      <Dialog open={!!gate} onOpenChange={(v) => { if (!v) setGate(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{gate?.step.label}</DialogTitle></DialogHeader>
          {gate && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Ao reprovar, as etapas responsáveis pelo motivo voltam a ficar em aberto
                e quem precisa refazer é avisado.
              </p>

              <div className="space-y-2">
                <Label className="text-xs">Motivo da reprovação</Label>
                <div className="space-y-1">
                  {reasonsFor(gate.step.step_key).map((r) => {
                    const marcado = gateReasons.includes(r.code);
                    return (
                      <button
                        key={r.code}
                        type="button"
                        onClick={() => setGateReasons((prev) =>
                          marcado ? prev.filter((c) => c !== r.code) : [...prev, r.code])}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors",
                          marcado ? "border-destructive/50 bg-destructive/10" : "border-border/70 hover:bg-muted/50",
                        )}
                      >
                        <span className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          marcado ? "border-destructive bg-destructive text-white" : "border-muted-foreground/40",
                        )}>
                          {marcado && <Check className="h-3 w-3" />}
                        </span>
                        <span className="flex-1">{r.label}</span>
                        {r.reopen.length === 0 && (
                          <span className="text-[10px] text-muted-foreground">não é retrabalho</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Observação (opcional)</Label>
                <Input
                  value={gateNote}
                  onChange={(e) => setGateNote(e.target.value)}
                  placeholder="O que precisa mudar"
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setGate(null)}>Cancelar</Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={resolveGate.isPending}
                  onClick={() => resolveGate.mutate("reprovado")}
                >
                  {resolveGate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Reprovar e devolver
                </Button>
                <Button
                  type="button"
                  disabled={resolveGate.isPending}
                  onClick={() => resolveGate.mutate("aprovado")}
                >
                  Aprovar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Adicionar produção: peça avulsa ou tarefa extra, para qualquer cliente */}
      <Dialog open={novaOpen} onOpenChange={setNovaOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Adicionar produção</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); criarProducao.mutate(); }}>
            <div className="space-y-1.5">
              <Label className="text-xs">Cliente</Label>
              <Select value={nova.clientId} onValueChange={(v) => setNova({ ...nova, clientId: v })}>
                <SelectTrigger><SelectValue placeholder="Escolha o cliente" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Funciona para qualquer cliente, mesmo sem planejamento criado.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Tipo</Label>
              <Select value={nova.tipo} onValueChange={(v) => setNova({ ...nova, tipo: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="extra">Tarefa extra</SelectItem>
                  <SelectItem value="reels">Reel</SelectItem>
                  <SelectItem value="carousel">Carrossel</SelectItem>
                  <SelectItem value="static">Post</SelectItem>
                  <SelectItem value="story">Story</SelectItem>
                  <SelectItem value="blog">Blog</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {nova.tipo === "extra" ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Nome da tarefa</Label>
                <Input
                  value={nova.titulo}
                  onChange={(e) => setNova({ ...nova, titulo: e.target.value })}
                  placeholder="Ex.: Gravação institucional"
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground">
                  Nasce com uma etapa. Use “+ Etapa” no quadro para montar o processo dela.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">Quantas peças</Label>
                <Input
                  type="number" min={1} max={20}
                  value={nova.qtd}
                  onChange={(e) => setNova({ ...nova, qtd: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Cada peça já vem com todas as etapas do tipo escolhido.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setNovaOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={criarProducao.isPending}>
                {criarProducao.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Adicionar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Acrescentar etapa a uma peça */}
      <Dialog open={!!stepOpen} onOpenChange={(v) => { if (!v) setStepOpen(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nova etapa</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); addStep.mutate(); }}>
            <div className="space-y-1.5">
              <Label className="text-xs">Nome da etapa</Label>
              <Input
                value={novaEtapa.label}
                onChange={(e) => setNovaEtapa({ ...novaEtapa, label: e.target.value })}
                placeholder="Ex.: Aprovação interna"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo de etapa</Label>
              <Select
                value={novaEtapa.kind}
                onValueChange={(v: StepKind) => setNovaEtapa({ ...novaEtapa, kind: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(STEP_KIND_LABELS) as StepKind[]).map((k) => (
                    <SelectItem key={k} value={k}>{STEP_KIND_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Responsável</Label>
              <Select
                value={novaEtapa.assignee}
                onValueChange={(v) => setNovaEtapa({ ...novaEtapa, assignee: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ninguém</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>{m.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setStepOpen(null)}>Cancelar</Button>
              <Button type="submit" disabled={addStep.isPending}>
                {addStep.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Acrescentar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Responsáveis por função */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Responsáveis da produção</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {(Object.keys(ROLE_LABELS) as RoleKey[]).map((role) => (
              <div key={role} className="space-y-1.5">
                <Label className="text-xs">{ROLE_LABELS[role]}</Label>
                <Select
                  value={roleDraft[role] ?? "none"}
                  onValueChange={(v) => setRoleDraft({ ...roleDraft, [role]: v === "none" ? null : v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <UserRound className="h-3.5 w-3.5" /> Ninguém
                      </span>
                    </SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>{m.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <div className="flex justify-end pt-1">
              <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending}>
                {saveConfig.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
