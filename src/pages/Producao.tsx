import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Lightbulb, Loader2, UserRound, Workflow } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { loadFunctionAssignees } from "@/lib/subtaskTemplates";
import {
  COLUMNS, EMPTY_ROLE_MAP, PIECE_LABEL, ROLE_LABELS, STAGE_META, assigneeForStage,
  loadRoleMap, nextStage, saveRoleMap, type RoleKey, type RoleMap, type Stage,
} from "@/lib/productionPipeline";
import { Settings2 } from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

type Item = {
  id: string;
  content_type: string;
  piece_number: number;
  stage: Stage;
  assignee_id: string | null;
  notes: string | null;
  client_id: string | null;
  clients: { name: string | null } | null;
};

type Member = { user_id: string; display_name: string; avatar_url: string | null };

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("") || "?";
}

export default function Producao() {
  const { user } = useAuth();
  const { organizationId, role } = useOrganization();
  const queryClient = useQueryClient();
  const canEdit = role === "owner" || role === "admin" || role === "manager" || role === "editor";
  const [onlyMine, setOnlyMine] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["production-board", organizationId],
    queryFn: async () => {
      const { data } = await (supabase as AnyClient)
        .from("production_items")
        .select("id, content_type, piece_number, stage, assignee_id, notes, client_id, clients(name)")
        .eq("organization_id", organizationId)
        .order("position", { ascending: true });
      return (data as Item[]) ?? [];
    },
    enabled: !!organizationId,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["prod-members", organizationId],
    queryFn: async () => {
      const { data } = await (supabase as AnyClient).rpc("get_task_assignees", { _organization_id: organizationId });
      return (data as Member[]) ?? [];
    },
    enabled: !!organizationId,
  });
  const membersById = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);

  const advance = useMutation({
    mutationFn: async (item: Item) => {
      const next = nextStage(item.content_type, item.stage);
      if (!next) return;
      let assignee: string | null = null;
      if (next !== "pronto") {
        const [roleMap, resolve] = await Promise.all([
          loadRoleMap(organizationId!),
          loadFunctionAssignees(organizationId!),
        ]);
        assignee = assigneeForStage(next, roleMap, resolve);
      }
      const { error } = await (supabase as AnyClient)
        .from("production_items")
        .update({ stage: next, assignee_id: assignee, updated_by: user!.id })
        .eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["production-board", organizationId] }),
  });

  // Config de responsáveis de produção (quem faz cada papel).
  const roleMapQuery = useQuery({
    queryKey: ["prod-roles", organizationId],
    queryFn: () => loadRoleMap(organizationId!),
    enabled: !!organizationId,
  });
  const [roleDraft, setRoleDraft] = useState<RoleMap>(EMPTY_ROLE_MAP);
  const [cfgOpen, setCfgOpen] = useState(false);
  useEffect(() => { if (roleMapQuery.data) setRoleDraft(roleMapQuery.data); }, [roleMapQuery.data]);
  const saveRoles = useMutation({
    mutationFn: () => saveRoleMap(organizationId!, user!.id, roleDraft),
    onSuccess: () => {
      toast.success("Responsáveis de produção salvos.");
      setCfgOpen(false);
      queryClient.invalidateQueries({ queryKey: ["prod-roles", organizationId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const roleKeys: RoleKey[] = ["design", "writing", "editing", "review"];

  const visible = onlyMine && user ? items.filter((i) => i.assignee_id === user.id) : items;
  const byColumn = (col: string) => visible.filter((i) => STAGE_META[i.stage]?.column === col);

  return (
    <div className="nrt-surface -mx-4 -mt-4 min-h-[calc(100vh-4rem)] px-4 pb-10 pt-6 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-8">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <Workflow className="h-4 w-4" /> Produção
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Quadro de Produção</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Cada peça anda por etapas. Conclua a sua e ela avança pra próxima pessoa.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={onlyMine ? "default" : "outline"}
              className="gap-2"
              onClick={() => setOnlyMine((v) => !v)}
            >
              <UserRound className="h-4 w-4" /> Só as minhas
            </Button>
            {canEdit && (
              <Dialog open={cfgOpen} onOpenChange={setCfgOpen}>
                <DialogTrigger asChild>
                  <Button type="button" size="sm" variant="outline" className="gap-2">
                    <Settings2 className="h-4 w-4" /> Responsáveis
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Responsáveis de produção</DialogTitle>
                  </DialogHeader>
                  <p className="text-xs text-muted-foreground">
                    Quem faz cada papel. Os novos planejamentos usam isso pra atribuir as etapas.
                  </p>
                  <div className="mt-3 space-y-3">
                    {roleKeys.map((rk) => (
                      <div key={rk} className="space-y-1.5">
                        <Label className="text-xs">{ROLE_LABELS[rk]}</Label>
                        <Select
                          value={roleDraft[rk] ?? "none"}
                          onValueChange={(v) => setRoleDraft((d) => ({ ...d, [rk]: v === "none" ? null : v }))}
                        >
                          <SelectTrigger><SelectValue placeholder="Ninguém" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Ninguém</SelectItem>
                            {members.map((mem) => (
                              <SelectItem key={mem.user_id} value={mem.user_id}>{mem.display_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button size="sm" onClick={() => saveRoles.mutate()} disabled={saveRoles.isPending}>
                      {saveRoles.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                      Salvar
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="grid grid-flow-col auto-cols-[minmax(280px,1fr)] gap-4 overflow-x-auto pb-4 xl:grid-flow-row xl:auto-cols-auto xl:grid-cols-4">
            {COLUMNS.map((col) => {
              const colItems = byColumn(col.key);
              return (
                <div key={col.key} className="rounded-2xl border border-border/70 bg-card/40 p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold">{col.label}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{colItems.length}</span>
                  </div>
                  <div className="space-y-2">
                    {colItems.map((item) => {
                      const member = item.assignee_id ? membersById.get(item.assignee_id) : null;
                      const meta = STAGE_META[item.stage];
                      const next = nextStage(item.content_type, item.stage);
                      return (
                        <div key={item.id} className="rounded-xl border border-border/70 bg-card p-3">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium">
                              {PIECE_LABEL[item.content_type] ?? item.content_type} {item.piece_number}
                            </p>
                            <span className="shrink-0 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                              {meta?.label ?? item.stage}
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {item.clients?.name && (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/80">
                                {item.clients.name}
                              </span>
                            )}
                            {member ? (
                              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <Avatar className="h-4 w-4">
                                  <AvatarImage src={member.avatar_url ?? undefined} />
                                  <AvatarFallback className="text-[8px]">{initials(member.display_name)}</AvatarFallback>
                                </Avatar>
                                {member.display_name}
                              </span>
                            ) : (
                              item.stage !== "pronto" && <span className="text-[11px] text-amber-600">sem responsável</span>
                            )}
                          </div>

                          {item.notes && (
                            <p className="mt-2 flex items-start gap-1 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                              <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" /> {item.notes}
                            </p>
                          )}

                          {canEdit && next && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2.5 h-7 w-full gap-1 text-xs"
                              disabled={advance.isPending}
                              onClick={() => advance.mutate(item)}
                            >
                              {advance.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <>Concluir → {STAGE_META[next].label} <ArrowRight className="h-3 w-3" /></>}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                    {colItems.length === 0 && (
                      <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">Vazio</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
