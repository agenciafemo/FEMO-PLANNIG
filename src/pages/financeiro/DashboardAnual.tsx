import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Suspense, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer, PageHeader, StatCard } from "@/components/financeiro/page";
import { formatBRL } from "@/lib/financeiro/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Pencil, Plus } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Line, ComposedChart } from "recharts";

type Row = {
  id: string;
  ano: number;
  mes: number;
  receitas: number;
  despesas: number;
  retirada: number;
  observacao: string | null;
};

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export default function DashboardAnual() {
  const qc = useQueryClient();
  const [anoSel, setAnoSel] = useState<number>(new Date().getFullYear());
  const [editing, setEditing] = useState<Partial<Row> | null>(null);

  const { data } = useSuspenseQuery({
    queryKey: ["dashboard-anual"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("dashboard_anual")
        .select("*")
        .order("ano", { ascending: true })
        .order("mes", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const anos = useMemo(() => {
    const set = new Set(data.map((r) => r.ano));
    set.add(new Date().getFullYear());
    return Array.from(set).sort();
  }, [data]);

  const rowsAno = useMemo(() => {
    const map = new Map(data.filter((r) => r.ano === anoSel).map((r) => [r.mes, r] as const));
    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const r = map.get(m);
      return r ?? { id: "", ano: anoSel, mes: m, receitas: 0, despesas: 0, retirada: 20000, observacao: null };
    });
  }, [data, anoSel]);

  const totals = rowsAno.reduce(
    (acc, r) => {
      const saldo = Number(r.receitas) - Number(r.despesas);
      const lucro = saldo - Number(r.retirada);
      acc.receitas += Number(r.receitas);
      acc.despesas += Number(r.despesas);
      acc.retirada += Number(r.retirada);
      acc.saldo += saldo;
      acc.lucro += lucro;
      return acc;
    },
    { receitas: 0, despesas: 0, retirada: 0, saldo: 0, lucro: 0 },
  );

  const chartData = rowsAno.map((r) => {
    const saldo = Number(r.receitas) - Number(r.despesas);
    return {
      mes: MESES[r.mes - 1],
      Receitas: Number(r.receitas),
      Despesas: Number(r.despesas),
      "Lucro Real": saldo - Number(r.retirada),
    };
  });

  const saveMut = useMutation({
    mutationFn: async (row: Partial<Row>) => {
      const payload = {
        ano: row.ano,
        mes: row.mes,
        receitas: Number(row.receitas ?? 0),
        despesas: Number(row.despesas ?? 0),
        retirada: Number(row.retirada ?? 20000),
        observacao: row.observacao ?? null,
      };
      if (row.id) {
        const { error } = await (supabase as any).from("dashboard_anual").update(payload).eq("id", row.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("dashboard_anual").upsert(payload, { onConflict: "ano,mes" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard-anual"] });
      setEditing(null);
    },
  });

  return (
    <PageContainer>
      <PageHeader title="Dashboard Anual" subtitle="Resumo mensal de receitas, despesas, retirada e lucro real. Edite para incluir retroativos." />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Label className="text-sm">Ano:</Label>
        {anos.map((a) => (
          <Button key={a} size="sm" variant={a === anoSel ? "default" : "outline"} onClick={() => setAnoSel(a)}>
            {a}
          </Button>
        ))}
        <Button size="sm" variant="outline" onClick={() => setAnoSel(anoSel + 1)}>+ {anoSel + 1}</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-5 mb-6">
        <StatCard label="Receitas" value={formatBRL(totals.receitas)} />
        <StatCard label="Despesas" value={formatBRL(totals.despesas)} />
        <StatCard label="Saldo Líquido" value={formatBRL(totals.saldo)} />
        <StatCard label="Retirada" value={formatBRL(totals.retirada)} />
        <StatCard label="Lucro Real" value={formatBRL(totals.lucro)} />
      </div>

      <div className="rounded-lg border bg-card p-4 mb-6">
        <div className="text-sm font-medium mb-2">Evolução {anoSel}</div>
        <div className="h-72">
          <ResponsiveContainer>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="mes" />
              <YAxis tickFormatter={(v) => `R$ ${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => formatBRL(v)} />
              <Legend />
              <Bar dataKey="Receitas" fill="#10b981" />
              <Bar dataKey="Despesas" fill="#ef4444" />
              <Line type="monotone" dataKey="Lucro Real" stroke="#3b82f6" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="text-sm font-medium">Detalhamento mensal</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Mês</th>
                <th className="text-right px-4 py-2">Receitas</th>
                <th className="text-right px-4 py-2">Despesas</th>
                <th className="text-right px-4 py-2">Saldo Líquido</th>
                <th className="text-right px-4 py-2">Retirada</th>
                <th className="text-right px-4 py-2">Lucro Real</th>
                <th className="px-4 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rowsAno.map((r) => {
                const saldo = Number(r.receitas) - Number(r.despesas);
                const lucro = saldo - Number(r.retirada);
                const vazio = !r.id;
                return (
                  <tr key={r.mes} className={`border-t ${vazio ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2 font-medium">{MESES[r.mes - 1]}/{anoSel}</td>
                    <td className="px-4 py-2 text-right">{formatBRL(r.receitas)}</td>
                    <td className="px-4 py-2 text-right">{formatBRL(r.despesas)}</td>
                    <td className="px-4 py-2 text-right">{formatBRL(saldo)}</td>
                    <td className="px-4 py-2 text-right">{formatBRL(r.retirada)}</td>
                    <td className={`px-4 py-2 text-right font-medium ${lucro < 0 ? "text-red-600" : "text-emerald-600"}`}>{formatBRL(lucro)}</td>
                    <td className="px-4 py-2">
                      <Button size="icon" variant="ghost" onClick={() => setEditing(r)}>
                        {vazio ? <Plus className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? `${MESES[(editing.mes ?? 1) - 1]}/${editing.ano}` : ""}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div>
                <Label>Receitas</Label>
                <Input type="number" step="0.01" value={editing.receitas ?? 0}
                  onChange={(e) => setEditing({ ...editing, receitas: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Despesas</Label>
                <Input type="number" step="0.01" value={editing.despesas ?? 0}
                  onChange={(e) => setEditing({ ...editing, despesas: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Retirada (Pró-labore)</Label>
                <Input type="number" step="0.01" value={editing.retirada ?? 20000}
                  onChange={(e) => setEditing({ ...editing, retirada: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Observação</Label>
                <Input value={editing.observacao ?? ""}
                  onChange={(e) => setEditing({ ...editing, observacao: e.target.value })} />
              </div>
              <div className="text-xs text-muted-foreground">
                Saldo Líquido: <b>{formatBRL((Number(editing.receitas) || 0) - (Number(editing.despesas) || 0))}</b> ·
                Lucro Real: <b>{formatBRL((Number(editing.receitas) || 0) - (Number(editing.despesas) || 0) - (Number(editing.retirada) || 0))}</b>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button disabled={saveMut.isPending} onClick={() => editing && saveMut.mutate(editing)}>
              {saveMut.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
