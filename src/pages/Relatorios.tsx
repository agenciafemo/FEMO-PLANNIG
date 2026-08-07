import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { FileText, Sparkles, Loader2, Copy, Instagram, Heart, MessageCircle, Facebook, ArrowLeft, Download, Send } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { generateReport, getMetaInsights, type ReportResult, type MetaInsights } from "@/lib/reportRpc";
import { getClientMetaStatus } from "@/lib/metaRpc";
import { usePersistedState } from "@/hooks/usePersistedState";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

const chartConfig = {
  alcance: { label: "Alcance", color: "hsl(173 58% 39%)" },
  engajamento: { label: "Engajamento", color: "hsl(173 58% 39%)" },
  novos: { label: "Novos seguidores", color: "hsl(173 58% 39%)" },
  idade: { label: "Seguidores", color: "hsl(173 58% 39%)" },
} satisfies ChartConfig;

const PERIODS = [
  { key: "30d", label: "Últimos 30 dias" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "mes", label: "Este mês" },
  { key: "mespassado", label: "Mês passado" },
  { key: "custom", label: "Personalizado" },
] as const;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// Calcula o período do relatório + o período de comparação (mesma duração,
// imediatamente antes) a partir da escolha do usuário.
function periodRange(period: string, cf: string, ct: string) {
  const today = new Date();
  let from = new Date(today.getTime() - 30 * 864e5);
  let to = new Date(today);
  if (period === "7d") from = new Date(today.getTime() - 7 * 864e5);
  else if (period === "mes") from = new Date(today.getFullYear(), today.getMonth(), 1);
  else if (period === "mespassado") {
    from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    to = new Date(today.getFullYear(), today.getMonth(), 0); // último dia do mês passado
  } else if (period === "custom" && cf && ct) {
    from = new Date(cf + "T12:00:00");
    to = new Date(ct + "T12:00:00");
  }
  const lenMs = Math.max(864e5, to.getTime() - from.getTime());
  const cTo = new Date(from.getTime() - 864e5);
  const cFrom = new Date(cTo.getTime() - lenMs);
  return { from: isoDay(from), to: isoDay(to), cFrom: isoDay(cFrom), cTo: isoDay(cTo) };
}

export default function Relatorios() {
  const { user } = useAuth();
  const { organizationId, isLegacy } = useOrganization();
  const queryClient = useQueryClient();
  const [selected, setSelected] = usePersistedState<string>("report-client", "");
  const [period, setPeriod] = usePersistedState<string>("report-period", "30d");
  const [customFrom, setCustomFrom] = usePersistedState<string>("report-cfrom", "");
  const [customTo, setCustomTo] = usePersistedState<string>("report-cto", "");
  const range = periodRange(period, customFrom, customTo);

  const { data: clients } = useQuery({
    queryKey: ["report-clients", organizationId],
    queryFn: async () => {
      let q = supabase.from("clients").select("id, name, logo_url") as any;
      if (!isLegacy) q = q.eq("organization_id", organizationId!);
      const { data, error } = await q.order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; logo_url: string | null }[];
    },
    enabled: !!user && (isLegacy || !!organizationId),
  });

  // Quais canais cada cliente tem conectado (para os ícones do grid).
  // As tabelas Meta são fechadas (só via RPC), então consulto o status por
  // cliente em paralelo. Fica em cache (staleTime 5min) — uma leva por vez.
  const clientIds = (clients ?? []).map((c) => c.id);
  const { data: connMap } = useQuery({
    queryKey: ["report-connections", clientIds.join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        clientIds.map(async (id) => {
          const rows = await getClientMetaStatus(id).catch(() => []);
          const chans = rows
            .filter((r) => r.connection_status === "active" && r.channel_type)
            .map((r) => r.channel_type as string);
          return [id, chans] as const;
        }),
      );
      return Object.fromEntries(results) as Record<string, string[]>;
    },
    enabled: clientIds.length > 0,
  });

  const clientId = selected;

  // Métricas e análise ficam no CACHE do React Query (keyed por cliente), não
  // no estado do componente — assim sobrevivem a sair e voltar da página.
  // enabled:false: só buscam quando o usuário clica (refetch).
  const insightsKey = ["meta-insights", clientId, range.from, range.to];
  const insightsQuery = useQuery({
    queryKey: insightsKey,
    queryFn: () => getMetaInsights({
      clientId, from: range.from, to: range.to, compareFrom: range.cFrom, compareTo: range.cTo,
    }),
    enabled: false,
  });
  const insights = insightsQuery.data ?? null;

  const reportQuery = useQuery({
    queryKey: ["report-analysis", clientId, range.from, range.to],
    queryFn: async () => {
      let ins = queryClient.getQueryData<MetaInsights>(insightsKey) ?? null;
      if (!ins) {
        ins = await getMetaInsights({
          clientId, from: range.from, to: range.to, compareFrom: range.cFrom, compareTo: range.cTo,
        });
        queryClient.setQueryData(insightsKey, ins);
      }
      return generateReport({ clientId, insights: ins, from: range.from, to: range.to });
    },
    enabled: false,
  });
  const result = reportQuery.data ?? null;

  // Erros → toast (o useQuery do v5 não tem onError).
  useEffect(() => {
    if (insightsQuery.error) {
      toast.error("Erro ao puxar métricas: " + (insightsQuery.error as Error).message);
    }
  }, [insightsQuery.error]);
  useEffect(() => {
    if (reportQuery.error) {
      toast.error("Erro ao gerar: " + (reportQuery.error as Error).message);
    }
  }, [reportQuery.error]);

  // PDF: captura o conteúdo do relatório (reportRef) como imagem e monta um PDF
  // A4, quebrando em páginas. Reflete o tema atual (deixe claro p/ PDF branco).
  const reportRef = useRef<HTMLDivElement>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const exportPdf = async () => {
    const el = reportRef.current;
    if (!el) return;
    setPdfBusy(true);
    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
      });
      const img = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pageW) / canvas.width;
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(img, "PNG", 0, position, pageW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position -= pageH;
        pdf.addPage();
        pdf.addImage(img, "PNG", 0, position, pageW, imgH);
        heightLeft -= pageH;
      }
      const nome = insights?.profile?.username || insights?.client || "cliente";
      pdf.save(`relatorio-${nome}-${range.from}.pdf`);
    } catch (e) {
      toast.error("Erro ao gerar PDF: " + (e as Error).message);
    } finally {
      setPdfBusy(false);
    }
  };

  const copyMessage = () => {
    if (!insights) return;
    const p = insights.profile ?? {};
    const media = Array.isArray(insights.media) ? insights.media : [];
    const eng = media.reduce((a, m) => a + (m.like_count || 0) + (m.comments_count || 0), 0);
    const num = (n: number | null | undefined) => (n != null ? n.toLocaleString("pt-BR") : "—");
    const msg = [
      `Olá! 👋 Segue o resumo do desempenho do Instagram${p.username ? ` (@${p.username})` : ""} — período ${range.from} a ${range.to}:`,
      ``,
      `📊 Destaques:`,
      `• Alcance: ${num(insights.reach_total)}`,
      `• Visualizações: ${num(insights.views_total)}`,
      `• Engajamento: ${num(eng)} interações`,
      `• Seguidores: ${num(p.followers_count)}`,
      ``,
      `O relatório completo está em anexo. Qualquer dúvida, estou à disposição! 🚀`,
    ].join("\n");
    navigator.clipboard.writeText(msg);
    toast.success("Mensagem copiada! Cole no WhatsApp/e-mail do cliente.");
  };

  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-brand" />
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        </div>
      </div>

      {!selected ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(clients ?? []).map((c) => {
            const chans = connMap?.[c.id] ?? [];
            return (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className="flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40"
              >
                {c.logo_url ? (
                  <img src={c.logo_url} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                    {c.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Instagram className={`h-4 w-4 ${chans.includes("instagram") ? "text-brand" : "text-muted-foreground/30"}`} />
                    <Facebook className={`h-4 w-4 ${chans.includes("facebook_page") ? "text-brand" : "text-muted-foreground/30"}`} />
                    <span className="ml-1 text-xs text-muted-foreground">
                      {chans.length > 0 ? "Conectado" : "Sem conexão"}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <button
            onClick={() => setSelected("")}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar para clientes
          </button>

          <div className="rounded-xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          Escolha o período, puxe as métricas reais do Instagram e gere uma análise escrita
          por IA pronta para o cliente.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <span className="block text-xs text-muted-foreground">Período</span>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODS.map((pp) => <SelectItem key={pp.key} value={pp.key}>{pp.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {period === "custom" && (
            <>
              <div className="space-y-1">
                <span className="block text-xs text-muted-foreground">De</span>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-40" />
              </div>
              <div className="space-y-1">
                <span className="block text-xs text-muted-foreground">Até</span>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-40" />
              </div>
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {range.from} → {range.to} · comparando com {range.cFrom} → {range.cTo}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!clientId || insightsQuery.isFetching}
            onClick={() => insightsQuery.refetch()}
          >
            {insightsQuery.isFetching ? (
              <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Puxando métricas…</>
            ) : (
              <><Instagram className="mr-1.5 h-4 w-4" /> Puxar métricas do Instagram</>
            )}
          </Button>
          <Button
            disabled={!clientId || reportQuery.isFetching}
            onClick={() => reportQuery.refetch()}
          >
            {reportQuery.isFetching ? (
              <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Gerando análise…</>
            ) : (
              <><Sparkles className="mr-1.5 h-4 w-4" /> Gerar análise com IA</>
            )}
          </Button>
        </div>
      </div>

      {insights && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={pdfBusy} onClick={exportPdf}>
            {pdfBusy ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Gerando PDF…</>
            ) : (
              <><Download className="mr-1.5 h-3.5 w-3.5" /> Baixar PDF</>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={copyMessage}>
            <Send className="mr-1.5 h-3.5 w-3.5" /> Copiar mensagem pro cliente
          </Button>
        </div>
      )}

      <div ref={reportRef} className="space-y-4">
      {insights && (() => {
        const p = insights.profile ?? {};
        const mediaList = Array.isArray(insights.media) ? insights.media : [];
        const engTotal = mediaList.reduce((a, m) => a + (m.like_count || 0) + (m.comments_count || 0), 0);
        const reachTotal = insights.reach_total;
        const viewsTotal = insights.views_total;
        const reachDelta = pctDelta(insights.reach_total, insights.previous_reach_total);
        const viewsDelta = pctDelta(insights.views_total, insights.previous_views_total);
        const topPosts = [...mediaList].sort(
          (a, b) => ((b.like_count || 0) + (b.comments_count || 0)) - ((a.like_count || 0) + (a.comments_count || 0)),
        ).slice(0, 8);
        const reachSeries = (insights.account_insights ?? [])
          .flatMap((m) => m.values ?? [])
          .map((v) => ({ dia: v.end_time ? v.end_time.slice(5, 10) : "", alcance: v.value || 0 }));
        const engBars = topPosts.map((m, i) => ({
          label: `#${i + 1}`,
          engajamento: (m.like_count || 0) + (m.comments_count || 0),
        }));
        const newFollowersSeries = (insights.new_followers ?? [])
          .map((v) => ({ dia: v.end_time ? v.end_time.slice(5, 10) : "", novos: v.value || 0 }));
        const demo = insights.demographics;
        const idadeBars = (demo?.idade ?? []).map((d) => ({ label: d.chave, valor: d.valor }));
        const generoList = demo?.genero ?? [];
        const cidadeList = (demo?.cidade ?? []).slice(0, 6);
        const generoTotal = generoList.reduce((a, d) => a + d.valor, 0) || 1;
        const cidadeMax = Math.max(1, ...cidadeList.map((d) => d.valor));
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Seguidores" value={p.followers_count?.toLocaleString("pt-BR") ?? "—"} />
              <Metric label="Alcance" value={reachTotal != null ? reachTotal.toLocaleString("pt-BR") : "—"} delta={reachDelta} />
              <Metric label="Visualizações" value={viewsTotal != null ? viewsTotal.toLocaleString("pt-BR") : "—"} delta={viewsDelta} />
              <Metric label="Engajamento" value={engTotal.toLocaleString("pt-BR")} />
            </div>

            {reachSeries.length > 0 && (
              <div className="rounded-xl border bg-card p-5">
                <h2 className="mb-3 text-sm font-medium text-muted-foreground">Alcance por dia</h2>
                <ChartContainer config={chartConfig} className="h-[220px] w-full">
                  <LineChart data={reachSeries} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="dia" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tickLine={false} axisLine={false} width={40} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line dataKey="alcance" type="monotone" stroke="var(--color-alcance)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartContainer>
              </div>
            )}

            {engBars.length > 0 && (
              <div className="rounded-xl border bg-card p-5">
                <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                  Engajamento por post (top {engBars.length})
                </h2>
                <ChartContainer config={chartConfig} className="h-[220px] w-full">
                  <BarChart data={engBars} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} width={40} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="engajamento" fill="var(--color-engajamento)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>
            )}

            {!insights.insights_available && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600">
                {insights.insights_note}
              </div>
            )}

            {newFollowersSeries.length > 0 && (
              <div className="rounded-xl border bg-card p-5">
                <h2 className="mb-3 text-sm font-medium text-muted-foreground">Novos seguidores por dia</h2>
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <LineChart data={newFollowersSeries} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="dia" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tickLine={false} axisLine={false} width={40} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line dataKey="novos" type="monotone" stroke="var(--color-novos)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartContainer>
              </div>
            )}

            {(generoList.length > 0 || cidadeList.length > 0) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {generoList.length > 0 && (
                  <div className="rounded-xl border bg-card p-5">
                    <h2 className="mb-3 text-sm font-medium text-muted-foreground">Seguidores por gênero</h2>
                    <div className="space-y-2.5">
                      {generoList.map((d) => {
                        const pct = Math.round((d.valor / generoTotal) * 100);
                        const nome = d.chave === "F" ? "Feminino" : d.chave === "M" ? "Masculino" : d.chave;
                        return (
                          <div key={d.chave}>
                            <div className="flex justify-between text-xs">
                              <span>{nome}</span>
                              <span className="text-muted-foreground">{pct}%</span>
                            </div>
                            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                              <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {cidadeList.length > 0 && (
                  <div className="rounded-xl border bg-card p-5">
                    <h2 className="mb-3 text-sm font-medium text-muted-foreground">Principais cidades</h2>
                    <div className="space-y-2.5">
                      {cidadeList.map((d) => (
                        <div key={d.chave}>
                          <div className="flex justify-between gap-2 text-xs">
                            <span className="truncate">{d.chave}</span>
                            <span className="shrink-0 text-muted-foreground">{d.valor.toLocaleString("pt-BR")}</span>
                          </div>
                          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div className="h-full bg-brand" style={{ width: `${Math.round((d.valor / cidadeMax) * 100)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {idadeBars.length > 0 && (
              <div className="rounded-xl border bg-card p-5">
                <h2 className="mb-3 text-sm font-medium text-muted-foreground">Seguidores por faixa etária</h2>
                <ChartContainer config={chartConfig} className="h-[220px] w-full">
                  <BarChart data={idadeBars} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} width={40} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="valor" fill="var(--color-idade)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>
            )}

            <div className="rounded-xl border bg-card p-5">
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Instagram className="h-4 w-4" /> Posts com mais engajamento — @{p.username ?? insights.client}
              </h2>
              <div className="space-y-2">
                {topPosts.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum post encontrado.</p>
                )}
                {topPosts.map((m) => (
                  <a
                    key={m.id}
                    href={m.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-lg border p-2 text-sm hover:bg-muted/50"
                  >
                    {(m.thumbnail_url || m.media_url) ? (
                      <img src={m.thumbnail_url || m.media_url} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Instagram className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {m.caption?.slice(0, 60) || (m.media_product_type ?? m.media_type ?? "Post")}
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" /> {m.like_count ?? 0}</span>
                      <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> {m.comments_count ?? 0}</span>
                    </span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {insights?.facebook && (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Facebook className="h-4 w-4 text-brand" /> Facebook{insights.facebook.name ? ` — ${insights.facebook.name}` : ""}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Seguidores" value={insights.facebook.followers != null ? insights.facebook.followers.toLocaleString("pt-BR") : "—"} />
            <Metric label="Alcance" value={insights.facebook.reach != null ? insights.facebook.reach.toLocaleString("pt-BR") : "—"} />
            <Metric label="Visualizações" value={insights.facebook.views != null ? insights.facebook.views.toLocaleString("pt-BR") : "—"} />
            <Metric label="Engajamento" value={insights.facebook.engagement != null ? insights.facebook.engagement.toLocaleString("pt-BR") : "—"} />
          </div>
          {insights.facebook.note && insights.facebook.note !== "ok" && (
            <p className="mt-3 text-xs text-amber-600">
              Algumas métricas do Facebook não vieram (a Meta aposentou várias em jun/2026). Detalhe: {insights.facebook.note}
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Análise da IA */}
          <div className="rounded-xl border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Sparkles className="h-4 w-4" /> Análise gerada por IA
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(result.analysis);
                  toast.success("Análise copiada!");
                }}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar
              </Button>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{result.analysis}</div>
            <p className="mt-4 text-xs text-muted-foreground">
              Texto gerado por IA a partir dos dados do Norteia. Revise antes de enviar ao cliente.
            </p>
          </div>
        </div>
      )}

      {insights && (
        <footer className="mt-8 flex flex-col items-center gap-2 border-t py-8 text-center">
          <img
            src="/brand/norteia/logo/NORTEIA.png"
            alt="Norteia"
            className="h-7 w-auto opacity-80 dark:brightness-0 dark:invert"
          />
          <p className="text-[11px] text-muted-foreground">
            Relatório gerado com Norteia
          </p>
        </footer>
      )}
      </div>
        </>
      )}
    </div>
  );
}

function pctDelta(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

function Metric({ label, value, small, delta }: {
  label: string;
  value: string | number;
  small?: boolean;
  delta?: number | null;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-0.5 flex items-baseline gap-2">
        <p className={small ? "text-xs font-medium" : "text-xl font-semibold"}>{value}</p>
        {delta != null && (
          <span className={`text-xs font-medium ${delta >= 0 ? "text-success" : "text-destructive"}`}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}
