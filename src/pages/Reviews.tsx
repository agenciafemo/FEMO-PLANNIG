import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Frown,
  Inbox,
  MessageSquareHeart,
  Search,
  Smile,
  Star,
  Users,
} from "lucide-react";
import { endOfDay, format, startOfDay, subDays, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, XAxis, YAxis } from "recharts";

import { EmptyState, MetricCard, PageHeader, SectionHeader } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrganization } from "@/hooks/useOrganization";
import {
  getPlanningNpsClientOptions,
  getPlanningNpsDashboard,
  getPlanningNpsResponses,
  NpsClassification,
  PlanningNpsResponse,
} from "@/lib/reviewsRpc";

const PAGE_SIZE = 25;

const classificationLabels: Record<NpsClassification, string> = {
  promoter: "Promotor",
  passive: "Neutro",
  detractor: "Detrator",
};

const classificationStyles: Record<NpsClassification, string> = {
  promoter: "border-transparent bg-success-soft text-success",
  passive: "border-transparent bg-warning-soft text-warning",
  detractor: "border-transparent bg-danger-soft text-danger",
};

const distributionColors: Record<NpsClassification, string> = {
  promoter: "hsl(var(--success))",
  passive: "hsl(var(--warning))",
  detractor: "hsl(var(--danger))",
};

const distributionChartConfig = {
  value: { label: "Respostas", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

const periodChartConfig = {
  total: { label: "Respostas", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

type PeriodFilter = "30d" | "90d" | "6m" | "all";

function getPeriodRange(period: PeriodFilter) {
  const now = new Date();

  if (period === "all") {
    return { from: null, to: null };
  }

  const from =
    period === "30d"
      ? subDays(now, 30)
      : period === "90d"
        ? subDays(now, 90)
        : subMonths(now, 6);

  return {
    from: startOfDay(from).toISOString(),
    to: endOfDay(now).toISOString(),
  };
}

function formatAverage(value: number | null) {
  if (value === null) return "—";
  return Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
}

function ReviewCard({ review }: { review: PlanningNpsResponse }) {
  return (
    <Card className="rounded-2xl border-border/70 bg-card/80 shadow-xs">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-xl font-semibold text-primary-foreground">
            {review.score}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-foreground">{review.client_name ?? "Cliente removido"}</p>
              <Badge className={classificationStyles[review.classification]}>
                {classificationLabels[review.classification]}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Planejamento {review.planning_label}
            </p>
            {review.reason ? (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
                {review.reason}
              </p>
            ) : (
              <p className="mt-3 text-sm italic text-muted-foreground">Sem comentário adicional.</p>
            )}
          </div>

          <time className="shrink-0 text-xs text-muted-foreground" dateTime={review.created_at}>
            {format(new Date(review.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
          </time>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewsLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-16 w-full max-w-xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-80 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}

export default function Reviews() {
  const { organizationId, isLegacy } = useOrganization();
  const [clientId, setClientId] = useState("all");
  const [classification, setClassification] = useState("all");
  const [period, setPeriod] = useState<PeriodFilter>("6m");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [clientId, classification, period, debouncedSearch, organizationId]);

  const periodRange = useMemo(() => getPeriodRange(period), [period]);
  const canLoad = Boolean(organizationId && !isLegacy);
  const normalizedClientId = clientId === "all" ? null : clientId;
  const normalizedClassification =
    classification === "all" ? null : (classification as NpsClassification);

  const dashboardQuery = useQuery({
    queryKey: [
      "planning-nps-dashboard",
      organizationId,
      periodRange.from,
      periodRange.to,
      normalizedClientId,
      normalizedClassification,
    ],
    queryFn: () =>
      getPlanningNpsDashboard({
        organizationId: organizationId!,
        from: periodRange.from,
        to: periodRange.to,
        clientId: normalizedClientId,
        classification: normalizedClassification,
      }),
    enabled: canLoad,
  });

  const responsesQuery = useQuery({
    queryKey: [
      "planning-nps-responses",
      organizationId,
      periodRange.from,
      periodRange.to,
      normalizedClientId,
      normalizedClassification,
      debouncedSearch,
      page,
    ],
    queryFn: () =>
      getPlanningNpsResponses({
        organizationId: organizationId!,
        from: periodRange.from,
        to: periodRange.to,
        clientId: normalizedClientId,
        classification: normalizedClassification,
        search: debouncedSearch,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    enabled: canLoad,
  });

  const clientsQuery = useQuery({
    queryKey: ["planning-nps-client-options", organizationId],
    queryFn: () => getPlanningNpsClientOptions(organizationId!),
    enabled: canLoad,
  });

  const dashboard = dashboardQuery.data;
  const responses = responsesQuery.data ?? [];
  const totalCount = Number(responses[0]?.total_count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const distributionData = useMemo(
    () =>
      dashboard
        ? (["promoter", "passive", "detractor"] as const).map((key) => ({
            classification: key,
            label: classificationLabels[key],
            value: dashboard.classification_distribution[key] ?? 0,
            fill: distributionColors[key],
          }))
        : [],
    [dashboard],
  );

  if (!canLoad) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Organização não disponível"
        description="Selecione uma organização ativa para acompanhar as avaliações."
      />
    );
  }

  if (dashboardQuery.isLoading || responsesQuery.isLoading) {
    return <ReviewsLoading />;
  }

  if (dashboardQuery.isError || responsesQuery.isError) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Não foi possível carregar as avaliações"
        description="Tente novamente. Se o problema continuar, confirme o acesso à organização."
        action={
          <Button
            variant="outline"
            onClick={() => {
              void dashboardQuery.refetch();
              void responsesQuery.refetch();
            }}
          >
            Tentar novamente
          </Button>
        }
      />
    );
  }

  const hasChartData = (dashboard?.total_responses ?? 0) > 0;
  const hasPeriodData = dashboard?.period_distribution.some((item) => item.total > 0) ?? false;

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-[1500px] space-y-8 p-5 sm:p-7 lg:p-8">
        <PageHeader
          title="NPS"
          subtitle="Acompanhe as notas enviadas pelos clientes nos planejamentos públicos."
        />

        <Card className="nrt-glass rounded-2xl">
          <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger aria-label="Filtrar por cliente" className="rounded-xl bg-background/70">
                <SelectValue placeholder="Todos os clientes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os clientes</SelectItem>
                {(clientsQuery.data ?? []).map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={classification} onValueChange={setClassification}>
              <SelectTrigger aria-label="Filtrar por classificação" className="rounded-xl bg-background/70">
                <SelectValue placeholder="Todas as classificações" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as classificações</SelectItem>
                <SelectItem value="promoter">Promotores</SelectItem>
                <SelectItem value="passive">Neutros</SelectItem>
                <SelectItem value="detractor">Detratores</SelectItem>
              </SelectContent>
            </Select>

            <Select value={period} onValueChange={(value) => setPeriod(value as PeriodFilter)}>
              <SelectTrigger aria-label="Filtrar por período" className="rounded-xl bg-background/70">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="90d">Últimos 90 dias</SelectItem>
                <SelectItem value="6m">Últimos 6 meses</SelectItem>
                <SelectItem value="all">Todo o período</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                maxLength={200}
                placeholder="Buscar cliente ou motivo"
                aria-label="Buscar por cliente ou motivo"
                className="rounded-xl bg-background/70 pl-9"
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            label="Nota média"
            value={formatAverage(dashboard?.average_score ?? null)}
            icon={Star}
            tone="brand"
          />
          <MetricCard
            label="Total de respostas"
            value={dashboard?.total_responses ?? 0}
            icon={MessageSquareHeart}
            tone="info"
          />
          <MetricCard
            label="Promotores"
            value={dashboard?.promoter_count ?? 0}
            icon={Smile}
            tone="success"
          />
          <MetricCard
            label="Neutros"
            value={dashboard?.passive_count ?? 0}
            icon={Users}
            tone="warning"
          />
          <MetricCard
            label="Detratores"
            value={dashboard?.detractor_count ?? 0}
            icon={Frown}
            tone="neutral"
          />
          <MetricCard
            label="Última resposta"
            value={
              dashboard?.last_response_at
                ? format(new Date(dashboard.last_response_at), "dd/MM/yy", { locale: ptBR })
                : "—"
            }
            icon={CalendarClock}
            tone="neutral"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="rounded-2xl border-border/70 bg-card/80">
            <CardHeader>
              <CardTitle className="text-base">Distribuição por classificação</CardTitle>
            </CardHeader>
            <CardContent>
              {hasChartData ? (
                <>
                  <ChartContainer config={distributionChartConfig} className="h-[260px] w-full">
                    <BarChart data={distributionData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                      <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                      <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                        {distributionData.map((item) => (
                          <Cell key={item.classification} fill={item.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                  <div className="mt-3 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
                    {distributionData.map((item) => (
                      <span key={item.classification} className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.fill }} />
                        {item.label}: {item.value}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState
                  variant="inline"
                  icon={Inbox}
                  title="Sem dados para o gráfico"
                  description="As classificações aparecerão após o recebimento das primeiras avaliações."
                />
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/70 bg-card/80">
            <CardHeader>
              <CardTitle className="text-base">Evolução por período</CardTitle>
            </CardHeader>
            <CardContent>
              {hasPeriodData ? (
                <ChartContainer config={periodChartConfig} className="h-[300px] w-full">
                  <LineChart
                    data={dashboard?.period_distribution ?? []}
                    margin={{ left: 0, right: 12, top: 12, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="var(--color-total)"
                      strokeWidth={2.5}
                      dot={{ fill: "var(--color-total)", r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ChartContainer>
              ) : (
                <EmptyState
                  variant="inline"
                  icon={CalendarClock}
                  title="Sem evolução no período"
                  description="O histórico mensal aparecerá quando houver avaliações no período selecionado."
                />
              )}
            </CardContent>
          </Card>
        </div>

        <section className="space-y-4">
          <SectionHeader title="Respostas recebidas" count={totalCount} />

          {responsesQuery.isFetching && !responsesQuery.isLoading && (
            <p className="text-xs text-muted-foreground">Atualizando respostas…</p>
          )}

          {responses.length === 0 ? (
            <EmptyState
              icon={MessageSquareHeart}
              title="Nenhuma avaliação encontrada"
              description="Ajuste os filtros ou aguarde as próximas respostas enviadas pelos clientes."
            />
          ) : (
            <div className="space-y-3">
              {responses.map((review) => (
                <ReviewCard key={review.response_id} review={review} />
              ))}
            </div>
          )}

          {totalCount > PAGE_SIZE && (
            <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/70 p-3 sm:flex-row">
              <p className="text-xs text-muted-foreground">
                Página {page + 1} de {totalPages} · {totalCount} respostas
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0 || responsesQuery.isFetching}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page + 1 >= totalPages || responsesQuery.isFetching}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Próxima
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
