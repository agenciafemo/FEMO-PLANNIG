import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { toast } from "sonner";
import { FileText, Sparkles, Loader2, Copy, Instagram, Heart, MessageCircle } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { generateReport, getMetaInsights, type ReportResult, type MetaInsights } from "@/lib/reportRpc";
import { usePersistedState } from "@/hooks/usePersistedState";

const chartConfig = {
  alcance: { label: "Alcance", color: "hsl(173 58% 39%)" },
  engajamento: { label: "Engajamento", color: "hsl(173 58% 39%)" },
  novos: { label: "Novos seguidores", color: "hsl(173 58% 39%)" },
  idade: { label: "Seguidores", color: "hsl(173 58% 39%)" },
} satisfies ChartConfig;

export default function Relatorios() {
  const { user } = useAuth();
  const { organizationId, isLegacy } = useOrganization();
  const [selected, setSelected] = usePersistedState<string>("report-client", "");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [insights, setInsights] = useState<MetaInsights | null>(null);

  const { data: clients } = useQuery({
    queryKey: ["report-clients", organizationId],
    queryFn: async () => {
      let q = supabase.from("clients").select("id, name") as any;
      if (!isLegacy) q = q.eq("organization_id", organizationId!);
      const { data, error } = await q.order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: !!user && (isLegacy || !!organizationId),
  });

  const clientId = selected || clients?.[0]?.id || "";

  const gen = useMutation({
    mutationFn: async () => {
      // Garante as métricas reais antes de gerar (puxa se ainda não tiver).
      let ins = insights;
      if (!ins) { ins = await getMetaInsights({ clientId }); setInsights(ins); }
      return generateReport({ clientId, insights: ins });
    },
    onSuccess: (r) => setResult(r),
    onError: (e: unknown) => toast.error("Erro ao gerar: " + (e as Error).message),
  });

  const pull = useMutation({
    mutationFn: () => getMetaInsights({ clientId }),
    onSuccess: (r) => setInsights(r),
    onError: (e: unknown) => toast.error("Erro ao puxar métricas: " + (e as Error).message),
  });

  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-brand" />
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        </div>
        <Select value={clientId} onValueChange={setSelected}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Cliente" /></SelectTrigger>
          <SelectContent>
            {(clients ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          Puxe as métricas reais do Instagram (seguidores, alcance, curtidas e comentários
          por post) dos últimos 30 dias, e gere uma análise escrita por IA pronta para o cliente.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!clientId || pull.isPending}
            onClick={() => { setInsights(null); pull.mutate(); }}
          >
            {pull.isPending ? (
              <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Puxando métricas…</>
            ) : (
              <><Instagram className="mr-1.5 h-4 w-4" /> Puxar métricas do Instagram</>
            )}
          </Button>
          <Button
            disabled={!clientId || gen.isPending}
            onClick={() => { setResult(null); gen.mutate(); }}
          >
            {gen.isPending ? (
              <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Gerando análise…</>
            ) : (
              <><Sparkles className="mr-1.5 h-4 w-4" /> Gerar análise com IA</>
            )}
          </Button>
        </div>
      </div>

      {insights && (() => {
        const p = insights.profile ?? {};
        const mediaList = Array.isArray(insights.media) ? insights.media : [];
        const engTotal = mediaList.reduce((a, m) => a + (m.like_count || 0) + (m.comments_count || 0), 0);
        const reachTotal = insights.reach_total;
        const viewsTotal = insights.views_total;
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
              <Metric label="Alcance (30d)" value={reachTotal != null ? reachTotal.toLocaleString("pt-BR") : "—"} />
              <Metric label="Visualizações (30d)" value={viewsTotal != null ? viewsTotal.toLocaleString("pt-BR") : "—"} />
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
                      <img src={m.thumbnail_url || m.media_url} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" />
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-muted">
                        <Instagram className="h-4 w-4 text-muted-foreground" />
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
    </div>
  );
}

function Metric({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={small ? "mt-0.5 text-xs font-medium" : "mt-0.5 text-xl font-semibold"}>{value}</p>
    </div>
  );
}
