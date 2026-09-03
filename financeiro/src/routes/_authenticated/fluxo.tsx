import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useMemo, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  Plus, Pencil, Trash2, FileText, Copy, ChevronLeft, ChevronRight, CalendarDays, Settings2,
  LayoutGrid, List, Calendar as CalIcon, Search, HelpCircle, Bell, MoreHorizontal,
  CheckCheck, RotateCw, X,
} from "lucide-react";
import { toast } from "sonner";
import { formatBRL, formatDateBR, parseISODate, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listarClientes } from "@/lib/clientes";
import { comOrganizacao } from "@/lib/organizacao";


export const Route = createFileRoute("/_authenticated/fluxo")({
  head: () => ({ meta: [{ title: "Lançamentos de caixa — FEMO FINANÇAS" }] }),
  component: () => (
    <Suspense fallback={<PageContainer>Carregando…</PageContainer>}>
      <Fluxo />
    </Suspense>
  ),
});

type Lanc = any;
type Cat = { id: string; nome: string; tipo: string };

// Conta única centralizadora — todo o caixa é Sicredi PJ
const CONTAS = [
  { id: "sicredi", nome: "Sicredi PJ", cor: "#3FA535" },
];

function dateToISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fullDateBR(iso: string) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : formatDateBR(iso);
}

const STATUS_FILTROS = [
  { key: "Pendente", label: "Pendentes", dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
  { key: "Agendado", label: "Agendados", dot: "bg-amber-400", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  { key: "Pago", label: "Confirmados", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  { key: "Conciliado", label: "Conciliados", dot: "bg-sky-500", chip: "bg-sky-50 text-sky-700 ring-sky-200" },
] as const;

function statusColor(s: string) {
  switch (s) {
    case "Pago": return "bg-emerald-500";
    case "Pendente": return "bg-rose-500";
    case "Agendado": return "bg-amber-400";
    case "Conciliado": return "bg-sky-500";
    case "Inadimplente": return "bg-rose-600";
    default: return "bg-zinc-300";
  }
}

function Fluxo() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Lanc | null>(null);
  const [view, setView] = useState<"grid" | "list" | "cal">("list");
  const [activeStatus, setActiveStatus] = useState<string[]>([]);
  const [tipoFiltro, setTipoFiltro] = useState<"Todos" | "Entrada" | "Saída">("Todos");
  const [categoriaFiltro, setCategoriaFiltro] = useState("all");
  const [clienteFiltro, setClienteFiltro] = useState("all");
  const [colaboradorFiltro, setColaboradorFiltro] = useState("all");
  const [busca, setBusca] = useState("");
  const [contasSel, setContasSel] = useState<string[]>(CONTAS.map((c) => c.id));
  const [cursor, setCursor] = useState(() => {
    const t = parseISODate(todayISO())!;
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const [alertOpen, setAlertOpen] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data } = useSuspenseQuery({
    queryKey: ["fluxo"],
    queryFn: async () => {
      const [lanc, cats, clis, colabs] = await Promise.all([
        supabase.from("lancamentos_financeiros").select("*").order("data_lancamento", { ascending: true }),
        supabase.from("categorias").select("*").order("nome"),
        listarClientes(),
        supabase.from("colaboradores").select("id,nome").order("nome"),
      ]);
      return { lanc: (lanc.data ?? []) as any[], cats: (cats.data ?? []) as Cat[], clis, colabs: colabs.data ?? [] };
    },
  });

  const catById = useMemo(() => new Map(data.cats.map((c) => [c.id, c.nome])), [data.cats]);
  const cliById = useMemo(() => new Map((data.clis as any[]).map((c) => [c.id, c.nome])), [data.clis]);
  const colabById = useMemo(() => new Map((data.colabs as any[]).map((c) => [c.id, c.nome])), [data.colabs]);

  const gerarMensalidades = useMutation({
    mutationFn: async () => {
      const iso = dateToISO(cursor);
      const [year, month] = iso.split("-").map(Number);
      const competencia = `${year}-${String(month).padStart(2, "0")}-01`;
      const { data, error } = await supabase.rpc("gerar_mensalidades", {
        _competencia: competencia,
      });
      if (error) throw new Error(error.message);
      return { criadas: Number(data ?? 0) };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["fluxo"] });
      if (res.criadas === 0) {
        toast.info("Nenhuma mensalidade nova — todas já estavam lançadas neste mês.");
        return;
      }
      toast.success(
        `${res.criadas} mensalidade(s) lançada(s) em Contas a Receber`,
        { description: "Quem entrou no meio do mês entrou com valor proporcional." },
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("lancamentos_financeiros").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fluxo"] }); toast.success("Removido"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: any }) => {
      const { error } = await supabase.from("lancamentos_financeiros").update({ status_pagamento: status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fluxo"] }); toast.success("Status atualizado"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkDel = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("lancamentos_financeiros").delete().in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["fluxo"] });
      setSelected(new Set());
      toast.success(`${n} lançamento(s) removido(s)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelRec = useMutation({
    mutationFn: async (grupoId: string) => {
      const today = todayISO();
      // apaga parcelas futuras não pagas
      const { error } = await supabase.from("lancamentos_financeiros")
        .delete()
        .eq("recorrencia_grupo_id", grupoId)
        .gte("data_lancamento", today)
        .in("status_pagamento", ["Pendente"]);
      if (error) throw error;
      // desativa flag no restante do grupo
      await supabase.from("lancamentos_financeiros")
        .update({ recorrencia_ativa: false, recorrencia_indefinida: false })
        .eq("recorrencia_grupo_id", grupoId);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fluxo"] }); toast.success("Recorrência cancelada — parcelas futuras removidas"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(cursor),
    [cursor],
  );

  const { mesItens, saldoAnterior, entradas, saidas, contasTotais } = useMemo(() => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const inMonth = (iso: string) => {
      const d = parseISODate(iso); if (!d) return false;
      return d.getFullYear() === y && d.getMonth() === m;
    };
    const before = (iso: string) => {
      const d = parseISODate(iso); if (!d) return false;
      return d.getFullYear() < y || (d.getFullYear() === y && d.getMonth() < m);
    };

    const signed = (l: Lanc) => (l.tipo === "Entrada" ? 1 : -1) * Number(l.valor || 0);
    const saldoAnt = data.lanc.filter((l) => before(l.data_lancamento) && (l.status_pagamento === "Pago" || l.status_pagamento === "Conciliado")).reduce((s, l) => s + signed(l), 0);

    let items = data.lanc.filter((l) => inMonth(l.data_lancamento));
    if (contasSel.length === 0) items = [];
    if (tipoFiltro !== "Todos") items = items.filter((l) => l.tipo === tipoFiltro);
    if (activeStatus.length) items = items.filter((l) => activeStatus.includes(l.status_pagamento));
    if (categoriaFiltro !== "all") items = items.filter((l) => l.categoria_id === categoriaFiltro);
    if (clienteFiltro !== "all") items = items.filter((l) => l.client_id === clienteFiltro);
    if (colaboradorFiltro !== "all") items = items.filter((l) => l.colaborador_id === colaboradorFiltro);
    const termo = busca.trim().toLowerCase();
    if (termo) {
      items = items.filter((l) => {
        const cat = catById.get(l.categoria_id) ?? "";
        const cli = l.client_id ? (cliById.get(l.client_id) ?? "") : "";
        const colab = l.colaborador_id ? (colabById.get(l.colaborador_id) ?? "") : "";
        return [l.descricao, cat, cli, colab, l.status_pagamento, l.tipo].filter(Boolean).some((v) => String(v).toLowerCase().includes(termo));
      });
    }
    items = [...items].sort((a, b) => {
      const byDate = String(a.data_lancamento).localeCompare(String(b.data_lancamento));
      if (byDate !== 0) return byDate;
      const aRef = a.client_id ? (cliById.get(a.client_id) ?? "") : a.colaborador_id ? (colabById.get(a.colaborador_id) ?? "") : (a.descricao ?? "");
      const bRef = b.client_id ? (cliById.get(b.client_id) ?? "") : b.colaborador_id ? (colabById.get(b.colaborador_id) ?? "") : (b.descricao ?? "");
      return String(aRef).localeCompare(String(bRef), "pt-BR", { sensitivity: "base" });
    });

    const ent = items.filter((l) => l.tipo === "Entrada").reduce((s, l) => s + Number(l.valor || 0), 0);
    const sai = items.filter((l) => l.tipo === "Saída").reduce((s, l) => s + Number(l.valor || 0), 0);

    // Distribui valor por conta de forma estável (hash do id) — placeholder funcional
    const ct: Record<string, { conf: number; proj: number }> = Object.fromEntries(CONTAS.map((c) => [c.id, { conf: 0, proj: 0 }]));
    for (const l of items) {
      const bucket = CONTAS[(l.id?.charCodeAt(0) ?? 0) % CONTAS.length].id;
      const v = signed(l);
      if (l.status_pagamento === "Pago" || l.status_pagamento === "Conciliado") ct[bucket].conf += v;
      else ct[bucket].proj += v;
    }

    return { mesItens: items, saldoAnterior: saldoAnt, entradas: ent, saidas: sai, contasTotais: ct };
  }, [data.lanc, cursor, activeStatus, tipoFiltro, categoriaFiltro, clienteFiltro, colaboradorFiltro, busca, contasSel, catById, cliById, colabById]);

  // Saldo acumulado por linha (a partir do saldo anterior)
  const linhas = useMemo(() => {
    let acc = saldoAnterior;
    return mesItens.map((l) => {
      const v = (l.tipo === "Entrada" ? 1 : -1) * Number(l.valor || 0);
      acc += v;
      return { l, valor: v, saldo: acc };
    });
  }, [mesItens, saldoAnterior]);

  const resultado = entradas - saidas;
  const totalConf = Object.values(contasTotais).reduce((s, v) => s + v.conf, 0);
  const totalProj = Object.values(contasTotais).reduce((s, v) => s + v.proj, 0);
  const filtrosAtivos = tipoFiltro !== "Todos" || activeStatus.length > 0 || categoriaFiltro !== "all" || clienteFiltro !== "all" || colaboradorFiltro !== "all" || busca.trim() !== "" || contasSel.length !== CONTAS.length;

  const toggleStatus = (k: string) =>
    setActiveStatus((curr) => (curr.includes(k) ? curr.filter((x) => x !== k) : [...curr, k]));
  const toggleConta = (id: string) =>
    setContasSel((curr) => (curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id]));

  return (
    <div className="relative min-h-[calc(100vh-4rem)] bg-zinc-50/60">
      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 py-3 sm:flex sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <h1 className="truncate text-lg font-semibold tracking-tight text-zinc-900">Lançamentos de caixa</h1>
            <div className="hidden sm:flex items-center rounded-lg border bg-white p-0.5">
              {([
                ["grid", LayoutGrid, "Grade"],
                ["list", List, "Lista"],
                ["cal", CalIcon, "Calendário"],
              ] as const).map(([k, Icon, label]) => (
                <button key={k} title={label} onClick={() => setView(k)}
                  className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition",
                    view === k && "bg-zinc-900 text-white")}>
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={gerarMensalidades.isPending}
              onClick={() => gerarMensalidades.mutate()}
              className="h-9 gap-1.5 bg-white px-3.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              <RotateCw className={cn("h-4 w-4", gerarMensalidades.isPending && "animate-spin")} />
              Gerar cobranças dos clientes
            </Button>
            <Button
              onClick={() => { setEditing(null); setOpen(true); }}
              className="h-9 gap-1.5 bg-emerald-500 px-3.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-600"
            >
              <Plus className="h-4 w-4" /> Novo Lançamento
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-zinc-500"><Search className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-zinc-500"><HelpCircle className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-zinc-500 relative">
              <Bell className="h-4 w-4" />
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-rose-500" />
            </Button>
            <div className="ml-1 flex items-center gap-2 rounded-full border bg-white pl-3 pr-1.5 py-1">
              <span className="text-xs font-medium text-zinc-700">FEMO Agência</span>
              <div className="grid h-6 w-6 place-items-center rounded-full bg-zinc-900 text-[10px] font-semibold text-white">FM</div>
            </div>
          </div>

        </div>
      </header>

      {/* CONTENT */}
      <div className="grid gap-6 px-6 py-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* COLUNA ESQUERDA */}
        <aside className="space-y-6">
          <section className="rounded-2xl border bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)]">
            {/* Seletor de período */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium capitalize tabular-nums">{monthLabel}</span>
                <Button size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-1 text-zinc-400">
                <CalendarDays className="h-4 w-4" />
                <Settings2 className="h-4 w-4" />
              </div>
            </div>

            {/* Tabela contas */}
            <div className="mt-5">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-1 pb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                <span>Conta</span>
                <span className="text-right">Confirmado</span>
                <span className="text-right">Projetado</span>
              </div>
              <ul className="divide-y divide-zinc-100">
                {CONTAS.map((c) => {
                  const t = contasTotais[c.id];
                  const checked = contasSel.includes(c.id);
                  return (
                    <li key={c.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2.5">
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <Checkbox checked={checked} onCheckedChange={() => toggleConta(c.id)} />
                        <span className="h-2 w-2 rounded-full" style={{ background: c.cor }} />
                        <span className="text-sm text-zinc-700">{c.nome}</span>
                      </label>
                      <span className="text-right text-sm tabular-nums text-emerald-600">{formatBRL(t.conf)}</span>
                      <span className="text-right text-sm tabular-nums text-emerald-400/80">{formatBRL(t.proj)}</span>
                    </li>
                  );
                })}
                <li className="grid grid-cols-[1fr_auto_auto] items-center gap-3 pt-3 text-sm font-medium">
                  <span className="text-zinc-900">Total</span>
                  <span className="text-right tabular-nums text-emerald-700">{formatBRL(totalConf)}</span>
                  <span className="text-right tabular-nums text-emerald-500/80">{formatBRL(totalProj)}</span>
                </li>
              </ul>
            </div>
          </section>

          {/* Resultados */}
          <section className="rounded-2xl border bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)]">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">Resultados</h3>
              <span className="text-[10px] uppercase tracking-wider text-zinc-400">R$</span>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-zinc-600">Entradas <span className="text-zinc-400">(receitas + transferências)</span></dt>
                <dd className="tabular-nums font-medium text-emerald-600">+ {formatBRL(entradas)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-600">Saídas <span className="text-zinc-400">(despesas + transferências)</span></dt>
                <dd className="tabular-nums font-medium text-rose-600">− {formatBRL(saidas)}</dd>
              </div>
              <div className="my-2 h-px bg-zinc-100" />
              <div className="flex items-center justify-between">
                <dt className="text-sm font-semibold text-zinc-900">Resultado líquido</dt>
                <dd className={cn("tabular-nums text-base font-semibold",
                  resultado >= 0 ? "text-emerald-600" : "text-rose-600")}>
                  {resultado >= 0 ? "+ " : "− "}{formatBRL(Math.abs(resultado))}
                </dd>
              </div>
            </dl>
          </section>
        </aside>

        {/* COLUNA DIREITA */}
        <main className="space-y-4">
          {/* Filtros */}
          <div className="space-y-3 rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)]">
            <div className="grid gap-3 xl:grid-cols-[minmax(180px,1.4fr)_minmax(160px,1fr)_minmax(160px,1fr)_minmax(160px,1fr)]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar lançamento, cliente, categoria…" className="pl-9" />
              </div>
              <Select value={categoriaFiltro} onValueChange={setCategoriaFiltro}>
                <SelectTrigger><SelectValue placeholder="Categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as categorias</SelectItem>
                  {data.cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={clienteFiltro} onValueChange={setClienteFiltro}>
                <SelectTrigger><SelectValue placeholder="Cliente" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os clientes</SelectItem>
                  {(data.clis as any[]).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={colaboradorFiltro} onValueChange={setColaboradorFiltro}>
                <SelectTrigger><SelectValue placeholder="Colaborador" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os colaboradores</SelectItem>
                  {(data.colabs as any[]).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {([
                ["Todos", "Todos"],
                ["Entrada", "Contas a Receber"],
                ["Saída", "Contas a Pagar"],
              ] as const).map(([key, label]) => (
                <button key={key} onClick={() => setTipoFiltro(key)}
                  className={cn(
                    "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition",
                    tipoFiltro === key ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50",
                  )}>
                  {label}
                </button>
              ))}
            {STATUS_FILTROS.map((s) => {
              const active = activeStatus.includes(s.key);
              return (
                <button key={s.key} onClick={() => toggleStatus(s.key)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition",
                    s.chip,
                    !active && "opacity-60 hover:opacity-100",
                  )}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
                  {s.label}
                </button>
              );
            })}
            {filtrosAtivos && (
              <button onClick={() => {
                setTipoFiltro("Todos");
                setActiveStatus([]);
                setCategoriaFiltro("all");
                setClienteFiltro("all");
                setColaboradorFiltro("all");
                setBusca("");
                setContasSel(CONTAS.map((c) => c.id));
              }} className="text-xs font-medium text-zinc-500 hover:text-zinc-900">limpar filtros</button>
            )}
            </div>
          </div>

          {/* Lista de lançamentos */}
          <section className="overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)]">
            <div className="flex items-center justify-between gap-3 border-b bg-zinc-50/60 px-5 py-2.5">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={linhas.length > 0 && linhas.every(({ l }) => selected.has(l.id))}
                  onCheckedChange={(v) => {
                    if (v) setSelected(new Set(linhas.map(({ l }) => l.id as string)));
                    else setSelected(new Set());
                  }}
                  aria-label="Selecionar todos"
                />
                {selected.size > 0 ? (
                  <span className="text-xs font-medium text-zinc-700">{selected.size} selecionado(s)</span>
                ) : (
                  <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Saldo anterior</span>
                )}
              </div>
              {selected.size > 0 ? (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => {
                    const ids = linhas.filter(({ l }) => l.tipo === "Saída").map(({ l }) => l.id as string);
                    setSelected(new Set(ids));
                  }}>
                    Só Saídas
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Limpar
                  </Button>
                  <Button size="sm" variant="destructive" disabled={bulkDel.isPending}
                    onClick={() => {
                      const ids = Array.from(selected);
                      if (confirm(`Excluir ${ids.length} lançamento(s)? Esta ação não pode ser desfeita.`)) bulkDel.mutate(ids);
                    }}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Excluir selecionados
                  </Button>
                </div>
              ) : (
                <span className={cn("text-sm tabular-nums font-medium", saldoAnterior >= 0 ? "text-zinc-700" : "text-rose-600")}>
                  {formatBRL(saldoAnterior)}
                </span>
              )}
            </div>

            {linhas.length === 0 ? (
              <div className="px-5 py-16 text-center text-sm text-zinc-400">Nenhum lançamento no período.</div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {linhas.map(({ l, valor, saldo }) => {
                  const cat = catById.get(l.categoria_id);
                  const ref = l.client_id
                    ? cliById.get(l.client_id)
                    : l.colaborador_id ? colabById.get(l.colaborador_id) : null;
                  const principal = (ref ?? l.descricao ?? cat ?? "Lançamento").toString();
                  const tags = [
                    CONTAS[(l.id?.charCodeAt(0) ?? 0) % CONTAS.length].nome.split(" ")[0].toLowerCase(),
                    cat,
                    l.metodo_pagamento ?? (l.link_boleto ? "Boleto" : null),
                  ].filter(Boolean) as string[];
                  const confirmado = l.status_pagamento === "Pago" || l.status_pagamento === "Conciliado";
                  const dateStr = fullDateBR(l.data_lancamento);
                  const isSel = selected.has(l.id);
                  return (
                    <li key={l.id} className={cn(
                      "group grid grid-cols-[auto_auto_86px_minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-5 py-3 hover:bg-zinc-50/70",
                      isSel && "bg-emerald-50/40",
                    )}>
                      <Checkbox
                        checked={isSel}
                        onCheckedChange={(v) => {
                          setSelected((curr) => {
                            const next = new Set(curr);
                            if (v) next.add(l.id); else next.delete(l.id);
                            return next;
                          });
                        }}
                        aria-label="Selecionar"
                      />
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className={cn("h-3 w-3 rounded-full ring-2 ring-white shadow cursor-pointer hover:scale-125 transition", statusColor(l.status_pagamento))}
                            title={`${l.status_pagamento} — clique para alterar`}
                            aria-label="Alterar status"
                          />
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-1" align="start">
                          <div className="flex flex-col">
                            {(["Pendente", "Agendado", "Pago", "Conciliado", "Inadimplente"] as const).map((st) => (
                              <button
                                key={st}
                                type="button"
                                onClick={() => updateStatus.mutate({ id: l.id, status: st })}
                                className={cn(
                                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-100",
                                  l.status_pagamento === st && "bg-zinc-50 font-medium",
                                )}
                              >
                                <span className={cn("h-2.5 w-2.5 rounded-full", statusColor(st))} />
                                {st}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <span className="text-xs tabular-nums text-zinc-500">{dateStr}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold uppercase tracking-wide text-zinc-800">{principal}</span>
                          {confirmado && <CheckCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                          {l.is_recorrente && <RotateCw className="h-3 w-3 shrink-0 text-zinc-400" />}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-1.5">
                          {tags.map((t, i) => (
                            <span key={i} className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">{t}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {l.link_boleto && (
                          <a href={l.link_boleto} target="_blank" rel="noreferrer"
                            className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" title="Boleto">
                            <FileText className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {l.codigo_pix && (
                          <button onClick={async () => { await navigator.clipboard.writeText(l.codigo_pix ?? ""); toast.success("Pix copiado"); }}
                            className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" title="Pix">
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <span className={cn("min-w-[110px] text-right text-sm tabular-nums font-semibold",
                        valor >= 0 ? "text-emerald-600" : "text-rose-600")}>
                        {valor >= 0 ? "+ " : "− "}{formatBRL(Math.abs(valor))}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={cn("min-w-[100px] text-right text-xs tabular-nums",
                          saldo >= 0 ? "text-zinc-500" : "text-rose-500")}>
                          {formatBRL(saldo)}
                        </span>
                        <RowMenu onEdit={() => { setEditing(l); setOpen(true); }}
                          onDelete={() => { if (confirm("Remover lançamento?")) del.mutate(l.id); }}
                          onCancelRec={l.recorrencia_grupo_id ? () => { if (confirm("Cancelar recorrência? As parcelas futuras pendentes serão removidas.")) cancelRec.mutate(l.recorrencia_grupo_id); } : undefined} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </main>
      </div>

      {/* Alerta flutuante */}
      {alertOpen && (
        <div className="fixed right-6 top-20 z-40 flex w-[320px] items-start gap-3 rounded-xl border border-rose-200 bg-rose-50/95 p-3 pr-2 shadow-lg backdrop-blur">
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-rose-500 text-white">
            <Bell className="h-3.5 w-3.5" />
          </span>
          <button className="flex-1 text-left text-sm text-rose-800 hover:text-rose-900">
            <strong className="block text-[13px] font-semibold">Alerta de vencimento de contas</strong>
            <span className="text-xs text-rose-700/80">Clique para detalhar</span>
          </button>
          <button onClick={() => setAlertOpen(false)} className="grid h-6 w-6 place-items-center rounded-md text-rose-500 hover:bg-rose-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* FAB */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogTrigger asChild>
          <button onClick={() => setEditing(null)}
            className="fixed bottom-8 right-8 z-40 grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_10px_30px_-8px_rgba(16,185,129,0.6)] transition hover:bg-emerald-600 hover:scale-105">
            <Plus className="h-6 w-6" />
          </button>
        </DialogTrigger>
        <LancDialog key={editing?.id ?? "novo"} editing={editing} cats={data.cats} clis={data.clis} colabs={data.colabs} onClose={() => setOpen(false)} />
      </Dialog>
    </div>
  );
}

function RowMenu({ onEdit, onDelete, onCancelRec }: { onEdit: () => void; onDelete: () => void; onCancelRec?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 w-44 overflow-hidden rounded-lg border bg-white py-1 shadow-lg">
            <button onClick={() => { setOpen(false); onEdit(); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50">
              <Pencil className="h-3 w-3" /> Editar
            </button>
            {onCancelRec && (
              <button onClick={() => { setOpen(false); onCancelRec(); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50">
                <RotateCw className="h-3 w-3" /> Cancelar recorrência
              </button>
            )}
            <button onClick={() => { setOpen(false); onDelete(); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50">
              <Trash2 className="h-3 w-3" /> Excluir
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function LancDialog({ editing, cats, clis, colabs, onClose }: { editing: Lanc | null; cats: Cat[]; clis: any[]; colabs: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    tipo: editing?.tipo ?? "Saída" as "Entrada" | "Saída",
    categoria_id: editing?.categoria_id ?? "",
    descricao: editing?.descricao ?? "",
    data_lancamento: editing?.data_lancamento ?? todayISO(),
    valor: editing?.valor ?? 0,
    status_pagamento: editing?.status_pagamento ?? "Pendente" as "Pago" | "Pendente" | "Inadimplente" | "Agendado" | "Conciliado",
    client_id: editing?.client_id ?? "",
    colaborador_id: editing?.colaborador_id ?? "",
  });
  const [novaCat, setNovaCat] = useState("");
  const [recorrente, setRecorrente] = useState<boolean>(!!editing?.recorrencia_grupo_id);
  const [recTipo, setRecTipo] = useState<"n_meses" | "indefinida">(editing?.recorrencia_indefinida ? "indefinida" : "n_meses");
  const [recMeses, setRecMeses] = useState<number>(12);

  const save = useMutation({
    mutationFn: async () => {
      const basePayload = { ...form, client_id: form.client_id || null, colaborador_id: form.colaborador_id || null, categoria_id: form.categoria_id || null };
      if (editing) {
        const { error } = await supabase.from("lancamentos_financeiros").update(basePayload).eq("id", editing.id);
        if (error) throw error;
        return;
      }
      if (!recorrente) {
        const { error } = await supabase.from("lancamentos_financeiros").insert(await comOrganizacao(basePayload));
        if (error) throw error;
        return;
      }
      // recorrência: gera N (ou 24 para indefinida) lançamentos futuros com mesmo grupo
      const total = recTipo === "indefinida" ? 24 : Math.max(1, Math.min(120, Number(recMeses) || 1));
      const grupoId = crypto.randomUUID();
      const base = parseISODate(form.data_lancamento)!;
      const rows = Array.from({ length: total }).map((_, i) => {
        const d = new Date(base.getFullYear(), base.getMonth() + i, base.getDate());
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return {
          ...basePayload,
          data_lancamento: iso,
          recorrencia_grupo_id: grupoId,
          recorrencia_ativa: true,
          recorrencia_indefinida: recTipo === "indefinida",
        };
      });
      const { error } = await supabase.from("lancamentos_financeiros").insert(await comOrganizacao(rows));
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fluxo"] }); toast.success(recorrente && !editing ? "Recorrência criada" : "Salvo"); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addCat = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("categorias").insert(await comOrganizacao({ nome: novaCat, tipo: form.tipo })).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ["fluxo"] }); setForm({ ...form, categoria_id: d.id }); setNovaCat(""); toast.success("Categoria criada"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const isEntrada = form.tipo === "Entrada";

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{editing ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-5">
        {/* Tipo — Tabs */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1">
          <button type="button" onClick={() => setForm({ ...form, tipo: "Entrada", categoria_id: "" })}
            className={cn("rounded-md py-2 text-sm font-medium transition",
              isEntrada ? "bg-white text-emerald-700 shadow-sm" : "text-zinc-500 hover:text-zinc-800")}>
            Contas a Receber
          </button>
          <button type="button" onClick={() => setForm({ ...form, tipo: "Saída", categoria_id: "" })}
            className={cn("rounded-md py-2 text-sm font-medium transition",
              !isEntrada ? "bg-white text-rose-700 shadow-sm" : "text-zinc-500 hover:text-zinc-800")}>
            Contas a Pagar
          </button>
        </div>

        <div className="space-y-1.5">
          <Label>Descrição</Label>
          <Input placeholder="Fornecedor, cliente ou serviço" required
            value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Valor (R$)</Label>
            <Input
              type="text"
              inputMode="decimal"
              required
              placeholder="0,00"
              value={form.valor === 0 || form.valor === undefined || form.valor === null ? "" : String(form.valor).replace(".", ",")}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
                const n = raw === "" ? 0 : Number(raw);
                setForm({ ...form, valor: Number.isFinite(n) ? n : 0 });
              }}
            />

          </div>
          <div className="space-y-1.5">
            <Label>Data de Vencimento</Label>
            <Input type="date" required
              value={form.data_lancamento} onChange={(e) => setForm({ ...form, data_lancamento: e.target.value })} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Categoria</Label>
          <Select value={form.categoria_id} onValueChange={(v) => setForm({ ...form, categoria_id: v })}>
            <SelectTrigger><SelectValue placeholder="Selecionar categoria…" /></SelectTrigger>
            <SelectContent>
              {cats.filter((c) => c.tipo === form.tipo || c.tipo === "Ambos").map((c) =>
                <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex gap-2 pt-1">
            <Input placeholder="+ nova categoria" value={novaCat} onChange={(e) => setNovaCat(e.target.value)} className="h-8 text-xs" />
            <Button type="button" size="sm" variant="outline" disabled={!novaCat || addCat.isPending} onClick={() => addCat.mutate()}>Criar</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Status Inicial</Label>
            <Select value={form.status_pagamento} onValueChange={(v: any) => setForm({ ...form, status_pagamento: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Pendente">Pendente</SelectItem>
                <SelectItem value="Pago">Paga / Compensada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Conta Destino</Label>
            <div className="flex h-10 items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700">
              <span className="h-2 w-2 rounded-full" style={{ background: "#3FA535" }} />
              Sicredi PJ
            </div>
          </div>
        </div>

        {isEntrada && clis.length > 0 && (
          <div className="space-y-1.5">
            <Label>Cliente (opcional)</Label>
            <Select value={form.client_id || "none"} onValueChange={(v) => setForm({ ...form, client_id: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— nenhum —</SelectItem>
                {clis.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {!isEntrada && colabs.length > 0 && (
          <div className="space-y-1.5">
            <Label>Colaborador (opcional)</Label>
            <Select value={form.colaborador_id || "none"} onValueChange={(v) => setForm({ ...form, colaborador_id: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— nenhum —</SelectItem>
                {colabs.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {!editing && (
          <div className="rounded-lg border bg-zinc-50 p-3 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={recorrente} onCheckedChange={(v) => setRecorrente(!!v)} />
              <span className="text-sm font-medium">Lançamento recorrente</span>
            </label>
            {recorrente && (
              <>
                <div className="grid grid-cols-2 gap-1 rounded-md bg-white p-1 border">
                  <button type="button" onClick={() => setRecTipo("n_meses")}
                    className={cn("rounded py-1.5 text-xs font-medium transition",
                      recTipo === "n_meses" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-800")}>
                    Por N meses
                  </button>
                  <button type="button" onClick={() => setRecTipo("indefinida")}
                    className={cn("rounded py-1.5 text-xs font-medium transition",
                      recTipo === "indefinida" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-800")}>
                    Indefinida (até cancelar)
                  </button>
                </div>
                {recTipo === "n_meses" ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Quantidade de meses</Label>
                    <Input type="number" min={1} max={120} value={recMeses} onChange={(e) => setRecMeses(Number(e.target.value))} />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Serão geradas 24 parcelas mensais adiante. Você pode cancelar a recorrência a qualquer momento pelo menu do lançamento.
                  </p>
                )}
              </>
            )}
          </div>
        )}



        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}
            className={cn(isEntrada ? "bg-emerald-500 hover:bg-emerald-600" : "bg-rose-500 hover:bg-rose-600")}>
            Salvar Lançamento
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

