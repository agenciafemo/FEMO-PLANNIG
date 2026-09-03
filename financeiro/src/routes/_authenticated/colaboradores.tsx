import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useState, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, ChevronRight, ChevronLeft, Printer } from "lucide-react";
import { toast } from "sonner";
import { formatBRL, monthKey, monthsBetween, parseISODate, todayISO } from "@/lib/format";
import { printReport } from "@/lib/print-report";
import { listarClientes } from "@/lib/clientes";
import { carregarConfig } from "@/lib/configuracoes";

export const Route = createFileRoute("/_authenticated/colaboradores")({
  head: () => ({ meta: [{ title: "Colaboradores — FEMO FINANÇAS" }] }),
  component: () => (
    <Suspense fallback={<PageContainer>Carregando…</PageContainer>}>
      <Colaboradores />
    </Suspense>
  ),
});

type Cargo = "Líder" | "Social Media" | "Gestor de Tráfego" | "Outros";
type StatusEntrega = "Entregue no Prazo" | "Entregue com Atraso";
type Colab = { id: string; nome: string; cargo: Cargo; salario_base: number; data_entrada: string; funcao_id: string | null };
type Funcao = { id: string; nome: string; tipo_base: string };
type Cliente = { id: string; nome: string; valor_mensalidade: number; status: string; data_entrada: string; data_saida: string | null; pct_social_media: number; pct_trafego: number };
type Contrato = {
  id: string;
  client_id: string;
  colaborador_id: string;
  valor_base_calculo: number;
  prazo_entrega_planejamentos: number | null;
  status_entrega_mes_atual: StatusEntrega;
};
type LtvRow = { meses_min: number; meses_max: number | null; percentual: number; funcao_id: string | null };
type HistoricoFolha = { id: string; colaborador_id: string; mes_competencia: string; salario_base: number; total_comissoes: number; total_extras: number; total_descontos: number; valor_liquido: number; observacoes: string | null; total_manual?: number | null };

// Tabela progressiva de INSS (desconto do colaborador)
const INSS_FAIXAS: { limite: number; aliquota: number }[] = [
  { limite: 1518.0, aliquota: 0.075 },
  { limite: 2793.88, aliquota: 0.09 },
  { limite: 4190.83, aliquota: 0.12 },
  { limite: 8157.41, aliquota: 0.14 },
];
function calcularINSS(bruto: number) {
  let restante = Math.max(0, bruto);
  let anterior = 0;
  let total = 0;
  for (const f of INSS_FAIXAS) {
    const base = Math.min(restante + anterior, f.limite) - anterior;
    if (base <= 0) break;
    total += base * f.aliquota;
    restante -= base;
    anterior = f.limite;
    if (restante <= 0) break;
  }
  return Math.round(total * 100) / 100;
}

const TIPOS_BONIFICACAO = ["Prêmio produtividade", "Combustível", "Ticket / alimentação", "Bônus de meta", "Outro"] as const;

// ---- Vigência do cliente dentro da competência da folha ----
// Cada mês tem sua própria folha: o cliente só comissiona nos meses em que esteve ativo.
export function mesBounds(mKey: string) {
  const [y, m] = mKey.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${mKey}-01`, end: `${mKey}-${String(last).padStart(2, "0")}`, y, m };
}

export function clienteAtivoNoMes(cli: Cliente, mKey: string): boolean {
  const { start, end } = mesBounds(mKey);
  if (cli.data_entrada && cli.data_entrada > end) return false; // ainda não era cliente
  if (cli.data_saida) return cli.data_saida >= start; // saiu antes do mês → fora da folha
  return cli.status === "Ativo";
}

function mesesDeCasaNoMes(cli: Cliente, mKey: string): number {
  const { y, m } = mesBounds(mKey);
  return monthsBetween(cli.data_entrada, new Date(y, m - 1, 1));
}

// Data de corte do Líder: clientes com data_entrada <= 30/06/2026 entram na regra travada de 1%.
// Clientes que entrarem a partir de Julho/2026 ficam reservados em bloco isolado para regras futuras.
const LIDER_CUTOFF = "2026-06-30";
const LIDER_PCT_ANTIGO = 0.01;

export function isClienteAntigoLider(dataEntrada: string): boolean {
  return dataEntrada <= LIDER_CUTOFF;
}

export function comissaoLiderPorCliente(cli: Cliente, mKey: string): number {
  if (!clienteAtivoNoMes(cli, mKey)) return 0;
  if (isClienteAntigoLider(cli.data_entrada)) {
    return Number(cli.valor_mensalidade) * LIDER_PCT_ANTIGO;
  }
  // Bloco isolado — futuras regras para clientes a partir de Julho/2026.
  return 0;
}

function pctForMeses(rows: LtvRow[], meses: number): number {
  const match = rows
    .filter((r) => r.meses_min <= meses && (r.meses_max === null || r.meses_max >= meses))
    .sort((a, b) => b.meses_min - a.meses_min)[0];
  return match ? Number(match.percentual) : 0;
}

function baseFor(cargo: Cargo, cli: Cliente): number {
  const m = Number(cli.valor_mensalidade);
  if (cargo === "Gestor de Tráfego") return (m * Number(cli.pct_trafego || 0)) / 100;
  if (cargo === "Social Media") return (m * Number(cli.pct_social_media || 0)) / 100;
  return m;
}

export function pctSocialMediaPorMeses(meses: number): number {
  if (meses < 6) return 1;
  if (meses < 18) return 2;
  if (meses < 36) return 3;
  return 4;
}

function commissionFor(colab: Colab, cli: Cliente | undefined, contrato: Contrato, ltv: LtvRow[], pctPenal: number, funcoes: Funcao[], mKey: string): number {
  if (!cli || !clienteAtivoNoMes(cli, mKey)) return 0;
  if (colab.cargo === "Líder" && !colab.funcao_id) return 0; // Líder padrão não comissiona por contrato — ver bloco dedicado.
  const meses = mesesDeCasaNoMes(cli, mKey);

  // Se colaborador tem função personalizada, usa a tabela e base dela.
  if (colab.funcao_id) {
    const func = funcoes.find((f) => f.id === colab.funcao_id);
    if (!func) return 0;
    // Faixas específicas da função; se não houver nenhuma cadastrada, cai no padrão (funcao_id IS NULL)
    // para não zerar a comissão silenciosamente.
    let rowsF = ltv.filter((r) => r.funcao_id === colab.funcao_id);
    if (rowsF.length === 0) rowsF = ltv.filter((r) => r.funcao_id === null);
    const pct = pctForMeses(rowsF, meses);
    if (!pct) return 0;
    const m = Number(cli.valor_mensalidade);
    const base =
      func.tipo_base === "fatia_social_media" ? (m * Number(cli.pct_social_media || 0)) / 100
      : func.tipo_base === "fatia_trafego" ? (m * Number(cli.pct_trafego || 0)) / 100
      : m;
    let val = (base * pct) / 100;
    if (contrato.status_entrega_mes_atual === "Entregue com Atraso") val = val * (1 - pctPenal / 100);
    return val;
  }

  if (colab.cargo === "Social Media") {
    const pct = pctSocialMediaPorMeses(meses);
    let val = (Number(cli.valor_mensalidade) * pct) / 100;
    if (contrato.status_entrega_mes_atual === "Entregue com Atraso") {
      val = val * (1 - pctPenal / 100);
    }
    return val;
  }

  const pct = pctForMeses(ltv.filter((r) => r.funcao_id === null), meses);
  if (!pct) return 0;
  const base = baseFor(colab.cargo, cli);
  return (base * pct) / 100;
}

function Colaboradores() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Colab | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [qtdMeses, setQtdMeses] = useState<number>(3);

  const [mesFolha, setMesFolha] = useState<string>(() => {
    const t = parseISODate(todayISO())!;
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
  });


  const { data } = useSuspenseQuery({
    queryKey: ["colaboradores-all"],
    queryFn: async () => {
      const [colabs, clientes, contratos, lanc, extras, ltv, config, historico, funcoes] = await Promise.all([
        supabase.from("colaboradores").select("*").order("nome"),
        listarClientes(),
        supabase.from("contratos_fatiamento").select("*"),
        supabase.from("lancamentos_financeiros").select("*").eq("tipo", "Saída").not("colaborador_id", "is", null),
        supabase.from("recebimentos_extras").select("*"),
        supabase.from("tabela_progressiva_ltv").select("meses_min,meses_max,percentual,funcao_id"),
        carregarConfig(),
        supabase.from("historico_folha_pagamento").select("*").order("mes_competencia", { ascending: false }),
        supabase.from("funcoes").select("id,nome,tipo_base"),
      ]);
      const pesos = await supabase.from("pesos_comissao_folha").select("colaborador_id,mes_competencia,peso");
      return {
        colabs: (colabs.data ?? []) as Colab[],
        clientes,
        contratos: (contratos.data ?? []) as Contrato[],
        lancamentos: lanc.data ?? [],
        extras: extras.data ?? [],
        ltv: (ltv.data ?? []) as LtvRow[],
        pctPenal: config.pct_penalidade_atraso,
        historico: (historico.data ?? []) as HistoricoFolha[],
        funcoes: (funcoes.data ?? []) as Funcao[],
        pesos: (pesos.data ?? []) as { colaborador_id: string; mes_competencia: string; peso: number }[],
      };
    },
  });

  const pesoDe = (colabId: string, mKey: string) => {
    const row = data.pesos.find((p) => p.colaborador_id === colabId && monthKey(p.mes_competencia) === mKey);
    return row ? Number(row.peso) : 100;
  };

  const manualDe = (colabId: string, mKey: string): number | null => {
    const row = data.historico.find((h) => h.colaborador_id === colabId && monthKey(h.mes_competencia) === mKey);
    return row?.total_manual != null ? Number(row.total_manual) : null;
  };

  const salvarManual = useMutation({
    mutationFn: async ({ colabId, mKey, valor }: { colabId: string; mKey: string; valor: number | null }) => {
      const existente = data.historico.find((h) => h.colaborador_id === colabId && monthKey(h.mes_competencia) === mKey);
      const base = existente ?? buildRows(mKey).find((r) => r.colaborador_id === colabId)!;
      const { error } = await supabase.from("historico_folha_pagamento").upsert(
        {
          colaborador_id: colabId,
          mes_competencia: `${mKey}-01`,
          salario_base: Number(base.salario_base),
          total_comissoes: Number(base.total_comissoes),
          total_extras: Number(base.total_extras),
          total_descontos: Number(base.total_descontos),
          valor_liquido: valor ?? Number(base.valor_liquido),
          total_manual: valor,
        },
        { onConflict: "colaborador_id,mes_competencia" },
      );
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["colaboradores-all"] }); toast.success("Total da folha atualizado"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarPeso = useMutation({
    mutationFn: async ({ colabId, mKey, peso }: { colabId: string; mKey: string; peso: number }) => {
      const { error } = await supabase
        .from("pesos_comissao_folha")
        .upsert({ colaborador_id: colabId, mes_competencia: `${mKey}-01`, peso }, { onConflict: "colaborador_id,mes_competencia" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["colaboradores-all"] }); toast.success("Peso da comissão atualizado"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("colaboradores").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["colaboradores-all"] }); toast.success("Removido"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const curKey = mesFolha;
  const mesCompISO = `${mesFolha}-01`;
  const mesLabel = new Date(mesCompISO + "T00:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  function buildRows(mKey: string) {
    return data.colabs.map((c) => {
      const meusContratos = data.contratos.filter((k) => k.colaborador_id === c.id);
      const comissaoCheia = c.cargo === "Líder"
        ? data.clientes.reduce((s, cli) => s + comissaoLiderPorCliente(cli, mKey), 0)
        : meusContratos.reduce((s, k) => s + commissionFor(c, data.clientes.find((x) => x.id === k.client_id), k, data.ltv, data.pctPenal, data.funcoes, mKey), 0);
      const comissao = (comissaoCheia * pesoDe(c.id, mKey)) / 100;
      const lancsMes = data.lancamentos.filter((l) => l.colaborador_id === c.id && monthKey(l.data_lancamento) === mKey);
      const bonusLancMes = lancsMes.filter((l) => Number(l.valor) > 0).reduce((s, l) => s + Number(l.valor), 0);
      const descontos = -lancsMes.filter((l) => Number(l.valor) < 0).reduce((s, l) => s + Number(l.valor), 0);
      const extrasMes = data.extras.filter((e) => e.colaborador_id === c.id && monthKey(e.data_referencia) === mKey).reduce((s, e) => s + Number(e.valor), 0);
      const bonificacoesMes = extrasMes + bonusLancMes;
      const salarioBase = Number(c.salario_base);
      const bruto = salarioBase + comissao + bonificacoesMes;
      const inss = calcularINSS(bruto);
      const manual = manualDe(c.id, mKey);
      const liquido = manual ?? bruto - descontos - inss;
      return {
        colaborador_id: c.id,
        mes_competencia: `${mKey}-01`,
        salario_base: salarioBase,
        total_comissoes: comissao,
        total_extras: bonificacoesMes,
        total_descontos: descontos + inss,
        valor_liquido: liquido,
        total_manual: manual,
      };
    });
  }

  function addMonths(mKey: string, n: number) {
    const [y, m] = mKey.split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  const fecharFolha = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("historico_folha_pagamento").upsert(buildRows(curKey), { onConflict: "colaborador_id,mes_competencia" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["colaboradores-all"] }); toast.success(`Folha de ${mesLabel} registrada no histórico`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const gerarProximos = useMutation({
    mutationFn: async (qtd: number) => {
      const meses = Array.from({ length: qtd }, (_, i) => addMonths(curKey, i + 1));
      const rows = meses.flatMap((m) => buildRows(m));
      const { error } = await supabase.from("historico_folha_pagamento").upsert(rows, { onConflict: "colaborador_id,mes_competencia" });
      if (error) throw error;
      return meses;
    },
    onSuccess: (meses) => {
      qc.invalidateQueries({ queryKey: ["colaboradores-all"] });
      toast.success(`Folhas geradas para ${meses.length} mês(es): ${meses.join(", ")}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Painel de meses: 3 anteriores → competência → 6 seguintes
  const mesesPainel = Array.from({ length: 10 }, (_, i) => addMonths(curKey, i - 3));
  const totalPorMes = (m: string) => {
    const rows = data.historico.filter((h) => monthKey(h.mes_competencia) === m);
    return { fechada: rows.length > 0, total: rows.reduce((s, r) => s + Number(r.valor_liquido), 0) };
  };
  const previstoMes = (m: string) => buildRows(m).reduce((s, r) => s + r.valor_liquido, 0);
  const labelMes = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
  const mesTitulo = new Date(`${curKey}-01T00:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const imprimirRelatorioEquipe = () => {
    const sections = data.colabs.flatMap((c) => {
      const meusContratos = data.contratos.filter((k) => k.colaborador_id === c.id);
      const extrasMes = data.extras.filter((e) => e.colaborador_id === c.id && monthKey(e.data_referencia) === curKey);
      const bonusLancMes = data.lancamentos.filter((l) => l.colaborador_id === c.id && monthKey(l.data_lancamento) === curKey && Number(l.valor) > 0);
      const peso = pesoDe(c.id, curKey);

      const fatItems =
        c.cargo === "Líder"
          ? data.clientes
              .filter((cli) => clienteAtivoNoMes(cli, curKey) && isClienteAntigoLider(cli.data_entrada))
              .map((cli) => ({ nome: cli.nome, regra: "1% travado (Líder)", mensalidade: Number(cli.valor_mensalidade), comissao: comissaoLiderPorCliente(cli, curKey) }))
          : meusContratos.map((k) => {
              const cli = data.clientes.find((x) => x.id === k.client_id);
              return {
                nome: cli?.nome ?? "—",
                regra: `${k.status_entrega_mes_atual}${k.prazo_entrega_planejamentos ? ` · prazo dia ${k.prazo_entrega_planejamentos}` : ""}`,
                mensalidade: Number(cli?.valor_mensalidade ?? 0),
                comissao: commissionFor(c, cli, k, data.ltv, data.pctPenal, data.funcoes, curKey),
              };
            });
      const fatRows = fatItems.map((f) => [f.nome, f.regra, formatBRL(f.comissao)]);
      const totalFat = fatItems.reduce((s, f) => s + f.comissao, 0);

      const bonItems = [
        ...extrasMes.map((e) => ({ descricao: e.descricao, data: e.data_referencia, valor: Number(e.valor) })),
        ...bonusLancMes.map((l) => ({ descricao: l.descricao ?? "Lançamento", data: l.data_lancamento, valor: Number(l.valor) })),
      ];
      const bonRows = bonItems.map((b) => [b.descricao, new Date(b.data).toLocaleDateString("pt-BR"), formatBRL(b.valor)]);
      const totalBon = bonItems.reduce((s, b) => s + b.valor, 0);


      return [
        {
          title: `${c.nome} — Fatiamento de contratos`,
          subtitle: `${c.cargo} · peso da comissão ${peso}% · comissão aplicada ${formatBRL((totalFat * peso) / 100)}`,
          columns: [{ label: "Cliente" }, { label: "Entrega / regra" }, { label: "Comissão cheia", align: "right" as const }],
          rows: fatRows,
          footer: ["Total", "", formatBRL(totalFat)],
          empty: "Sem contratos fatiados.",
        },
        {
          title: `${c.nome} — Bonificações`,
          columns: [{ label: "Descrição" }, { label: "Data" }, { label: "Valor", align: "right" as const }],
          rows: bonRows,
          footer: ["Total", "", formatBRL(totalBon)],
          empty: "Sem bonificações na competência.",
        },
      ];
    });

    if (!printReport({ title: `Bonificações e fatiamento — ${mesTitulo}`, subtitle: `Competência ${curKey}`, sections })) {
      toast.error("Permita pop-ups para imprimir o relatório.");
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Colaboradores"
        subtitle="Folha, fatiamento de contratos e renda variável por LTV"
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={imprimirRelatorioEquipe}><Printer className="h-4 w-4 mr-2" />Imprimir relatório do mês</Button>
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
              <DialogTrigger asChild>
                <Button onClick={() => setEditing(null)}><Plus className="h-4 w-4 mr-2" />Novo colaborador</Button>
              </DialogTrigger>
              <ColabDialog key={editing?.id ?? "novo"} editing={editing} onClose={() => setOpen(false)} />
            </Dialog>
          </div>
        }
      />


      <div className="rounded-xl border bg-surface p-5 space-y-5 mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end gap-2">
            <Button size="icon" variant="outline" onClick={() => setMesFolha(addMonths(curKey, -1))} aria-label="Mês anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Competência da folha</Label>
              <Input type="month" value={mesFolha} onChange={(e) => setMesFolha(e.target.value)} className="w-40" />
            </div>
            <Button size="icon" variant="outline" onClick={() => setMesFolha(addMonths(curKey, 1))} aria-label="Próximo mês">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => fecharFolha.mutate()} disabled={fecharFolha.isPending}>
              {fecharFolha.isPending ? "Fechando…" : `Fechar folha de ${mesLabel}`}
            </Button>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Gerar folhas dos meses seguintes</Label>
            <div className="flex gap-2">
              <Select value={String(qtdMeses)} onValueChange={(v) => setQtdMeses(Number(v))}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 6, 12].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "mês" : "meses"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => gerarProximos.mutate(qtdMeses)} disabled={gerarProximos.isPending}>
                {gerarProximos.isPending ? "Gerando…" : "Gerar folhas"}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {mesesPainel.map((m) => {
            const { fechada, total } = totalPorMes(m);
            const valor = fechada ? total : previstoMes(m);
            const ativo = m === curKey;
            return (
              <button
                key={m}
                onClick={() => setMesFolha(m)}
                className={`shrink-0 min-w-[130px] text-left rounded-lg border px-3 py-2 transition-colors ${ativo ? "border-primary bg-primary/5" : "hover:bg-muted/60"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium capitalize">{labelMes(m)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${fechada ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
                    {fechada ? "fechada" : "prevista"}
                  </span>
                </div>
                <div className="text-sm tabular font-semibold mt-1">{formatBRL(valor)}</div>
              </button>
            );
          })}
        </div>
      </div>





      <div className="rounded-xl border bg-surface overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead></TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead className="text-right">Salário base</TableHead>
              <TableHead className="text-center">Peso da comissão</TableHead>
              <TableHead className="text-right">Comissão preventiva (mês)</TableHead>
              <TableHead className="text-right">Bonificações (mês)</TableHead>
              <TableHead className="text-right">Folha bruta</TableHead>
              <TableHead className="text-right">INSS</TableHead>
              <TableHead className="text-right">Outros descontos</TableHead>
              <TableHead className="text-right">Folha líquida</TableHead>
              <TableHead className="text-center">Total manual</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.colabs.length === 0 && <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-12">Nenhum colaborador.</TableCell></TableRow>}
            {data.colabs.map((c) => {
              const meusContratos = data.contratos.filter((k) => k.colaborador_id === c.id);
              const comissaoCheia = c.cargo === "Líder"
                ? data.clientes.reduce((s, cli) => s + comissaoLiderPorCliente(cli, curKey), 0)
                : meusContratos.reduce((s, k) => s + commissionFor(c, data.clientes.find((x) => x.id === k.client_id), k, data.ltv, data.pctPenal, data.funcoes, curKey), 0);
              const peso = pesoDe(c.id, curKey);
              const comissao = (comissaoCheia * peso) / 100;
              const lancsMes = data.lancamentos.filter((l) => l.colaborador_id === c.id && monthKey(l.data_lancamento) === curKey);
              const bonusLancMes = lancsMes.filter((l) => Number(l.valor) > 0).reduce((s, l) => s + Number(l.valor), 0);
              const descontosMes = -lancsMes.filter((l) => Number(l.valor) < 0).reduce((s, l) => s + Number(l.valor), 0);
              const extrasMes = data.extras.filter((e) => e.colaborador_id === c.id && monthKey(e.data_referencia) === curKey).reduce((s, e) => s + Number(e.valor), 0);
              const bonificacoesMes = extrasMes + bonusLancMes;
              const bruto = Number(c.salario_base) + comissao + bonificacoesMes;
              const inss = calcularINSS(bruto);
              const manual = manualDe(c.id, curKey);
              const folhaTotal = manual ?? bruto - descontosMes - inss;
              const isOpen = expanded === c.id;
              return (
                <Fragment key={c.id}>
                  <TableRow className="cursor-pointer" onClick={() => setExpanded(isOpen ? null : c.id)}>
                    <TableCell><ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`} /></TableCell>
                    <TableCell className="font-medium">{c.nome}</TableCell>
                    <TableCell><span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">{c.cargo}</span></TableCell>
                    <TableCell className="text-right tabular">{formatBRL(c.salario_base)}</TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <Select value={String(peso)} onValueChange={(v) => salvarPeso.mutate({ colabId: c.id, mKey: curKey, peso: Number(v) })}>
                        <SelectTrigger className="w-24 mx-auto h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[0, 25, 50, 60, 75, 100, 110, 125, 150].map((p) => (
                            <SelectItem key={p} value={String(p)}>{p}%</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {formatBRL(comissao)}
                      {peso !== 100 && <div className="text-[10px] text-muted-foreground">cheia {formatBRL(comissaoCheia)}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular text-emerald-600">{bonificacoesMes > 0 ? `+ ${formatBRL(bonificacoesMes)}` : formatBRL(0)}</TableCell>
                    <TableCell className="text-right tabular">{formatBRL(bruto)}</TableCell>
                    <TableCell className="text-right tabular text-rose-600">{inss > 0 ? `− ${formatBRL(inss)}` : formatBRL(0)}</TableCell>
                    <TableCell className="text-right tabular text-rose-600">{descontosMes > 0 ? `− ${formatBRL(descontosMes)}` : formatBRL(0)}</TableCell>
                    <TableCell className="text-right tabular font-semibold">
                      {formatBRL(folhaTotal)}
                      {manual != null && <div className="text-[10px] text-muted-foreground">valor manual</div>}
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 justify-center">
                        <Input
                          key={`${c.id}-${curKey}-${manual ?? "auto"}`}
                          type="number"
                          step="0.01"
                          placeholder="automático"
                          defaultValue={manual ?? ""}
                          className="w-28 h-8 text-right"
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          onBlur={(e) => {
                            const raw = e.target.value.trim().replace(",", ".");
                            const val = raw === "" ? null : Number(raw);
                            if (val !== null && !Number.isFinite(val)) return;
                            if ((manual ?? null) === val) return;
                            salvarManual.mutate({ colabId: c.id, mKey: curKey, valor: val });
                          }}
                        />
                        {manual != null && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Voltar ao cálculo automático" onClick={() => salvarManual.mutate({ colabId: c.id, mKey: curKey, valor: null })}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button size="icon" variant="ghost" onClick={() => { setEditing(c); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Remover ${c.nome}?`)) del.mutate(c.id); }}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>

                  {isOpen && (
                    <TableRow>
                      <TableCell colSpan={13} className="bg-surface-2 p-6">
                        <ColabDetails colab={c} clientes={data.clientes} contratos={meusContratos} extras={data.extras.filter((e) => e.colaborador_id === c.id)} lancamentos={data.lancamentos.filter((l) => l.colaborador_id === c.id)} ltv={data.ltv} pctPenal={data.pctPenal} historico={data.historico.filter((h) => h.colaborador_id === c.id)} funcoes={data.funcoes} mesFolha={curKey} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
            {data.colabs.length > 0 && (() => {
              const rows = buildRows(curKey);
              const t = rows.reduce((a, r) => ({
                base: a.base + r.salario_base,
                com: a.com + r.total_comissoes,
                bon: a.bon + r.total_extras,
                liq: a.liq + r.valor_liquido,
              }), { base: 0, com: 0, bon: 0, liq: 0 });
              const bruto = t.base + t.com + t.bon;
              const inss = rows.reduce((s, r) => s + calcularINSS(r.salario_base + r.total_comissoes + r.total_extras), 0);
              const outros = rows.reduce((s, r) => s + r.total_descontos, 0) - inss;
              return (
                <TableRow className="bg-surface-2 font-semibold">
                  <TableCell colSpan={3} className="text-right">Total da equipe</TableCell>
                  <TableCell className="text-right tabular">{formatBRL(t.base)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular">{formatBRL(t.com)}</TableCell>
                  <TableCell className="text-right tabular text-emerald-600">{formatBRL(t.bon)}</TableCell>
                  <TableCell className="text-right tabular">{formatBRL(bruto)}</TableCell>
                  <TableCell className="text-right tabular text-rose-600">{formatBRL(inss)}</TableCell>
                  <TableCell className="text-right tabular text-rose-600">{formatBRL(outros)}</TableCell>
                  <TableCell className="text-right tabular">{formatBRL(t.liq)}</TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              );
            })()}
          </TableBody>
        </Table>
      </div>

    </PageContainer>
  );
}

function ColabDialog({ editing, onClose }: { editing: Colab | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    nome: editing?.nome ?? "",
    cargo: editing?.cargo ?? ("Outros" as Cargo),
    salario_base: editing?.salario_base ?? 0,
    data_entrada: editing?.data_entrada ?? todayISO(),
    funcao_id: editing?.funcao_id ?? "",
  });
  const { data: funcoes } = useSuspenseQuery({
    queryKey: ["funcoes"],
    queryFn: async () => ((await supabase.from("funcoes").select("id,nome,tipo_base").order("nome")).data ?? []) as Funcao[],
  });
  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...form, funcao_id: form.funcao_id || null };
      if (editing) { const { error } = await supabase.from("colaboradores").update(payload).eq("id", editing.id); if (error) throw error; }
      else { const { error } = await supabase.from("colaboradores").insert(payload); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["colaboradores-all"] }); toast.success("Salvo"); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{editing ? "Editar colaborador" : "Novo colaborador"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <div className="space-y-1.5"><Label>Nome</Label><Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Cargo (padrão)</Label>
            <Select value={form.cargo} onValueChange={(v: Cargo) => setForm({ ...form, cargo: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Líder">Líder</SelectItem>
                <SelectItem value="Social Media">Social Media</SelectItem>
                <SelectItem value="Gestor de Tráfego">Gestor de Tráfego</SelectItem>
                <SelectItem value="Outros">Outros</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Data de entrada na empresa</Label><Input type="date" required value={form.data_entrada} onChange={(e) => setForm({ ...form, data_entrada: e.target.value })} /></div>
        </div>
        <div className="space-y-1.5 rounded-lg border bg-surface-2 p-4">
          <Label className="text-sm font-semibold">Tipo de comissão (função personalizada)</Label>
          <p className="text-xs text-muted-foreground">Escolha a função cadastrada em <strong>Configurações → Funções de comissão personalizadas</strong> (ex.: Social Media 1, Social Media 2). Ela define a base de cálculo e a tabela de % por LTV que este colaborador vai receber. Deixe em branco para usar a regra padrão do cargo.</p>
          <Select value={form.funcao_id || "none"} onValueChange={(v) => setForm({ ...form, funcao_id: v === "none" ? "" : v })}>
            <SelectTrigger><SelectValue placeholder="Usar regra do cargo padrão" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— usar cargo padrão —</SelectItem>
              {funcoes.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.nome} · {f.tipo_base === "fatia_social_media" ? "fatia SM" : f.tipo_base === "fatia_trafego" ? "fatia Tráfego" : "mensalidade total"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {funcoes.length === 0 && (
            <p className="text-xs text-amber-600">Nenhuma função cadastrada ainda. Vá em Configurações para criar Social Media 1, 2, etc.</p>
          )}
        </div>
        <div className="space-y-1.5"><Label>Salário base (R$)</Label><Input type="number" step="0.01" min="0" required value={form.salario_base} onChange={(e) => setForm({ ...form, salario_base: Number(e.target.value) })} /></div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>Salvar</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function ColabDetails({ colab, clientes, contratos, extras, lancamentos, ltv, pctPenal, historico, funcoes, mesFolha }: { colab: Colab; clientes: Cliente[]; contratos: Contrato[]; extras: any[]; lancamentos: any[]; ltv: LtvRow[]; pctPenal: number; historico: HistoricoFolha[]; funcoes: Funcao[]; mesFolha: string }) {
  const qc = useQueryClient();
  const defaultExtraDate = `${mesFolha}-05`;
  const [novoContrato, setNovoContrato] = useState({ client_id: "", valor_base_calculo: 0, prazo_entrega_planejamentos: 5, status_entrega_mes_atual: "Entregue no Prazo" as StatusEntrega });
  const [novoExtra, setNovoExtra] = useState({ descricao: "", valor: 0, data_referencia: defaultExtraDate });

  const addContrato = useMutation({
    mutationFn: async () => {
      if (!novoContrato.client_id) throw new Error("Selecione um cliente");
      const cli = clientes.find((c) => c.id === novoContrato.client_id);
      const { error } = await supabase.from("contratos_fatiamento").insert({
        colaborador_id: colab.id,
        client_id: novoContrato.client_id,
        valor_base_calculo: cli?.valor_mensalidade ?? 0,
        prazo_entrega_planejamentos: novoContrato.prazo_entrega_planejamentos,
        status_entrega_mes_atual: novoContrato.status_entrega_mes_atual,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["colaboradores-all"] }); setNovoContrato({ client_id: "", valor_base_calculo: 0, prazo_entrega_planejamentos: 5, status_entrega_mes_atual: "Entregue no Prazo" }); toast.success("Fatiamento adicionado"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateContrato = useMutation({
    mutationFn: async (c: Contrato) => {
      const { error } = await supabase.from("contratos_fatiamento").update({ valor_base_calculo: c.valor_base_calculo, prazo_entrega_planejamentos: c.prazo_entrega_planejamentos, status_entrega_mes_atual: c.status_entrega_mes_atual }).eq("id", c.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["colaboradores-all"] }); toast.success("Contrato atualizado"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delContrato = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("contratos_fatiamento").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["colaboradores-all"] }),
  });
  const addExtra = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("recebimentos_extras").insert({ colaborador_id: colab.id, ...novoExtra });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["colaboradores-all"] }); setNovoExtra({ descricao: "", valor: 0, data_referencia: defaultExtraDate }); toast.success("Recebimento extra adicionado"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const replicarExtra = useMutation({
    mutationFn: async (e: any) => {
      const { error } = await supabase.from("recebimentos_extras").insert({ colaborador_id: colab.id, descricao: e.descricao, valor: e.valor, data_referencia: defaultExtraDate });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["colaboradores-all"] }); toast.success("Bonificação replicada para a competência selecionada"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delExtra = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("recebimentos_extras").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["colaboradores-all"] }),
  });

  const byNome = (a?: string, b?: string) => (a ?? "").localeCompare(b ?? "", "pt-BR", { sensitivity: "base" });
  const nomeCliente = (id: string) => clientes.find((c) => c.id === id)?.nome ?? "";
  const contratosOrdenados = [...contratos].sort((a, b) => byNome(nomeCliente(a.client_id), nomeCliente(b.client_id)));
  const clientesDisponiveis = clientes
    .filter((c) => !contratos.some((k) => k.client_id === c.id))
    .sort((a, b) => byNome(a.nome, b.nome));

  const mesTitulo = new Date(`${mesFolha}-01T00:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const abrir = (ok: boolean) => { if (!ok) toast.error("Permita pop-ups para imprimir."); };

  const imprimirFatiamento = () => {
    const items =
      colab.cargo === "Líder"
        ? clientes
            .filter((c) => clienteAtivoNoMes(c, mesFolha) && isClienteAntigoLider(c.data_entrada))
            .sort((a, b) => byNome(a.nome, b.nome))
            .map((c) => ({ nome: c.nome, regra: "1% travado (Líder)", mensalidade: Number(c.valor_mensalidade), comissao: comissaoLiderPorCliente(c, mesFolha) }))
        : contratosOrdenados.map((k) => {
            const cli = clientes.find((c) => c.id === k.client_id);
            return {
              nome: cli?.nome ?? "—",
              regra: `${k.status_entrega_mes_atual}${k.prazo_entrega_planejamentos ? ` · prazo dia ${k.prazo_entrega_planejamentos}` : ""}`,
              mensalidade: Number(cli?.valor_mensalidade ?? 0),
              comissao: commissionFor(colab, cli, k, ltv, pctPenal, funcoes, mesFolha),
            };
          });
    abrir(
      printReport({
        title: `Fatiamento de contratos — ${colab.nome}`,
        subtitle: `${colab.cargo} · competência ${mesTitulo}`,
        sections: [
          {
            title: "Contratos e comissões",
            columns: [{ label: "Cliente" }, { label: "Entrega / regra" }, { label: "Comissão", align: "right" }],
            rows: items.map((f) => [f.nome, f.regra, formatBRL(f.comissao)]),
            footer: ["Total", "", formatBRL(items.reduce((s, f) => s + f.comissao, 0))],
            empty: "Sem contratos fatiados.",
          },
        ],
      }),
    );
  };

  const imprimirBonificacoes = () => {
    const doMes = extras.filter((e) => monthKey(e.data_referencia) === mesFolha);
    const outros = extras.filter((e) => monthKey(e.data_referencia) !== mesFolha);
    const lancPositivos = lancamentos.filter((l) => monthKey(l.data_lancamento) === mesFolha && Number(l.valor) > 0);
    const linhasMes = [
      ...doMes.map((e) => ({ descricao: e.descricao, data: e.data_referencia, valor: Number(e.valor) })),
      ...lancPositivos.map((l) => ({ descricao: l.descricao ?? "Lançamento", data: l.data_lancamento, valor: Number(l.valor) })),
    ];
    abrir(
      printReport({
        title: `Bonificações — ${colab.nome}`,
        subtitle: `${colab.cargo} · competência ${mesTitulo}`,
        sections: [
          {
            title: `Bonificações da competência ${mesTitulo}`,
            columns: [{ label: "Descrição" }, { label: "Data" }, { label: "Valor", align: "right" }],
            rows: linhasMes.map((b) => [b.descricao, new Date(b.data).toLocaleDateString("pt-BR"), formatBRL(b.valor)]),
            footer: ["Total da competência", "", formatBRL(linhasMes.reduce((s, b) => s + b.valor, 0))],
            empty: "Sem bonificações nesta competência.",
          },
          {
            title: "Histórico de outras competências",
            columns: [{ label: "Descrição" }, { label: "Data" }, { label: "Valor", align: "right" }],
            rows: outros.map((e) => [e.descricao, new Date(e.data_referencia).toLocaleDateString("pt-BR"), formatBRL(e.valor)]),
            footer: ["Total histórico", "", formatBRL(outros.reduce((s, e) => s + Number(e.valor), 0))],
            empty: "Sem registros em outras competências.",
          },
        ],
      }),
    );
  };



  if (colab.cargo === "Líder") {
    const ativosNoMes = clientes.filter((c) => clienteAtivoNoMes(c, mesFolha));
    const antigos = ativosNoMes.filter((c) => isClienteAntigoLider(c.data_entrada)).sort((a, b) => byNome(a.nome, b.nome));
    const novos = ativosNoMes.filter((c) => !isClienteAntigoLider(c.data_entrada)).sort((a, b) => byNome(a.nome, b.nome));
    const totalAntigos = antigos.reduce((s, c) => s + comissaoLiderPorCliente(c, mesFolha), 0);
    return (
      <div className="space-y-6">
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <h4 className="text-sm font-semibold">Comissão Líder — clientes ativos até 30/06/2026 (1% travado)</h4>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{antigos.length} cliente(s)</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={imprimirFatiamento}><Printer className="h-3 w-3 mr-1" />Imprimir fatiamento</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={imprimirBonificacoes}><Printer className="h-3 w-3 mr-1" />Imprimir bonificações</Button>
            </div>
          </div>

          <div className="rounded-lg border bg-surface overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Entrada</TableHead>
                  <TableHead className="text-right">Mensalidade</TableHead>
                  <TableHead className="text-right">Comissão (1%)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {antigos.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground text-sm">Nenhum cliente elegível.</TableCell></TableRow>}
                {antigos.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.nome}</TableCell>
                    <TableCell className="tabular text-muted-foreground">{new Date(c.data_entrada).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell className="text-right tabular">{formatBRL(c.valor_mensalidade)}</TableCell>
                    <TableCell className="text-right tabular">{formatBRL(comissaoLiderPorCliente(c, mesFolha))}</TableCell>
                  </TableRow>
                ))}
                {antigos.length > 0 && (
                  <TableRow className="bg-surface-2 font-semibold">
                    <TableCell colSpan={3} className="text-right">Total</TableCell>
                    <TableCell className="text-right tabular">{formatBRL(totalAntigos)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        {novos.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2">Clientes a partir de 01/07/2026 — regra futura</h4>
            <div className="rounded-lg border bg-surface p-4 text-xs text-muted-foreground">
              {novos.length} cliente(s) aguardando definição da nova regra de comissão. Atualmente não geram comissão para o Líder.
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold">Fatiamento de Contratos</h4>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={imprimirFatiamento}><Printer className="h-3 w-3 mr-1" />Imprimir fatiamento</Button>
        </div>

        <div className="rounded-lg border bg-surface mb-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Prazo</TableHead>
                <TableHead>Entrega</TableHead>
                <TableHead className="text-right">Comissão</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contratosOrdenados.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground text-sm">Sem contratos.</TableCell></TableRow>}
              {contratosOrdenados.map((k) => {
                const cli = clientes.find((c) => c.id === k.client_id);
                const com = commissionFor(colab, cli, k, ltv, pctPenal, funcoes, mesFolha);
                return (
                  <ContratoRow key={k.id} contrato={k} clienteNome={cli?.nome ?? "—"} comissao={com} onSave={(v) => updateContrato.mutate(v)} onDelete={() => delContrato.mutate(k.id)} />
                );
              })}
              {contratosOrdenados.length > 0 && (
                <TableRow className="bg-surface-2 font-semibold">
                  <TableCell colSpan={3} className="text-right">Total do fatiamento</TableCell>
                  <TableCell className="text-right tabular">
                    {formatBRL(
                      contratosOrdenados.reduce(
                        (s, k) => s + commissionFor(colab, clientes.find((c) => c.id === k.client_id), k, ltv, pctPenal, funcoes, mesFolha),
                        0,
                      ),
                    )}
                  </TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); addContrato.mutate(); }} className="grid grid-cols-2 gap-2 items-end">
          <div className="col-span-2">
            <Label className="text-xs">Cliente</Label>
            <Select value={novoContrato.client_id} onValueChange={(v) => setNovoContrato({ ...novoContrato, client_id: v })}>
              <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
              <SelectContent>{clientesDisponiveis.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2"><Label className="text-xs">Prazo (dia do mês)</Label><Input type="number" min="1" max="31" value={novoContrato.prazo_entrega_planejamentos} onChange={(e) => setNovoContrato({ ...novoContrato, prazo_entrega_planejamentos: Number(e.target.value) })} /></div>
          <div className="col-span-2">
            <Label className="text-xs">Status da entrega (mês atual)</Label>
            <Select value={novoContrato.status_entrega_mes_atual} onValueChange={(v: StatusEntrega) => setNovoContrato({ ...novoContrato, status_entrega_mes_atual: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Entregue no Prazo">Entregue no Prazo</SelectItem>
                <SelectItem value="Entregue com Atraso">Entregue com Atraso</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" size="sm" className="col-span-2">Adicionar fatiamento</Button>
        </form>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <h4 className="text-sm font-semibold">Recebimentos Extras (bônus / premiações)</h4>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Somam na folha apenas na competência {mesFolha.split("-").reverse().join("/")}</span>
            <Button size="sm" variant="outline" className="h-7 text-xs whitespace-nowrap" onClick={imprimirBonificacoes}><Printer className="h-3 w-3 mr-1" />Imprimir</Button>
          </div>
        </div>

        <div className="rounded-lg border bg-surface mb-3">
          <Table>
            <TableHeader><TableRow><TableHead>Descrição</TableHead><TableHead>Data</TableHead><TableHead className="text-right">Valor</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {extras.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground text-sm">Sem registros.</TableCell></TableRow>}
              {extras.map((e) => {
                const noMes = monthKey(e.data_referencia) === mesFolha;
                return (
                <TableRow key={e.id} className={noMes ? "" : "opacity-60"}>
                  <TableCell>
                    {e.descricao}
                    {!noMes && <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">fora da competência</span>}
                  </TableCell>
                  <TableCell className="tabular text-muted-foreground">{new Date(e.data_referencia).toLocaleDateString("pt-BR")}</TableCell>
                  <TableCell className="text-right tabular">{formatBRL(e.valor)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {!noMes && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => replicarExtra.mutate(e)}>Aplicar no mês</Button>}
                    <Button size="icon" variant="ghost" onClick={() => delExtra.mutate(e.id)}><Trash2 className="h-3 w-3" /></Button>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); addExtra.mutate(); }} className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {TIPOS_BONIFICACAO.filter((t) => t !== "Outro").map((t) => (
              <Button key={t} type="button" size="sm" variant={novoExtra.descricao === t ? "default" : "outline"} className="h-7 text-xs" onClick={() => setNovoExtra({ ...novoExtra, descricao: t })}>
                {t}
              </Button>
            ))}
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1"><Label className="text-xs">Descrição</Label><Input required placeholder="Ex.: Prêmio produtividade" value={novoExtra.descricao} onChange={(e) => setNovoExtra({ ...novoExtra, descricao: e.target.value })} /></div>
            <div className="w-32"><Label className="text-xs">Valor</Label><Input type="number" step="0.01" required value={novoExtra.valor} onChange={(e) => setNovoExtra({ ...novoExtra, valor: Number(e.target.value) })} /></div>
            <div className="w-40"><Label className="text-xs">Data</Label><Input type="date" required value={novoExtra.data_referencia} onChange={(e) => setNovoExtra({ ...novoExtra, data_referencia: e.target.value })} /></div>
            <Button type="submit" size="sm">Adicionar</Button>
          </div>
        </form>


        {lancamentos.some((l) => l.is_clawback) && (
          <div className="mt-4 text-xs text-muted-foreground">
            Estornos automáticos por inadimplência aparecem em <span className="font-medium text-foreground">Fluxo de Caixa</span>.
          </div>
        )}
      </div>

      <div className="lg:col-span-2">
        <HistoricoFolhaTimeline historico={historico} />
      </div>
    </div>
  );
}

function HistoricoFolhaTimeline({ historico }: { historico: HistoricoFolha[] }) {
  const ordenado = [...historico].sort((a, b) => a.mes_competencia.localeCompare(b.mes_competencia));
  const max = Math.max(1, ...ordenado.map((h) => Number(h.valor_liquido)));
  const fmtMes = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
  };
  return (
    <div>
      <h4 className="text-sm font-semibold mb-3">Histórico cronológico da folha</h4>
      {ordenado.length === 0 ? (
        <div className="rounded-lg border bg-surface p-4 text-xs text-muted-foreground">
          Nenhum mês fechado. Use o botão "Fechar folha do mês" no topo para registrar o snapshot da competência atual.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border bg-surface p-4">
            <div className="flex items-end gap-1 h-32">
              {ordenado.map((h) => {
                const pct = (Number(h.valor_liquido) / max) * 100;
                return (
                  <div key={h.id} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="text-[10px] tabular text-muted-foreground opacity-0 group-hover:opacity-100 transition">
                      {formatBRL(h.valor_liquido)}
                    </div>
                    <div className="w-full bg-primary/80 rounded-t" style={{ height: `${Math.max(4, pct)}%` }} />
                    <div className="text-[10px] tabular text-muted-foreground">{fmtMes(h.mes_competencia)}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-lg border bg-surface overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Competência</TableHead>
                  <TableHead className="text-right">Salário base</TableHead>
                  <TableHead className="text-right">Comissões</TableHead>
                  <TableHead className="text-right">Extras</TableHead>
                  <TableHead className="text-right">Descontos</TableHead>
                  <TableHead className="text-right">Líquido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...ordenado].reverse().map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium tabular">{fmtMes(h.mes_competencia)}</TableCell>
                    <TableCell className="text-right tabular">{formatBRL(h.salario_base)}</TableCell>
                    <TableCell className="text-right tabular">{formatBRL(h.total_comissoes)}</TableCell>
                    <TableCell className="text-right tabular">{formatBRL(h.total_extras)}</TableCell>
                    <TableCell className="text-right tabular text-rose-600">{formatBRL(h.total_descontos)}</TableCell>
                    <TableCell className="text-right tabular font-semibold">{formatBRL(h.valor_liquido)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function ContratoRow({ contrato, clienteNome, comissao, onSave, onDelete }: { contrato: Contrato; clienteNome: string; comissao: number; onSave: (c: Contrato) => void; onDelete: () => void }) {
  const [v, setV] = useState(contrato);
  const dirty = v.prazo_entrega_planejamentos !== contrato.prazo_entrega_planejamentos || v.status_entrega_mes_atual !== contrato.status_entrega_mes_atual;
  return (
    <TableRow>
      <TableCell className="font-medium">{clienteNome}</TableCell>
      <TableCell>
        <Input type="number" min="1" max="31" value={v.prazo_entrega_planejamentos ?? ""} onChange={(e) => setV({ ...v, prazo_entrega_planejamentos: e.target.value === "" ? null : Number(e.target.value) })} className="w-16 tabular" />
      </TableCell>
      <TableCell>
        <Select value={v.status_entrega_mes_atual} onValueChange={(s: StatusEntrega) => setV({ ...v, status_entrega_mes_atual: s })}>
          <SelectTrigger className="w-44 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Entregue no Prazo">Entregue no Prazo</SelectItem>
            <SelectItem value="Entregue com Atraso">Entregue com Atraso</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-right tabular">{formatBRL(comissao)}</TableCell>
      <TableCell>
        <div className="flex gap-1 justify-end">
          {dirty && <Button size="sm" onClick={() => onSave(v)}>Salvar</Button>}
          <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
