import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Zap, CheckCircle2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { formatBRL, formatDateBR, monthsBetween, todayISO } from "@/lib/format";
import { gerarCobranca } from "@/lib/asaas";
import { gerarMensalidadesClientes } from "@/lib/cobrancas.functions";
import {
  clientesSemFicha,
  listarClientes,
  removerFichaFinanceira,
  salvarFichaFinanceira,
  type Cliente,
} from "@/lib/clientes";

export const Route = createFileRoute("/_authenticated/clientes")({
  head: () => ({ meta: [{ title: "Clientes — FEMO FINANÇAS" }] }),
  component: () => (
    <Suspense fallback={<PageContainer>Carregando…</PageContainer>}>
      <Clientes />
    </Suspense>
  ),
});



function Clientes() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "Ativo" | "Churn">("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Cliente | null>(null);

  const { data: clientes } = useSuspenseQuery({
    queryKey: ["clientes"],
    queryFn: listarClientes,
  });

  const { data: cobrancasAtivas } = useSuspenseQuery({
    queryKey: ["clientes-cobrancas-asaas"],
    queryFn: async () => {
      const { data } = await supabase
        .from("lancamentos_financeiros")
        .select("client_id,id_cobranca_asaas")
        .not("id_cobranca_asaas", "is", null);
      const set = new Set<string>();
      (data ?? []).forEach((r) => { if (r.client_id) set.add(r.client_id); });
      return set;
    },
  });

  const gerarMensalidadesFn = useServerFn(gerarMensalidadesClientes);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [gerandoMensalidades, setGerandoMensalidades] = useState(false);
  const handleGerar = async (clienteId: string, nome: string) => {
    setPending((p) => ({ ...p, [clienteId]: true }));
    try {
      const res = await gerarCobranca({ clienteId });
      toast.success(`Cobrança gerada para ${nome}`, { description: res.link_boleto ?? undefined });
      qc.invalidateQueries({ queryKey: ["clientes-cobrancas-asaas"] });
      qc.invalidateQueries({ queryKey: ["fluxo"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending((p) => ({ ...p, [clienteId]: false }));
    }
  };

  const del = useMutation({
    mutationFn: removerFichaFinanceira,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["clientes"] }); toast.success("Dados financeiros removidos. O cliente continua no Norteia."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => clientes.filter((c) =>
    (filter === "all" || c.status === filter) &&
    c.nome.toLowerCase().includes(search.toLowerCase())
  ), [clientes, search, filter]);

  return (
    <PageContainer>
      <PageHeader
        title="Clientes"
        subtitle="Carteira, mensalidades e status de churn"
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={gerandoMensalidades}
              title="Gera automaticamente as mensalidades do mês no Contas a Receber. Não envia cobrança para o cliente."
              onClick={async () => {
                setGerandoMensalidades(true);
                try {
                  const res = await gerarMensalidadesFn({ data: { mes: todayISO() } });
                  qc.invalidateQueries({ queryKey: ["fluxo"] });
                  if (res.criadas === 0) {
                    toast.info("Nenhuma mensalidade nova — todas já estavam lançadas neste mês.");
                  } else {
                    toast.success(`${res.criadas} mensalidade(s) lançada(s) em Contas a Receber`, {
                      description: "Quem entrou no meio do mês entrou com valor proporcional.",
                    });
                  }
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setGerandoMensalidades(false);
                }
              }}
            >{gerandoMensalidades ? "Gerando…" : "Gerar cobranças dos clientes"}</Button>
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
              <DialogTrigger asChild>
                <Button onClick={() => setEditing(null)}><Plus className="h-4 w-4 mr-2" />Novo cliente</Button>
              </DialogTrigger>
              <ClienteDialog key={editing?.id ?? "novo"} editing={editing} onClose={() => setOpen(false)} />
            </Dialog>
          </div>
        }
      />

      <div className="flex items-center gap-3 mb-4">
        <Input placeholder="Buscar por nome…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={filter} onValueChange={(v: typeof filter) => setFilter(v)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="Ativo">Ativos</SelectItem>
            <SelectItem value="Churn">Churn</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border bg-surface overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Entrada</TableHead>
              <TableHead>Tempo de casa</TableHead>
              <TableHead className="text-center">Vencimento</TableHead>
              <TableHead className="text-right">Mensalidade</TableHead>
              <TableHead>Cobrança</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-12">Nenhum cliente encontrado.</TableCell></TableRow>
            )}
            {filtered.map((c) => {
              const hasCobranca = cobrancasAtivas.has(c.id);
              const isPending = pending[c.id];
              return (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.nome}</TableCell>
                <TableCell>
                  <Badge variant={c.status === "Ativo" ? "default" : "secondary"} className={c.status === "Ativo" ? "bg-success/15 text-success hover:bg-success/15" : "bg-muted text-muted-foreground"}>
                    {c.status}
                  </Badge>
                </TableCell>
                <TableCell className="tabular text-muted-foreground">{formatDateBR(c.data_entrada)}</TableCell>
                <TableCell className="tabular">{monthsBetween(c.data_entrada)} meses</TableCell>
                <TableCell className="text-center tabular">dia {c.dia_vencimento ?? 5}</TableCell>
                <TableCell className="text-right tabular font-medium">{formatBRL(c.valor_mensalidade)}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant={hasCobranca ? "ghost" : "outline"}
                    className={hasCobranca ? "text-success hover:text-success" : ""}
                    disabled={isPending}
                    onClick={() => handleGerar(c.id, c.nome)}
                    title={hasCobranca ? "Cliente já possui cobrança Asaas — gerar nova" : "Gerar boleto/Pix via Asaas"}
                  >
                    {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      : hasCobranca ? <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                      : <Zap className="h-3.5 w-3.5 mr-1.5" />}
                    {hasCobranca ? "Cobrança ativa" : "Gerar Cobrança no Asaas"}
                  </Button>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(c as Cliente); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Remover ${c.nome}?`)) del.mutate(c.id); }}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </PageContainer>
  );
}

function ClienteDialog({ editing, onClose }: { editing: Cliente | null; onClose: () => void }) {
  const qc = useQueryClient();
  // O cliente escolhido. Ao editar, ja e o dono da ficha; ao criar, sai do
  // seletor da carteira do Norteia.
  const [clientId, setClientId] = useState(editing?.id ?? "");
  const [form, setForm] = useState({
    data_entrada: editing?.data_entrada ?? "",
    data_saida: editing?.data_saida ?? "",
    data_aniversario: editing?.data_aniversario ?? "",
    status: editing?.status ?? ("Ativo" as "Ativo" | "Churn"),
    valor_mensalidade: editing?.valor_mensalidade ?? 0,
    is_recorrente: editing?.is_recorrente ?? true,
    pct_social_media: editing?.pct_social_media ?? 0,
    pct_trafego: editing?.pct_trafego ?? 0,
    dia_vencimento: editing?.dia_vencimento ?? 5,
    socios: (editing?.socios ?? []) as string[],
  });
  const [novoSocio, setNovoSocio] = useState("");

  // Só quem ainda não tem ficha: oferecer um cliente já cadastrado deixaria
  // a pessoa sobrescrever a mensalidade de outro sem perceber.
  const {
    data: disponiveis = [],
    error: erroDisponiveis,
    isLoading: carregandoDisponiveis,
  } = useQuery({
    queryKey: ["clientes-sem-ficha"],
    queryFn: clientesSemFicha,
    enabled: !editing,
  });

  const addSocio = () => {
    const n = novoSocio.trim();
    if (!n) return;
    if (form.socios.includes(n)) { setNovoSocio(""); return; }
    setForm({ ...form, socios: [...form.socios, n] });
    setNovoSocio("");
  };
  const removeSocio = (n: string) => setForm({ ...form, socios: form.socios.filter((s) => s !== n) });

  const pctTotal = Number(form.pct_social_media) + Number(form.pct_trafego);
  const valorSM = (Number(form.valor_mensalidade) * Number(form.pct_social_media)) / 100;
  const valorTR = (Number(form.valor_mensalidade) * Number(form.pct_trafego)) / 100;

  const save = useMutation({
    mutationFn: async () => {
      if (pctTotal > 100) throw new Error("A soma dos percentuais (SM + Tráfego) não pode passar de 100%.");
      if (form.dia_vencimento < 1 || form.dia_vencimento > 31) throw new Error("O dia do vencimento deve estar entre 1 e 31.");
      if (!clientId) throw new Error("Escolha o cliente.");
      await salvarFichaFinanceira(clientId, {
        ...form,
        data_saida: form.status === "Ativo" ? null : (form.data_saida || null),
        data_aniversario: form.data_aniversario || null,
        // Carimba quando a situacao mudou: o calculo de churn do mes depende
        // disso, e sem carimbo o cliente parece ter saido no dia da consulta.
        data_status_alterado:
          editing && editing.status !== form.status
            ? new Date().toISOString()
            : (editing?.data_status_alterado ?? null),
        id_cliente_asaas: editing?.id_cliente_asaas ?? null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["fluxo"] });
      toast.success(editing ? "Dados financeiros atualizados" : "Cliente incluído no financeiro");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>{editing ? "Editar cliente" : "Novo cliente"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <div className="space-y-1.5">
          <Label>Cliente</Label>
          {editing ? (
            <Input value={editing.nome} disabled />
          ) : (
            <Select
              value={clientId}
              onValueChange={(id) => {
                setClientId(id);
                // Abre com a data que o Norteia já tem: salvar em branco por
                // cima apagaria o tempo de casa do cliente lá também.
                const escolhido = disponiveis.find((c) => c.id === id);
                setForm((f) => ({ ...f, data_entrada: escolhido?.agency_since ?? "" }));
              }}
            >
              <SelectTrigger><SelectValue placeholder="Escolha um cliente da carteira" /></SelectTrigger>
              <SelectContent>
                {/* Lista vazia tem três causas diferentes, e tratá-las igual
                    manda a pessoa procurar o problema no lugar errado. */}
                {carregandoDisponiveis ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">Carregando…</div>
                ) : erroDisponiveis ? (
                  <div className="px-2 py-1.5 text-xs text-destructive">
                    {(erroDisponiveis as Error).message}
                  </div>
                ) : disponiveis.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Nenhum cliente disponível. Ou todos já estão no financeiro, ou a
                    carteira do Norteia está vazia.
                  </div>
                ) : (
                  disponiveis.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-muted-foreground">
            {editing
              ? "O nome é do cadastro no Norteia."
              : "Cliente novo se cadastra no Norteia; aqui se diz quanto ele paga."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Cliente desde</Label>
            <Input
              type="date"
              max={todayISO()}
              value={form.data_entrada}
              onChange={(e) => setForm({ ...form, data_entrada: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {form.data_entrada
                ? `Tempo de casa: ${monthsBetween(form.data_entrada)} meses.`
                : "Quando o cliente entrou na agência. É daqui que sai o tempo de casa."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v: "Ativo" | "Churn") => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Ativo">Ativo</SelectItem>
                <SelectItem value="Churn">Churn</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {form.status === "Churn" && (
          <div className="space-y-1.5">
            <Label>Data de saída (churn)</Label>
            <Input type="date" value={form.data_saida ?? ""} onChange={(e) => setForm({ ...form, data_saida: e.target.value })} />
            <p className="text-xs text-muted-foreground">Usada para o cálculo de churn e tempo de casa efetivo.</p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Data de aniversário</Label>
          <Input type="date" value={form.data_aniversario ?? ""} onChange={(e) => setForm({ ...form, data_aniversario: e.target.value })} />
          <p className="text-xs text-muted-foreground">Data comemorativa do cliente (opcional).</p>
        </div>

        <div className="rounded-lg border bg-surface-2 p-4 space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sócios / Responsáveis</div>
          <p className="text-xs text-muted-foreground">Adicione um ou mais sócios ligados a este cliente.</p>
          <div className="flex gap-2">
            <Input
              placeholder="Nome do sócio"
              value={novoSocio}
              onChange={(e) => setNovoSocio(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSocio(); } }}
            />
            <Button type="button" variant="outline" onClick={addSocio}>Adicionar</Button>
          </div>
          {form.socios.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {form.socios.map((s) => (
                <Badge key={s} variant="secondary" className="gap-1 pr-1">
                  {s}
                  <button type="button" onClick={() => removeSocio(s)} className="ml-1 rounded hover:bg-muted-foreground/10 p-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Mensalidade (R$)</Label>
            <Input type="number" step="0.01" min="0" required value={form.valor_mensalidade} onChange={(e) => setForm({ ...form, valor_mensalidade: Number(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Dia do vencimento *</Label>
            <Input type="number" min="1" max="31" required value={form.dia_vencimento} onChange={(e) => setForm({ ...form, dia_vencimento: Number(e.target.value) })} placeholder="1 a 31" />
          </div>
          <div className="space-y-1.5">
            <Label>Cobrança recorrente</Label>
            <Select value={form.is_recorrente ? "sim" : "nao"} onValueChange={(v) => setForm({ ...form, is_recorrente: v === "sim" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sim">Sim — todo mês</SelectItem>
                <SelectItem value="nao">Não — avulsa</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-lg border bg-surface-2 p-4 space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fatiamento do faturamento</div>
          <p className="text-xs text-muted-foreground">Líder recebe sobre 100% do faturamento. Social Media e Gestor de Tráfego recebem sobre a fatia abaixo.</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">% Social Media</Label>
              <Input type="number" step="0.01" min="0" max="100" value={form.pct_social_media} onChange={(e) => setForm({ ...form, pct_social_media: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">% Tráfego</Label>
              <Input type="number" step="0.01" min="0" max="100" value={form.pct_trafego} onChange={(e) => setForm({ ...form, pct_trafego: Number(e.target.value) })} />
            </div>
          </div>
          {pctTotal > 100 && <div className="text-xs text-destructive">A soma de SM + Tráfego ({pctTotal}%) ultrapassa 100%.</div>}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
