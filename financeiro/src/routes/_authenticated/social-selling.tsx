import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Suspense, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer, PageHeader, StatCard } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Pencil, Trash2, Clock } from "lucide-react";
import { toast } from "sonner";
import { MetaReversa } from "@/components/meta-reversa";

export const Route = createFileRoute("/_authenticated/social-selling")({
  head: () => ({
    meta: [
      { title: "Social Selling & CRM — FEMO FINANÇAS" },
      { name: "description", content: "Funil de 8 etapas, CRM de leads e checklist diário de prospecção B2B." },
      { property: "og:title", content: "Social Selling & CRM — FEMO FINANÇAS" },
      { property: "og:description", content: "Funil de 8 etapas, CRM de leads e checklist diário de prospecção B2B." },
    ],
  }),
  component: () => (
    <Suspense fallback={<PageContainer><div className="text-sm text-muted-foreground">Carregando…</div></PageContainer>}>
      <SocialSelling />
    </Suspense>
  ),
});

const STAGES = [
  "1. Qualificação",
  "2. Engajamento Ativo",
  "3. Prospecção (DM)",
  "4. Qualificação de Dor",
  "5. Pitch de Solução",
  "6. Reunião de Vendas",
  "7. Indicações",
  "8. Prospecção Passiva",
];

type Lead = {
  id: string;
  lead_name: string;
  clinic_name: string | null;
  phone: string | null;
  instagram: string | null;
  cdp_validated: string;
  current_stage: number;
  last_action: string | null;
  pain_identified: string | null;
  response_status: string;
  meeting_date: string | null;
  referrals_count: number;
  general_notes: string | null;
};

type Item = {
  id: string;
  start_time: string;
  end_time: string;
  activity: string;
  meta: string | null;
  completed: boolean;
  ordem: number;
};

const emptyLead = (): Partial<Lead> => ({
  lead_name: "",
  clinic_name: "",
  phone: "",
  instagram: "",
  cdp_validated: "Pendente",
  current_stage: 1,
  last_action: "",
  pain_identified: "",
  response_status: "Talvez",
  referrals_count: 0,
  general_notes: "",
});

function badgeTone(v: string) {
  if (v === "Sim") return "bg-success/15 text-success border-success/30";
  if (v === "Não") return "bg-destructive/15 text-destructive border-destructive/30";
  return "bg-warning/15 text-warning border-warning/30";
}

function SocialSelling() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Lead> | null>(null);

  const { data: leads } = useSuspenseQuery({
    queryKey: ["crm_leads"],
    queryFn: async () => {
      const { data, error } = await supabase.from("crm_leads").select("*").order("lead_name");
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
  });

  const { data: checklist } = useSuspenseQuery({
    queryKey: ["checklist_prospeccao"],
    queryFn: async () => {
      const { data, error } = await supabase.from("checklist_prospeccao").select("*").order("ordem");
      if (error) throw error;
      return (data ?? []) as Item[];
    },
  });

  const saveLead = useMutation({
    mutationFn: async (l: Partial<Lead>) => {
      const payload = {
        lead_name: l.lead_name ?? "",
        clinic_name: l.clinic_name || null,
        phone: l.phone || null,
        instagram: l.instagram || null,
        cdp_validated: l.cdp_validated ?? "Pendente",
        current_stage: Number(l.current_stage ?? 1),
        last_action: l.last_action || null,
        pain_identified: l.pain_identified || null,
        response_status: l.response_status ?? "Talvez",
        meeting_date: l.meeting_date ? new Date(l.meeting_date).toISOString() : null,
        referrals_count: Number(l.referrals_count ?? 0),
        general_notes: l.general_notes || null,
      };
      if (l.id) {
        const { error } = await supabase.from("crm_leads").update(payload).eq("id", l.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("crm_leads").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm_leads"] });
      setEditing(null);
      toast.success("Lead salvo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delLead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("crm_leads").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm_leads"] });
      toast.success("Lead removido");
    },
  });

  const moveStage = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: number }) => {
      const { error } = await supabase.from("crm_leads").update({ current_stage: stage }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm_leads"] }),
  });

  const saveItem = useMutation({
    mutationFn: async (i: Partial<Item> & { id: string }) => {
      const { id, ...rest } = i;
      const { error } = await supabase.from("checklist_prospeccao").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["checklist_prospeccao"] }),
  });

  const addItem = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("checklist_prospeccao").insert({
        start_time: "09:00",
        end_time: "09:30",
        activity: "Nova atividade",
        meta: "",
        ordem: (checklist.at(-1)?.ordem ?? 0) + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["checklist_prospeccao"] }),
  });

  const delItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("checklist_prospeccao").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["checklist_prospeccao"] }),
  });

  const metrics = useMemo(() => {
    const total = leads.length;
    const responderam = leads.filter((l) => l.response_status === "Sim").length;
    const reunioes = leads.filter((l) => l.current_stage >= 6).length;
    const indicacoes = leads.reduce((s, l) => s + (l.referrals_count ?? 0), 0);
    const done = checklist.filter((c) => c.completed).length;
    return { total, responderam, reunioes, indicacoes, done, taxa: total ? (responderam / total) * 100 : 0 };
  }, [leads, checklist]);

  return (
    <PageContainer>
      <PageHeader
        title="Social Selling B2B"
        subtitle="Funil de 8 etapas, CRM integrado e rotina diária de prospecção"
        action={
          <Button onClick={() => setEditing(emptyLead())}>
            <Plus className="mr-2 h-4 w-4" /> Novo Lead
          </Button>
        }
      />

      <Tabs defaultValue="kanban">
        <TabsList>
          <TabsTrigger value="kanban">Kanban Funil</TabsTrigger>
          <TabsTrigger value="crm">Tabela CRM</TabsTrigger>
          <TabsTrigger value="checklist">Checklist Diário</TabsTrigger>
          <TabsTrigger value="metrics">Métricas de Saúde</TabsTrigger>
          <TabsTrigger value="meta">Engenharia Reversa</TabsTrigger>
        </TabsList>

        {/* KANBAN */}
        <TabsContent value="kanban" className="mt-6">
          <ScrollArea className="w-full pb-4">
            <div className="flex gap-4">
              {STAGES.map((name, idx) => {
                const stage = idx + 1;
                const items = leads.filter((l) => l.current_stage === stage);
                return (
                  <div key={name} className="w-64 shrink-0 rounded-xl border bg-surface p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{name}</h3>
                      <Badge variant="secondary">{items.length}</Badge>
                    </div>
                    <div className="mt-3 space-y-2">
                      {items.length === 0 && (
                        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                          Nenhum lead
                        </p>
                      )}
                      {items.map((l) => (
                        <div key={l.id} className="rounded-lg border bg-background p-3">
                          <button className="text-left text-sm font-medium hover:underline" onClick={() => setEditing(l)}>
                            {l.lead_name}
                          </button>
                          <p className="mt-0.5 text-xs text-muted-foreground">{l.clinic_name}</p>
                          <div className="mt-2 flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              disabled={stage === 1}
                              onClick={() => moveStage.mutate({ id: l.id, stage: stage - 1 })}
                            >
                              ←
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              disabled={stage === 8}
                              onClick={() => moveStage.mutate({ id: l.id, stage: stage + 1 })}
                            >
                              →
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* CRM */}
        <TabsContent value="crm" className="mt-6">
          <div className="overflow-x-auto rounded-xl border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Sócio / Lead</th>
                  <th className="px-4 py-3 text-left">Clínica</th>
                  <th className="px-4 py-3 text-left">WhatsApp</th>
                  <th className="px-4 py-3 text-left">Instagram</th>
                  <th className="px-4 py-3 text-left">CDP</th>
                  <th className="px-4 py-3 text-left">Etapa</th>
                  <th className="px-4 py-3 text-left">Resposta</th>
                  <th className="px-4 py-3 text-left">Última ação</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{l.lead_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{l.clinic_name}</td>
                    <td className="px-4 py-3 tabular">{l.phone}</td>
                    <td className="px-4 py-3 text-muted-foreground">{l.instagram}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${badgeTone(l.cdp_validated)}`}>{l.cdp_validated}</span>
                    </td>
                    <td className="px-4 py-3 text-xs">{STAGES[l.current_stage - 1]}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${badgeTone(l.response_status)}`}>{l.response_status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{l.last_action}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setEditing(l)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => delLead.mutate(l.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {leads.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      Nenhum lead cadastrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* CHECKLIST */}
        <TabsContent value="checklist" className="mt-6">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold">Checklist diário de prospecção</h2>
              <p className="text-sm text-muted-foreground">Edite horários, atividades e metas conforme sua agenda do dia.</p>
            </div>
            <Button variant="outline" onClick={() => addItem.mutate()}>
              <Plus className="mr-2 h-4 w-4" /> Bloco
            </Button>
          </div>
          <div className="space-y-2">
            {checklist.map((item) => (
              <div
                key={item.id}
                className={`flex flex-wrap items-center gap-3 rounded-xl border bg-surface p-3 ${item.completed ? "opacity-60" : ""}`}
              >
                <Checkbox
                  checked={item.completed}
                  onCheckedChange={(v) => saveItem.mutate({ id: item.id, completed: Boolean(v) })}
                />
                <Clock className="h-4 w-4 text-muted-foreground" />
                <Input
                  type="time"
                  value={item.start_time}
                  className="w-[110px] tabular"
                  onChange={(e) => saveItem.mutate({ id: item.id, start_time: e.target.value })}
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="time"
                  value={item.end_time}
                  className="w-[110px] tabular"
                  onChange={(e) => saveItem.mutate({ id: item.id, end_time: e.target.value })}
                />
                <Input
                  defaultValue={item.activity}
                  className="min-w-[220px] flex-1"
                  onBlur={(e) => e.target.value !== item.activity && saveItem.mutate({ id: item.id, activity: e.target.value })}
                />
                <Input
                  defaultValue={item.meta ?? ""}
                  placeholder="Meta"
                  className="min-w-[180px] flex-1"
                  onBlur={(e) => e.target.value !== (item.meta ?? "") && saveItem.mutate({ id: item.id, meta: e.target.value })}
                />
                <Button size="icon" variant="ghost" onClick={() => delItem.mutate(item.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* MÉTRICAS */}
        <TabsContent value="metrics" className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Leads no funil" value={metrics.total} />
            <StatCard label="Taxa de resposta" value={`${metrics.taxa.toFixed(1)}%`} accent="primary" hint={`${metrics.responderam} responderam`} />
            <StatCard label="Reuniões / propostas" value={metrics.reunioes} accent="success" />
            <StatCard label="Indicações geradas" value={metrics.indicacoes} accent="warning" hint={`Checklist: ${metrics.done}/${checklist.length} concluído`} />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border-l-4 border-l-success border bg-surface p-5">
              <h3 className="text-sm font-semibold text-success">🟢 Status Verde</h3>
              <p className="mt-2 text-xs text-muted-foreground">DMs: 25/dia | Resposta: 10%+ | Reunião a cada 4–5 dias</p>
            </div>
            <div className="rounded-xl border-l-4 border-l-warning border bg-surface p-5">
              <h3 className="text-sm font-semibold text-warning">🟡 Status Amarelo</h3>
              <p className="mt-2 text-xs text-muted-foreground">DMs: 15–20/dia | Resposta: 5–7% | CRM atrasado 2–3 dias</p>
            </div>
            <div className="rounded-xl border-l-4 border-l-destructive border bg-surface p-5">
              <h3 className="text-sm font-semibold text-destructive">🔴 Status Vermelho</h3>
              <p className="mt-2 text-xs text-muted-foreground">DMs: &lt;10/dia | Resposta: &lt;5% | CRM &gt;1 semana sem update</p>
            </div>
          </div>
        </TabsContent>

        {/* ENGENHARIA REVERSA */}
        <TabsContent value="meta" className="mt-6">
          <MetaReversa />
        </TabsContent>
      </Tabs>

      {editing && <LeadDialog key={editing.id ?? "novo"} lead={editing} onClose={() => setEditing(null)} onSave={(l) => saveLead.mutate(l)} />}
    </PageContainer>
  );
}

function LeadDialog({ lead, onClose, onSave }: { lead: Partial<Lead>; onClose: () => void; onSave: (l: Partial<Lead>) => void }) {
  const [form, setForm] = useState<Partial<Lead>>({
    ...lead,
    meeting_date: lead.meeting_date ? lead.meeting_date.slice(0, 16) : "",
  });
  const set = (k: keyof Lead, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lead.id ? "Editar lead" : "Novo lead"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Sócio / Lead</Label>
            <Input value={form.lead_name ?? ""} onChange={(e) => set("lead_name", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Clínica</Label>
            <Input value={form.clinic_name ?? ""} onChange={(e) => set("clinic_name", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>WhatsApp</Label>
            <Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Instagram</Label>
            <Input value={form.instagram ?? ""} onChange={(e) => set("instagram", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>CDP validado?</Label>
            <Select value={form.cdp_validated ?? "Pendente"} onValueChange={(v) => set("cdp_validated", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Sim", "Não", "Pendente"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Status da resposta</Label>
            <Select value={form.response_status ?? "Talvez"} onValueChange={(v) => set("response_status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Sim", "Não", "Talvez"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Etapa atual</Label>
            <Select value={String(form.current_stage ?? 1)} onValueChange={(v) => set("current_stage", Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STAGES.map((s, i) => <SelectItem key={s} value={String(i + 1)}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Data da reunião</Label>
            <Input type="datetime-local" value={form.meeting_date ?? ""} onChange={(e) => set("meeting_date", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Indicações</Label>
            <Input
              type="text"
              inputMode="numeric"
              value={String(form.referrals_count ?? 0)}
              onChange={(e) => set("referrals_count", Number(e.target.value.replace(/\D/g, "")) || 0)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Última ação</Label>
            <Input value={form.last_action ?? ""} onChange={(e) => set("last_action", e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Dor identificada</Label>
            <Textarea rows={2} value={form.pain_identified ?? ""} onChange={(e) => set("pain_identified", e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Notas gerais</Label>
            <Textarea rows={3} value={form.general_notes ?? ""} onChange={(e) => set("general_notes", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onSave(form)} disabled={!form.lead_name?.trim()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
