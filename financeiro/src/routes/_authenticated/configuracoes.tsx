import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { carregarConfig, salvarConfig } from "@/lib/configuracoes";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({ meta: [{ title: "Configurações — FEMO FINANÇAS" }] }),
  component: () => (
    <Suspense fallback={<PageContainer>Carregando…</PageContainer>}>
      <Configuracoes />
    </Suspense>
  ),
});

type LtvRow = { id: string; meses_min: number; meses_max: number | null; percentual: number; funcao_id: string | null };
type Funcao = { id: string; nome: string; tipo_base: string; descricao: string | null };

function Configuracoes() {
  return (
    <PageContainer>
      <PageHeader title="Configurações" subtitle="Aparência, importação, regras de comissão e penalidades" />
      <div className="grid gap-6 lg:grid-cols-2">
        <ImportacaoMeuDinheiro />
        <DistribuicaoLucro />
        <PenalidadeAtraso />
        <PenalidadeChurn />
        <div className="lg:col-span-2"><FuncoesComissao /></div>
        <div className="lg:col-span-2"><TabelaLTV /></div>
      </div>
    </PageContainer>
  );
}

// A seção de Aparência saiu: cores e logo eram colunas de `configuracoes`, que
// deixaram de existir. A identidade visual é a do Norteia — um segundo lugar
// para trocar a mesma cor garante que uma hora as duas telas divergem.

function normalizeHeader(h: string): string {
  return (h ?? "").replace(/^\uFEFF/, "").trim();
}

function findHeader(headers: string[], ...needles: string[]): string {
  return (
    headers.find((h) =>
      needles.some((n) =>
        h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(n),
      ),
    ) ?? ""
  );
}

function parseDateBR(s: string): string | null {
  if (!s) return null;
  const v = String(s).trim().replace(/^\uFEFF/, "").split(/[ T]/)[0];
  if (!v) return null;
  let m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return v;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseValorBR(s: string | number | null | undefined): number {
  if (s === null || s === undefined || s === "") return 0;
  if (typeof s === "number") return s;
  let str = String(s).trim().replace(/^\uFEFF/, "");
  const negativo = /^\(.*\)$/.test(str) || /^-/.test(str);
  str = str.replace(/[R$\s()]/gi, "").replace(/^-/, "");
  if (str.includes(",")) str = str.replace(/\./g, "").replace(",", ".");
  const n = Number(str);
  if (isNaN(n)) return 0;
  return negativo ? -n : n;
}

async function readFileWithEncoding(file: File, encoding: string): Promise<string> {
  const buf = await file.arrayBuffer();
  return new TextDecoder(encoding, { fatal: false }).decode(buf);
}

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function ImportacaoMeuDinheiro() {
  const qc = useQueryClient();
  const [normalized, setNormalized] = useState<NormalRow[]>([]);
  const [skipped, setSkipped] = useState<number>(0);
  const [fileName, setFileName] = useState("");
  const [encoding, setEncoding] = useState<"utf-8" | "iso-8859-1">("utf-8");
  const [busy, setBusy] = useState(false);
  const [rawFile, setRawFile] = useState<File | null>(null);

  const reparse = async (file: File, enc: string) => {
    const Papa = (await import("papaparse")).default;
    const text = await readFileWithEncoding(file, enc);
    Papa.parse<ParsedRow>(text, {
      header: true,
      skipEmptyLines: "greedy",
      delimitersToGuess: [",", ";", "\t", "|"],
      transformHeader: normalizeHeader,
      complete: (res) => {
        const hs = (res.meta.fields ?? []).map(normalizeHeader).filter(Boolean);
        const colData = findHeader(hs, "data", "vencimento", "pagamento", "competencia", "dt");
        const colDesc = findHeader(hs, "descri", "histor", "cliente", "memo", "obs", "titulo", "nome", "estabelec");
        const colValor = findHeader(hs, "valor", "montante", "amount", "preco", "preço", "total");
        const colTipo = findHeader(hs, "tipo", "natureza", "operacao", "operação");

        const norm: NormalRow[] = [];
        let sk = 0;
        (res.data ?? []).forEach((row) => {
          const r: ParsedRow = {};
          for (const k of Object.keys(row ?? {})) r[normalizeHeader(k)] = (row as Record<string, string>)[k];
          const dataRaw = (r[colData] ?? "").toString().trim();
          const valorRawStr = (r[colValor] ?? "").toString().trim();
          const descricao = (colDesc ? (r[colDesc] ?? "") : "").toString().trim() || "Lançamento";
          const data = parseDateBR(dataRaw);
          if (!data || valorRawStr === "") { sk++; return; }
          let valor = parseValorBR(valorRawStr);
          if (!valor) { sk++; return; }
          const tipoRaw = colTipo ? (r[colTipo] ?? "").toString() : "";
          const tipo: "Entrada" | "Saída" = tipoRaw
            ? (/entrada|receita|credito|crédito|recebimento|positiv/i.test(tipoRaw) ? "Entrada" : "Saída")
            : (valor >= 0 ? "Entrada" : "Saída");
          norm.push({ descricao, valor: Math.abs(valor), data, tipo });
        });
        setNormalized(norm);
        setSkipped(sk);
      },
      error: (err: Error) => toast.error(err.message),
    });
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setRawFile(file);
    await reparse(file, encoding);
  };

  const onEncodingChange = async (enc: "utf-8" | "iso-8859-1") => {
    setEncoding(enc);
    if (rawFile) await reparse(rawFile, enc);
  };

  const importar = async () => {
    if (normalized.length === 0) return;
    setBusy(true);
    try {
      const { data: existing } = await supabase.from("categorias").select("id,nome");
      let catImportadoId = existing?.find((c) => c.nome.toLowerCase() === "importado")?.id ?? null;
      if (!catImportadoId) {
        const { data: novo } = await supabase.from("categorias").insert({ nome: "Importado", tipo: "Ambos" }).select("id").single();
        catImportadoId = novo?.id ?? null;
      }

      const payload = normalized.map((r) => ({
        tipo: r.tipo,
        categoria_id: catImportadoId,
        descricao: r.descricao,
        data_lancamento: r.data,
        valor: r.valor,
        status_pagamento: "Pago" as const,
      }));

      const chunkSize = 200;
      for (let i = 0; i < payload.length; i += chunkSize) {
        const { error } = await supabase.from("lancamentos_financeiros").insert(payload.slice(i, i + chunkSize));
        if (error) throw error;
      }
      qc.invalidateQueries();
      toast.success(`${payload.length} lançamento(s) salvos no fluxo (Sicredi PJ)`);
      setNormalized([]); setFileName(""); setRawFile(null); setSkipped(0);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  const preview = normalized.slice(0, 50);
  const totalEntradas = normalized.filter((r) => r.tipo === "Entrada").reduce((s, r) => s + r.valor, 0);
  const totalSaidas = normalized.filter((r) => r.tipo === "Saída").reduce((s, r) => s + r.valor, 0);

  return (
    <div className="rounded-xl border bg-surface p-6 space-y-5 lg:col-span-2">
      <div>
        <h3 className="font-semibold">Importar CSV — App Meu Dinheiro</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Envie o CSV e valide a pré-visualização abaixo. Tudo será lançado na conta única <strong>Sicredi PJ</strong>.
        </p>
      </div>
      <div className="grid sm:grid-cols-[1fr_200px] gap-3">
        <Input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        <Select value={encoding} onValueChange={(v: "utf-8" | "iso-8859-1") => onEncodingChange(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="utf-8">UTF-8</SelectItem>
            <SelectItem value="iso-8859-1">ISO-8859-1 (Latin-1)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {normalized.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border bg-surface-2 p-3">
              <div className="text-xs text-muted-foreground">Linhas válidas</div>
              <div className="text-lg font-semibold tabular">{normalized.length}{skipped > 0 && <span className="text-xs text-muted-foreground font-normal"> · {skipped} ignorada(s)</span>}</div>
            </div>
            <div className="rounded-lg border bg-surface-2 p-3">
              <div className="text-xs text-muted-foreground">Entradas</div>
              <div className="text-lg font-semibold tabular text-emerald-600">{formatBRL(totalEntradas)}</div>
            </div>
            <div className="rounded-lg border bg-surface-2 p-3">
              <div className="text-xs text-muted-foreground">Saídas</div>
              <div className="text-lg font-semibold tabular text-rose-600">{formatBRL(totalSaidas)}</div>
            </div>
          </div>

          <div className="rounded-lg border bg-surface overflow-hidden">
            <div className="px-4 py-2 border-b bg-surface-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Pré-visualização ({preview.length} de {normalized.length})
            </div>
            <div className="max-h-[420px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-surface z-10">
                  <TableRow>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="w-28">Data</TableHead>
                    <TableHead className="w-28">Tipo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{r.descricao}</TableCell>
                      <TableCell className={`text-right tabular ${r.tipo === "Entrada" ? "text-emerald-600" : "text-rose-600"}`}>
                        {r.tipo === "Entrada" ? "+ " : "− "}{formatBRL(r.valor)}
                      </TableCell>
                      <TableCell className="tabular text-muted-foreground">
                        {r.data.split("-").reverse().join("/")}
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded ${r.tipo === "Entrada" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                          {r.tipo}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      <div className="flex gap-2">
        <Button onClick={importar} disabled={busy || normalized.length === 0}>
          {busy ? "Salvando…" : `Confirmar carga e salvar no Fluxo (${normalized.length})`}
        </Button>
        {normalized.length > 0 && (
          <Button variant="ghost" onClick={() => { setNormalized([]); setFileName(""); setRawFile(null); setSkipped(0); }}>Limpar</Button>
        )}
      </div>
      {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
    </div>
  );
}

function DistribuicaoLucro() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery({
    queryKey: ["config"],
    queryFn: carregarConfig,
  });
  const [rot, setRot] = useState<number>(Number(data.pct_rotativa));
  const [res, setRes] = useState<number>(Number(data.pct_reserva));
  useEffect(() => { setRot(Number(data.pct_rotativa)); setRes(Number(data.pct_reserva)); }, [data]);

  const total = rot + res;
  const save = useMutation({
    mutationFn: async () => {
      if (Math.abs(total - 100) > 0.01) throw new Error("A soma deve ser 100%.");
      await salvarConfig({ pct_rotativa: rot, pct_reserva: res });
    },
    onSuccess: () => { qc.invalidateQueries(); toast.success("Configurações salvas"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-xl border bg-surface p-6 space-y-5">
      <div>
        <h3 className="font-semibold">Distribuição do Lucro Líquido</h3>
        <p className="text-sm text-muted-foreground mt-1">Como o lucro mensal é dividido. A soma deve ser 100%.</p>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <div className="space-y-1.5">
          <Label>Conta Rotativa (operacional)</Label>
          <div className="flex items-center gap-2">
            <Input type="number" step="0.01" min="0" max="100" value={rot} onChange={(e) => setRot(Number(e.target.value))} className="tabular" />
            <span className="text-muted-foreground">%</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Reserva Estratégica (caixa)</Label>
          <div className="flex items-center gap-2">
            <Input type="number" step="0.01" min="0" max="100" value={res} onChange={(e) => setRes(Number(e.target.value))} className="tabular" />
            <span className="text-muted-foreground">%</span>
          </div>
        </div>
        <div className={`text-sm tabular ${Math.abs(total - 100) < 0.01 ? "text-success" : "text-destructive"}`}>
          Total: {total.toFixed(2)}%
        </div>
        <Button type="submit" disabled={save.isPending || Math.abs(total - 100) > 0.01}>Salvar</Button>
      </form>
    </div>
  );
}

function PenalidadeAtraso() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery({
    queryKey: ["config"],
    queryFn: carregarConfig,
  });
  const [pct, setPct] = useState<number>(Number(data.pct_penalidade_atraso));
  useEffect(() => setPct(Number(data.pct_penalidade_atraso)), [data]);

  const save = useMutation({
    mutationFn: async () => {
      await salvarConfig({ pct_penalidade_atraso: pct });
    },
    onSuccess: () => { qc.invalidateQueries(); toast.success("Penalidade atualizada"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-xl border bg-surface p-6 space-y-5">
      <div>
        <h3 className="font-semibold">Penalidade por Atraso (Social Media)</h3>
        <p className="text-sm text-muted-foreground mt-1">O planejamento do cliente deve ser entregue até o <strong>dia 25</strong> de cada mês. Entregas após essa data aplicam a redução abaixo sobre a comissão do mês. Padrão: 60%.</p>
        <div className="mt-3 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          <div className="font-medium text-foreground mb-1">Tabela de comissão Social Media (sobre o valor da mensalidade do cliente)</div>
          <ul className="grid grid-cols-2 gap-y-0.5">
            <li>0 a 6 meses</li><li className="tabular">1%</li>
            <li>6 a 18 meses</li><li className="tabular">2%</li>
            <li>18 a 36 meses</li><li className="tabular">3%</li>
            <li>Acima de 36 meses</li><li className="tabular">4%</li>
          </ul>
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <div className="space-y-1.5">
          <Label>Redução da comissão</Label>
          <div className="flex items-center gap-2">
            <Input type="number" step="0.01" min="0" max="100" value={pct} onChange={(e) => setPct(Number(e.target.value))} className="tabular" />
            <span className="text-muted-foreground">%</span>
          </div>
        </div>
        <Button type="submit" disabled={save.isPending}>Salvar</Button>
      </form>
    </div>
  );
}

function PenalidadeChurn() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery({
    queryKey: ["config"],
    queryFn: carregarConfig,
  });
  const [pct, setPct] = useState<number>(Number((data as { pct_penalidade_churn?: number }).pct_penalidade_churn ?? 100));
  useEffect(() => setPct(Number((data as { pct_penalidade_churn?: number }).pct_penalidade_churn ?? 100)), [data]);

  const save = useMutation({
    mutationFn: async () => {
      await salvarConfig({ pct_penalidade_churn: pct });
    },
    onSuccess: () => { qc.invalidateQueries(); toast.success("Penalidade de churn atualizada"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-xl border bg-surface p-6 space-y-5">
      <div>
        <h3 className="font-semibold">Penalidade por Churn (todos os colaboradores)</h3>
        <p className="text-sm text-muted-foreground mt-1">Quando um cliente é marcado como inadimplente/churn, este percentual da comissão é estornado de <strong>todos</strong> os colaboradores vinculados ao contrato no mês seguinte.</p>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <div className="space-y-1.5">
          <Label>Percentual de estorno da comissão</Label>
          <div className="flex items-center gap-2">
            <Input type="number" step="0.01" min="0" max="100" value={pct} onChange={(e) => setPct(Number(e.target.value))} className="tabular" />
            <span className="text-muted-foreground">%</span>
          </div>
          <p className="text-xs text-muted-foreground">100% = estorno integral da comissão de todos os colaboradores do cliente.</p>
        </div>
        <Button type="submit" disabled={save.isPending}>Salvar</Button>
      </form>
    </div>
  );
}

function TabelaLTV() {
  const qc = useQueryClient();
  const { data: rows } = useSuspenseQuery({
    queryKey: ["ltv", "padrao"],
    queryFn: async () => ((await supabase.from("tabela_progressiva_ltv").select("*").is("funcao_id", null).order("meses_min")).data ?? []) as LtvRow[],
  });
  const [novo, setNovo] = useState({ meses_min: 0, meses_max: "" as string, percentual: 0 });

  const add = useMutation({
    mutationFn: async () => {
      const payload = {
        meses_min: Number(novo.meses_min),
        meses_max: novo.meses_max === "" ? null : Number(novo.meses_max),
        percentual: Number(novo.percentual),
      };
      const { error } = await supabase.from("tabela_progressiva_ltv").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ltv"] }); setNovo({ meses_min: 0, meses_max: "", percentual: 0 }); toast.success("Faixa adicionada"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async (r: LtvRow) => {
      const { error } = await supabase.from("tabela_progressiva_ltv").update({ meses_min: r.meses_min, meses_max: r.meses_max, percentual: r.percentual }).eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ltv"] }); toast.success("Atualizado"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("tabela_progressiva_ltv").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ltv"] }),
  });

  return (
    <div className="rounded-xl border bg-surface p-6 space-y-5">
      <div>
        <h3 className="font-semibold">Tabela Progressiva de LTV (padrão)</h3>
        <p className="text-sm text-muted-foreground mt-1">Faixas usadas quando o colaborador não tem uma função personalizada com tabela própria. Deixe "Meses máx." em branco para faixa sem limite superior.</p>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Meses mín.</TableHead>
              <TableHead>Meses máx.</TableHead>
              <TableHead>Comissão (%)</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">Nenhuma faixa cadastrada.</TableCell></TableRow>}
            {rows.map((r) => <LtvEditableRow key={r.id} row={r} onSave={(v) => update.mutate(v)} onDelete={() => del.mutate(r.id)} />)}
          </TableBody>
        </Table>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="flex gap-2 items-end flex-wrap">
        <div className="w-32"><Label className="text-xs">Meses mín.</Label><Input type="number" min="0" required value={novo.meses_min} onChange={(e) => setNovo({ ...novo, meses_min: Number(e.target.value) })} /></div>
        <div className="w-32"><Label className="text-xs">Meses máx.</Label><Input type="number" min="0" placeholder="∞" value={novo.meses_max} onChange={(e) => setNovo({ ...novo, meses_max: e.target.value })} /></div>
        <div className="w-32"><Label className="text-xs">Comissão (%)</Label><Input type="number" step="0.01" min="0" max="100" required value={novo.percentual} onChange={(e) => setNovo({ ...novo, percentual: Number(e.target.value) })} /></div>
        <Button type="submit" size="sm"><Plus className="h-4 w-4 mr-1" />Adicionar faixa</Button>
      </form>
    </div>
  );
}

function LtvEditableRow({ row, onSave, onDelete }: { row: LtvRow; onSave: (r: LtvRow) => void; onDelete: () => void }) {
  const [v, setV] = useState(row);
  useEffect(() => setV(row), [row]);
  const dirty = v.meses_min !== row.meses_min || v.meses_max !== row.meses_max || Number(v.percentual) !== Number(row.percentual);
  return (
    <TableRow>
      <TableCell><Input type="number" min="0" value={v.meses_min} onChange={(e) => setV({ ...v, meses_min: Number(e.target.value) })} className="w-24 tabular" /></TableCell>
      <TableCell><Input type="number" min="0" placeholder="∞" value={v.meses_max ?? ""} onChange={(e) => setV({ ...v, meses_max: e.target.value === "" ? null : Number(e.target.value) })} className="w-24 tabular" /></TableCell>
      <TableCell><Input type="number" step="0.01" min="0" max="100" value={v.percentual} onChange={(e) => setV({ ...v, percentual: Number(e.target.value) })} className="w-28 tabular" /></TableCell>
      <TableCell>
        <div className="flex gap-1 justify-end">
          {dirty && <Button size="sm" onClick={() => onSave(v)}>Salvar</Button>}
          <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

const TIPO_BASE_LABEL: Record<string, string> = {
  mensalidade_total: "Mensalidade total do cliente",
  fatia_social_media: "Fatia % de Social Media",
  fatia_trafego: "Fatia % de Tráfego",
};

function FuncoesComissao() {
  const qc = useQueryClient();
  const { data: funcoes } = useSuspenseQuery({
    queryKey: ["funcoes"],
    queryFn: async () => ((await supabase.from("funcoes").select("*").order("nome")).data ?? []) as Funcao[],
  });
  const { data: ltvAll } = useSuspenseQuery({
    queryKey: ["ltv", "por-funcao"],
    queryFn: async () => ((await supabase.from("tabela_progressiva_ltv").select("*").not("funcao_id", "is", null).order("meses_min")).data ?? []) as LtvRow[],
  });

  const [novo, setNovo] = useState({ nome: "", tipo_base: "mensalidade_total" });
  const add = useMutation({
    mutationFn: async () => {
      if (!novo.nome.trim()) throw new Error("Informe o nome da função.");
      const { error } = await supabase.from("funcoes").insert(novo);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["funcoes"] }); setNovo({ nome: "", tipo_base: "mensalidade_total" }); toast.success("Função criada"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delF = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("funcoes").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["funcoes"] }); qc.invalidateQueries({ queryKey: ["ltv"] }); toast.success("Função removida"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-xl border bg-surface p-6 space-y-5">
      <div>
        <h3 className="font-semibold">Funções de comissão personalizadas</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Crie funções (ex.: Social Media 1, 2, 3) com base de cálculo e tabela progressiva próprias. Colaboradores vinculados a uma função usam essa tabela em vez da tabela padrão.
        </p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="flex gap-2 items-end flex-wrap border-b pb-4">
        <div className="w-56"><Label className="text-xs">Nome da função</Label><Input required value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Social Media 2" /></div>
        <div className="w-64">
          <Label className="text-xs">Base de cálculo</Label>
          <Select value={novo.tipo_base} onValueChange={(v) => setNovo({ ...novo, tipo_base: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(TIPO_BASE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" size="sm"><Plus className="h-4 w-4 mr-1" />Adicionar função</Button>
      </form>

      {funcoes.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma função personalizada cadastrada.</p>}
      <div className="space-y-6">
        {funcoes.map((f) => (
          <FuncaoBlock key={f.id} funcao={f} rows={ltvAll.filter((r) => r.funcao_id === f.id)} onDelete={() => { if (confirm(`Remover função ${f.nome}? A tabela dela também será apagada.`)) delF.mutate(f.id); }} />
        ))}
      </div>
    </div>
  );
}

function FuncaoBlock({ funcao, rows, onDelete }: { funcao: Funcao; rows: LtvRow[]; onDelete: () => void }) {
  const qc = useQueryClient();
  const [novo, setNovo] = useState({ meses_min: 0, meses_max: "" as string, percentual: 0 });

  const add = useMutation({
    mutationFn: async () => {
      const payload = { meses_min: Number(novo.meses_min), meses_max: novo.meses_max === "" ? null : Number(novo.meses_max), percentual: Number(novo.percentual), funcao_id: funcao.id };
      const { error } = await supabase.from("tabela_progressiva_ltv").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ltv"] }); setNovo({ meses_min: 0, meses_max: "", percentual: 0 }); toast.success("Faixa adicionada"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async (r: LtvRow) => {
      const { error } = await supabase.from("tabela_progressiva_ltv").update({ meses_min: r.meses_min, meses_max: r.meses_max, percentual: r.percentual }).eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ltv"] }); toast.success("Atualizado"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("tabela_progressiva_ltv").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ltv"] }),
  });

  return (
    <div className="rounded-lg border bg-surface-2 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">{funcao.nome}</div>
          <div className="text-xs text-muted-foreground">Base: {TIPO_BASE_LABEL[funcao.tipo_base] ?? funcao.tipo_base}</div>
        </div>
        <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
      </div>
      <div className="rounded-md border bg-surface overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Meses mín.</TableHead>
              <TableHead>Meses máx.</TableHead>
              <TableHead>Comissão (%)</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground text-xs">Nenhuma faixa.</TableCell></TableRow>}
            {rows.map((r) => <LtvEditableRow key={r.id} row={r} onSave={(v) => update.mutate(v)} onDelete={() => del.mutate(r.id)} />)}
          </TableBody>
        </Table>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="flex gap-2 items-end flex-wrap">
        <div className="w-28"><Label className="text-xs">Meses mín.</Label><Input type="number" min="0" required value={novo.meses_min} onChange={(e) => setNovo({ ...novo, meses_min: Number(e.target.value) })} /></div>
        <div className="w-28"><Label className="text-xs">Meses máx.</Label><Input type="number" min="0" placeholder="∞" value={novo.meses_max} onChange={(e) => setNovo({ ...novo, meses_max: e.target.value })} /></div>
        <div className="w-28"><Label className="text-xs">Comissão (%)</Label><Input type="number" step="0.01" min="0" max="100" required value={novo.percentual} onChange={(e) => setNovo({ ...novo, percentual: Number(e.target.value) })} /></div>
        <Button type="submit" size="sm"><Plus className="h-4 w-4 mr-1" />Adicionar faixa</Button>
      </form>
    </div>
  );
}
