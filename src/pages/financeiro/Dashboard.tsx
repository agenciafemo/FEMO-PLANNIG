import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer, PageHeader, StatCard } from "@/components/financeiro/page";
import { formatBRL, monthKey, parseISODate, todayISO } from "@/lib/financeiro/format";
import { listarClientes } from "@/lib/financeiro/clientes";

export default function DashboardFinanceiro() {
  const { data } = useSuspenseQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [clientes, lanc, cfg] = await Promise.all([
        listarClientes(),
        supabase.from("lancamentos_financeiros").select("*"),
        supabase.from("configuracoes_financeiro").select("*").maybeSingle(),
      ]);
      return {
        clientes,
        lancamentos: lanc.data ?? [],
        config: cfg.data ?? { pct_rotativa: 60, pct_reserva: 40 },
      };
    },
  });

  const today = parseISODate(todayISO())!;
  const curKey = monthKey(today);
  const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevKey = monthKey(prevDate);

  const ativos = data.clientes.filter((c) => c.status === "Ativo");
  const recorrentes = ativos.filter((c) => c.is_recorrente);
  const pontuais = ativos.filter((c) => !c.is_recorrente);
  const mrr = recorrentes.reduce((s, c) => s + Number(c.valor_mensalidade), 0);
  const totalPontuais = pontuais.reduce((s, c) => s + Number(c.valor_mensalidade), 0);

  // Recebimentos do mês oriundos de clientes pontuais (não recorrentes)
  const pontuaisIds = new Set(pontuais.map((c) => c.id));
  const entradasPontuaisMes = data.lancamentos
    .filter((l) => l.tipo === "Entrada" && monthKey(l.data_lancamento) === curKey && l.client_id && pontuaisIds.has(l.client_id))
    .reduce((s, l) => s + Number(l.valor), 0);

  // Churn rate: clientes que mudaram p/ Churn no mês atual / ativos no mês anterior
  const churnedThisMonth = data.clientes.filter((c) => c.status === "Churn" && c.data_status_alterado && monthKey(c.data_status_alterado) === curKey).length;
  const activeStartOfMonth = data.clientes.filter((c) => {
    // estava ativo no mês anterior se: entrou antes do fim do mês anterior e (ainda ativo OR churn ocorreu no mês atual ou depois)
    const entrou = parseISODate(c.data_entrada)!;
    const endPrev = new Date(today.getFullYear(), today.getMonth(), 0);
    if (entrou > endPrev) return false;
    if (c.status === "Ativo") return true;
    if (c.data_status_alterado && parseISODate(c.data_status_alterado)! >= new Date(today.getFullYear(), today.getMonth(), 1)) return true;
    return false;
  }).length;
  const churnRate = activeStartOfMonth > 0 ? (churnedThisMonth / activeStartOfMonth) * 100 : 0;

  // Fluxo do mês (regime caixa = data_lancamento; considera Pago)
  const monthLanc = data.lancamentos.filter((l) => monthKey(l.data_lancamento) === curKey);
  const entradas = monthLanc.filter((l) => l.tipo === "Entrada" && l.status_pagamento === "Pago").reduce((s, l) => s + Number(l.valor), 0);
  const saidas = monthLanc.filter((l) => l.tipo === "Saída").reduce((s, l) => s + Number(l.valor), 0);
  const lucro = entradas - saidas;

  // Saldos acumulados (todos os meses)
  const totalEntradas = data.lancamentos.filter((l) => l.tipo === "Entrada" && l.status_pagamento === "Pago").reduce((s, l) => s + Number(l.valor), 0);
  const totalSaidas = data.lancamentos.filter((l) => l.tipo === "Saída").reduce((s, l) => s + Number(l.valor), 0);
  const lucroAcumulado = totalEntradas - totalSaidas;
  const rotativa = (lucroAcumulado * Number(data.config.pct_rotativa)) / 100;
  const reserva = (lucroAcumulado * Number(data.config.pct_reserva)) / 100;

  return (
    <PageContainer>
      <PageHeader title="Visão Geral" subtitle={`Mês de referência: ${new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric"}).format(today)}`} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="MRR (Recorrentes)" value={formatBRL(mrr)} hint={`${recorrentes.length} clientes recorrentes`} accent="primary" />
        <StatCard label="Clientes Pontuais" value={formatBRL(totalPontuais)} hint={`${pontuais.length} contratos avulsos · ${formatBRL(entradasPontuaisMes)} recebido no mês`} accent="success" />
        <StatCard label="Churn Rate (mês)" value={`${churnRate.toFixed(1)}%`} hint={`${churnedThisMonth} churn / ${activeStartOfMonth} base`} accent={churnRate > 5 ? "destructive" : "success"} />
        <StatCard label="Entradas do mês" value={formatBRL(entradas)} accent="success" />
        <StatCard label="Saídas do mês" value={formatBRL(saidas)} accent="destructive" />
      </div>

      <section className="mt-8 grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 rounded-xl border bg-surface p-6">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Lucro líquido do mês</div>
          <div className={`mt-3 text-3xl font-semibold tabular ${lucro >= 0 ? "text-success" : "text-destructive"}`}>{formatBRL(lucro)}</div>
          <p className="mt-2 text-xs text-muted-foreground">Entradas (regime de caixa, status Pago) menos Saídas do período.</p>
        </div>

        <div className="lg:col-span-2 rounded-xl border bg-surface p-6">
          <div className="flex items-end justify-between mb-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Distribuição acumulada</div>
              <div className="mt-1 text-sm text-muted-foreground">Lucro acumulado: <span className="tabular text-foreground font-medium">{formatBRL(lucroAcumulado)}</span></div>
            </div>
          </div>
          <DistRow label="Conta Rotativa" pct={Number(data.config.pct_rotativa)} value={rotativa} />
          <DistRow label="Reserva Estratégica" pct={Number(data.config.pct_reserva)} value={reserva} />
        </div>
      </section>
    </PageContainer>
  );
}

function DistRow({ label, pct, value }: { label: string; pct: number; value: number }) {
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular text-muted-foreground">{pct.toFixed(0)}% · <span className="text-foreground">{formatBRL(value)}</span></span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
