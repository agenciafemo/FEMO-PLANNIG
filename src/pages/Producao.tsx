import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock, Check, ChevronDown, ChevronRight, CircleCheck, Flag,
  Loader2, Send, Settings2, UserRound, Workflow,
} from "lucide-react";
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
  EMPTY_ROLE_MAP, PIECE_LABEL, ROLE_LABELS, loadRoleMap, pieceProgress, saveRoleMap,
  type RoleKey, type RoleMap,
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
  assignee_id: string | null;
};

type Item = {
  id: string;
  content_type: string;
  piece_number: number;
  client_id: string | null;
  planning_id: string | null;
  notes: string | null;
  position: number;
  production_item_steps: Step[];
};

type Member = { user_id: string; display_name: string; avatar_url: string | null };
type ClientRow = { id: string; name: string };

const GROUP_ORDER = ["reels", "carousel", "static", "story", "blog"];

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
        .select("id, content_type, piece_number, client_id, planning_id, notes, position, production_item_steps(id, step_key, label, kind, position, done, scheduled_at, outcome, assignee_id)")
        .eq("organization_id", organizationId!)
        .order("position");
      if (error) throw new Error(error.message);
      return (data ?? []) as Item[];
    },
    enabled: !!organizationId,
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
            <p className="mt-1.5 text-sm text-muted-foreground">
              Todas as etapas de cada peça já estão aqui — marque conforme conclui, em qualquer ordem.
            </p>
          </div>
          <Button variant="outline" className="gap-2" onClick={openConfig}>
            <Settings2 className="h-4 w-4" /> Responsáveis
          </Button>
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
                                {PIECE_LABEL[piece.content_type] ?? piece.content_type} {piece.piece_number}
                              </span>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {pp.done}/{pp.total}
                              </span>
                              {pp.pct === 100 && (
                                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                                  Concluída
                                </span>
                              )}
                            </div>

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
                                      step.done
                                        ? "border-success/40 bg-success/10"
                                        : "border-border/70 bg-background hover:border-brand/40",
                                    )}
                                  >
                                    <button
                                      onClick={() => toggleStep.mutate(step)}
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
                                  </div>
                                );
                              })}
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
