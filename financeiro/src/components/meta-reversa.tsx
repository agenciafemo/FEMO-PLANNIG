import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatCard } from "@/components/page";
import { formatBRL } from "@/lib/format";

type Vars = {
  meta: number;
  ticket: number;
  diasUteis: number;
  taxaResposta: number;
  taxaAgendamento: number;
  taxaFechamento: number;
};

const DEFAULTS: Vars = {
  meta: 30000,
  ticket: 2500,
  diasUteis: 22,
  taxaResposta: 10,
  taxaAgendamento: 30,
  taxaFechamento: 20,
};

const FIELDS: { key: keyof Vars; label: string; suffix?: string }[] = [
  { key: "meta", label: "Faturamento desejado (R$)" },
  { key: "ticket", label: "Ticket médio (R$)" },
  { key: "diasUteis", label: "Dias úteis no mês" },
  { key: "taxaResposta", label: "Taxa de resposta (%)" },
  { key: "taxaAgendamento", label: "Taxa de agendamento (%)" },
  { key: "taxaFechamento", label: "Taxa de fechamento (%)" },
];

export function MetaReversa() {
  const [v, setV] = useState<Vars>(DEFAULTS);
  const set = (k: keyof Vars, raw: string) => {
    const n = Number(raw.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", "."));
    setV((p) => ({ ...p, [k]: Number.isFinite(n) ? n : 0 }));
  };

  const r = useMemo(() => {
    const fechamentos = v.ticket > 0 ? Math.ceil(v.meta / v.ticket) : 0;
    const reunioes = v.taxaFechamento > 0 ? Math.ceil(fechamentos / (v.taxaFechamento / 100)) : 0;
    const respostas = v.taxaAgendamento > 0 ? Math.ceil(reunioes / (v.taxaAgendamento / 100)) : 0;
    const leads = v.taxaResposta > 0 ? Math.ceil(respostas / (v.taxaResposta / 100)) : 0;
    const dias = Math.max(1, v.diasUteis);
    const dmsDia = Math.ceil(leads / dias);
    const reunioesSemana = Math.round((reunioes / dias) * 5 * 10) / 10;
    const faturamentoReal = fechamentos * v.ticket;

    let tone: "success" | "warning" | "destructive" = "success";
    let diagnostico =
      "Ritmo saudável: as taxas informadas sustentam a meta dentro da faixa verde (até ~25 DMs/dia).";
    if (dmsDia > 40) {
      tone = "destructive";
      diagnostico =
        "Gargalo crítico: o volume diário exigido está acima da capacidade operacional. É preciso subir ticket médio, melhorar copy de abordagem (taxa de resposta) ou adicionar mais um canal/SDR.";
    } else if (dmsDia > 25) {
      tone = "warning";
      diagnostico =
        "Atenção: o volume diário passa da faixa verde de 25 DMs/dia. Tracione a taxa de resposta ou o ticket médio para reduzir o esforço bruto.";
    }
    if (v.taxaResposta < 5 || v.taxaFechamento < 10) {
      tone = "destructive";
      diagnostico =
        "Taxas insuficientes: resposta abaixo de 5% ou fechamento abaixo de 10% indicam problema de qualificação/pitch, não de volume. Corrija a conversão antes de aumentar DMs.";
    }
    return { fechamentos, reunioes, respostas, leads, dmsDia, reunioesSemana, faturamentoReal, tone, diagnostico };
  }, [v]);

  const toneClass =
    r.tone === "success"
      ? "border-l-success text-success"
      : r.tone === "warning"
        ? "border-l-warning text-warning"
        : "border-l-destructive text-destructive";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-surface p-5">
        <h2 className="text-lg font-semibold">Variáveis do mês</h2>
        <p className="text-sm text-muted-foreground">
          Informe metas e taxas atuais para a engenharia reversa do funil B2B.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-2">
              <Label>{f.label}</Label>
              <Input
                inputMode="decimal"
                className="tabular"
                value={String(v[f.key])}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Metas macro</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Contratos a fechar" value={r.fechamentos} accent="primary" />
          <StatCard label="Faturamento projetado" value={formatBRL(r.faturamentoReal)} accent="success" hint={`Meta: ${formatBRL(v.meta)}`} />
          <StatCard label="Ticket médio" value={formatBRL(v.ticket)} />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Engenharia reversa do funil
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Leads no topo do funil" value={r.leads} hint="Novos leads no mês" />
          <StatCard label="Respostas necessárias" value={r.respostas} hint={`${v.taxaResposta}% de resposta`} />
          <StatCard label="Reuniões / propostas" value={r.reunioes} accent="warning" hint={`${v.taxaAgendamento}% de agendamento`} />
          <StatCard label="Fechamentos" value={r.fechamentos} accent="success" hint={`${v.taxaFechamento}% de fechamento`} />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Ritmo diário de aceleração
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="DMs / abordagens por dia" value={r.dmsDia} accent="primary" hint={`${v.diasUteis} dias úteis`} />
          <StatCard label="Respostas por dia" value={Math.ceil(r.respostas / Math.max(1, v.diasUteis))} />
          <StatCard label="Reuniões por semana" value={r.reunioesSemana} accent="warning" />
          <StatCard label="Conexões novas / dia" value={Math.ceil(r.dmsDia * 1.5)} hint="Aquecimento e engajamento" />
        </div>
      </div>

      <div className={`rounded-xl border border-l-4 bg-surface p-5 ${toneClass}`}>
        <h3 className="text-sm font-semibold">Diagnóstico de saúde</h3>
        <p className="mt-2 text-sm text-muted-foreground">{r.diagnostico}</p>
      </div>
    </div>
  );
}
