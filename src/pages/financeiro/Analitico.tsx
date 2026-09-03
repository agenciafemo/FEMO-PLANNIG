import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer, PageHeader, StatCard } from "@/components/financeiro/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatBRL, monthKey, monthsBetween, parseISODate, todayISO } from "@/lib/financeiro/format";
import { listarClientes } from "@/lib/financeiro/clientes";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export default function Analitico() {
  const { data } = useSuspenseQuery({
    queryKey: ["analitico"],
    queryFn: async () => {
      const [clientes, lanc, cats, cfg] = await Promise.all([
        listarClientes(),
        supabase.from("lancamentos_financeiros").select("*"),
        supabase.from("categorias").select("*"),
        supabase.from("configuracoes_financeiro").select("*").maybeSingle(),
      ]);
      return {
        clientes,
        lancamentos: lanc.data ?? [],
        categorias: cats.data ?? [],
        config: cfg.data ?? { pct_rotativa: 60, pct_reserva: 40 },
      };
    },
  });

  const today = parseISODate(todayISO())!;
  const anos = useMemo(() => {
    const set = new Set<number>([today.getFullYear()]);
    data.lancamentos.forEach((l) => set.add(parseISODate(l.data_lancamento)!.getFullYear()));
    // Cliente sem data de entrada preenchida (comum nos que acabaram de vir do
    // Norteia) tem data_entrada = "" — parseISODate("") devolve null, e o `!`
    // que estava aqui virava exatamente este crash. Sem data conhecida, o
    // cliente simplesmente não contribui um ano à lista.
    data.clientes.forEach((c) => {
      const entrada = parseISODate(c.data_entrada);
      if (entrada) set.add(entrada.getFullYear());
    });
    return [...set].sort((a, b) => b - a);
  }, [data, today]);

  const [ano, setAno] = useState<number>(today.getFullYear());
  const [mes, setMes] = useState<number>(today.getMonth());

  const catMap = useMemo(() => new Map(data.categorias.map((c) => [c.id, c])), [data.categorias]);

  // ===== Cards executivos =====
  const ativos = data.clientes.filter((c) => c.status === "Ativo");
  const mrr = ativos.reduce((s, c) => s + Number(c.valor_mensalidade), 0);
  const ticketMedio = ativos.length ? mrr / ativos.length : 0;

  const entradasPagas = data.lancamentos
    .filter((l) => l.tipo === "Entrada" && l.status_pagamento === "Pago")
    .reduce((s, l) => s + Number(l.valor), 0);
  const saidasPagas = data.lancamentos
    .filter((l) => l.tipo === "Saída" && l.status_pagamento === "Pago")
    .reduce((s, l) => s + Number(l.valor), 0);
  const lucroLiquidoReal = entradasPagas - saidasPagas;

  // LTV Comercial Estimado: ticket * tempo médio (meses) dos clientes ativos
  const tempoMedioMeses = ativos.length
    ? ativos.reduce((s, c) => s + monthsBetween(c.data_entrada, today), 0) / ativos.length
    : 0;
  const ltvComercial = ticketMedio * tempoMedioMeses;

  // ===== Série anual: Churn % e LT (meses) =====
  const serieAnual = useMemo(() => {
    return MESES.map((m, idx) => {
      const refIni = new Date(ano, idx, 1);
      const refFim = new Date(ano, idx + 1, 0);
      const ativosNoFim = data.clientes.filter((c) => {
        // Sem data de entrada não dá para saber se ele já estava ativo neste
        // mês — tratar como "ainda não" é o lado conservador do erro (LT
        // médio um pouco menor), nunca crashar a série inteira.
        const ent = parseISODate(c.data_entrada);
        if (!ent || ent > refFim) return false;
        if (c.status === "Ativo") return true;
        if (c.data_status_alterado && parseISODate(c.data_status_alterado)! > refFim) return true;
        return false;
      });
      const ativosNoIni = data.clientes.filter((c) => {
        const ent = parseISODate(c.data_entrada);
        const iniMinus1 = new Date(ano, idx, 0);
        if (!ent || ent > iniMinus1) return false;
        if (c.status === "Ativo") return true;
        if (c.data_status_alterado && parseISODate(c.data_status_alterado)! >= refIni) return true;
        return false;
      });
      const churnNoMes = data.clientes.filter(
        (c) => c.status === "Churn" && c.data_status_alterado && monthKey(c.data_status_alterado) === `${ano}-${String(idx + 1).padStart(2, "0")}`,
      ).length;
      const churnPct = ativosNoIni.length ? (churnNoMes / ativosNoIni.length) * 100 : 0;
      const ltMedio = ativosNoFim.length
        ? ativosNoFim.reduce((s, c) => s + monthsBetween(c.data_entrada, refFim), 0) / ativosNoFim.length
        : 0;
      return { mes: m, churn: Number(churnPct.toFixed(2)), lt: Number(ltMedio.toFixed(1)) };
    });
  }, [ano, data.clientes]);

  // ===== Série anual: Entradas vs Saídas + Lucro =====
  const serieFluxo = useMemo(() => {
    return MESES.map((m, idx) => {
      const key = `${ano}-${String(idx + 1).padStart(2, "0")}`;
      let entradas = 0;
      let saidas = 0;
      data.lancamentos.forEach((l) => {
        if (monthKey(l.data_lancamento) !== key) return;
        if (l.status_pagamento !== "Pago") return;
        const v = Number(l.valor);
        if (l.tipo === "Entrada") entradas += v;
        else if (l.tipo === "Saída") saidas += v;
      });
      return { mes: m, entradas, saidas, lucro: entradas - saidas };
    });
  }, [ano, data.lancamentos]);

  // ===== Distribuição do mês corrente =====
  const mesKey = `${ano}-${String(mes + 1).padStart(2, "0")}`;
  const lancMes = data.lancamentos.filter((l) => monthKey(l.data_lancamento) === mesKey && l.status_pagamento === "Pago");
  const entradasMes = lancMes.filter((l) => l.tipo === "Entrada").reduce((s, l) => s + Number(l.valor), 0);
  const saidasMes = lancMes.filter((l) => l.tipo === "Saída").reduce((s, l) => s + Number(l.valor), 0);
  const lucroMes = Math.max(0, entradasMes - saidasMes);

  const pctRot = Number(data.config?.pct_rotativa ?? 60);
  const pctRes = Number(data.config?.pct_reserva ?? 40);
  const rotativaVal = (lucroMes * pctRot) / 100;
  const reservaVal = (lucroMes * pctRes) / 100;
  const distribuicaoLucro = [
    { name: "Conta Rotativa", value: Number(rotativaVal.toFixed(2)), pct: pctRot },
    { name: "Reserva Estratégica", value: Number(reservaVal.toFixed(2)), pct: pctRes },
  ];

  // ===== Ranking saídas por categoria =====
  const rankingSaidas = useMemo(() => {
    const agg = new Map<string, number>();
    lancMes
      .filter((l) => l.tipo === "Saída")
      .forEach((l) => {
        const cat = (l.categoria_id && catMap.get(l.categoria_id)?.nome) || "Sem categoria";
        agg.set(cat, (agg.get(cat) ?? 0) + Number(l.valor));
      });
    return [...agg.entries()]
      .map(([categoria, valor]) => ({ categoria, valor: Number(valor.toFixed(2)) }))
      .sort((a, b) => b.valor - a.valor);
  }, [lancMes, catMap]);

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard Analítico"
        subtitle="Indicadores executivos, evolução anual e distribuição mensal"
        action={
          <div className="flex items-center gap-2">
            <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>{anos.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>{MESES.map((m, i) => <SelectItem key={m} value={String(i)}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        }
      />

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Faturamento Bruto (MRR)" value={formatBRL(mrr)} hint={`${ativos.length} clientes ativos`} accent="primary" />
        <StatCard label="Ticket Médio" value={formatBRL(ticketMedio)} hint="MRR / Ativos" />
        <StatCard label="Lucro Líquido Real" value={formatBRL(lucroLiquidoReal)} hint="Entradas pagas − Saídas pagas" accent={lucroLiquidoReal >= 0 ? "success" : "destructive"} />
        <StatCard label="LTV Comercial Estimado" value={formatBRL(ltvComercial)} hint={`Tempo médio: ${tempoMedioMeses.toFixed(1)} meses`} accent="primary" />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Churn Rate vs Tempo de Casa Médio (LT)" subtitle={`Evolução mensal — ${ano}`}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={serieAnual} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis yAxisId="l" stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `${v}%`} />
              <YAxis yAxisId="r" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `${v}m`} />
              <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="l" type="monotone" dataKey="churn" name="Churn %" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="r" type="monotone" dataKey="lt" name="LT (meses)" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Entradas, Saídas & Lucro Líquido" subtitle={`Mês a mês — ${ano}`}>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={serieFluxo} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v: number) => formatBRL(v)}
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="entradas" name="Entradas" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="saidas" name="Saídas" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="lucro" name="Lucro Líquido" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Distribuição do Lucro Líquido" subtitle={`${MESES[mes]}/${ano} — Lucro: ${formatBRL(lucroMes)}`}>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={distribuicaoLucro}
                dataKey="value"
                nameKey="name"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                label={(e: { pct: number }) => `${e.pct}%`}
              >
                <Cell fill="hsl(var(--primary))" />
                <Cell fill="hsl(var(--accent))" />
              </Pie>
              <Tooltip
                formatter={(v: number) => formatBRL(v)}
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Ranking de Saídas por Categoria" subtitle={`${MESES[mes]}/${ano}`}>
          {rankingSaidas.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">Sem saídas no período.</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(280, rankingSaidas.length * 36)}>
              <BarChart data={rankingSaidas} layout="vertical" margin={{ top: 8, right: 24, left: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="categoria" stroke="hsl(var(--muted-foreground))" fontSize={12} width={120} />
                <Tooltip
                  formatter={(v: number) => formatBRL(v)}
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="valor" name="Valor" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </section>
    </PageContainer>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-surface p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
