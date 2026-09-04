import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Building2,
  Loader2,
  Map,
  MousePointerClick,
  Navigation,
  Phone,
  RefreshCw,
  Search,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useOrganization } from "@/hooks/useOrganization";
import {
  getGoogleBusinessInsights,
  getGoogleBusinessStatus,
  googleBusinessErrorMessage,
  type GoogleBusinessInsights,
} from "@/lib/googleBusiness";

const number = new Intl.NumberFormat("pt-BR");
const chartConfig = {
  visualizacoes: {
    label: "Visualizações",
    color: "hsl(173 58% 39%)",
  },
} satisfies ChartConfig;

type Props = {
  clientId: string;
  from: string;
  to: string;
  onReport?: (data: GoogleBusinessInsights | null) => void;
};

export function GoogleBusinessReport({ clientId, from, to, onReport }: Props) {
  const { organizationId } = useOrganization();
  const statusQuery = useQuery({
    queryKey: ["google-business-status", organizationId, clientId],
    queryFn: () => getGoogleBusinessStatus(organizationId!, clientId),
    enabled: !!organizationId && !!clientId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const metricsQuery = useQuery({
    queryKey: ["google-business-insights", organizationId, clientId, from, to],
    queryFn: () => getGoogleBusinessInsights({
      organizationId: organizationId!,
      clientId,
      from,
      to,
    }),
    enabled: false,
    retry: false,
  });

  useEffect(() => {
    onReport?.(metricsQuery.data ?? null);
  }, [metricsQuery.data, onReport]);

  const status = statusQuery.data;
  const ready = status?.connection_status === "active" &&
    !!status.google_location_name;
  const totals = metricsQuery.data?.insights.totals;
  const daily = (metricsQuery.data?.insights.daily ?? []).map((day) => ({
    dia: day.date.slice(5).replace("-", "/"),
    visualizacoes: day.search_impressions + day.maps_impressions,
  }));

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-brand" />
            <h3 className="text-sm font-semibold">Presença local no Google</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Descoberta orgânica do Perfil da Empresa no Google e no Maps.
          </p>
        </div>
        {ready && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => metricsQuery.refetch()}
            disabled={metricsQuery.isFetching}
          >
            {metricsQuery.isFetching ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            Atualizar métricas
          </Button>
        )}
      </div>

      {statusQuery.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Verificando conexão…
        </div>
      ) : !ready ? (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft/30 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Unidade do Google ainda não vinculada
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Conecte a conta da agência e escolha a unidade deste cliente na ficha.
          </p>
          <Button asChild className="mt-3" size="sm" variant="outline">
            <Link to={`/plannings/cliente/${clientId}`}>Abrir ficha do cliente</Link>
          </Button>
        </div>
      ) : metricsQuery.isError ? (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
          {googleBusinessErrorMessage(
            metricsQuery.error instanceof Error
              ? metricsQuery.error.message
              : "google_business_request_failed",
          )}
        </div>
      ) : totals ? (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-sm font-medium">{status.location_title}</p>
            <p className="text-xs text-muted-foreground">
              {from} a {to} · dados orgânicos, sem investimento em mídia
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { label: "Busca Google", value: totals.search_impressions, icon: Search },
              { label: "Google Maps", value: totals.maps_impressions, icon: Map },
              { label: "Ligações", value: totals.calls, icon: Phone },
              { label: "Rotas solicitadas", value: totals.directions, icon: Navigation },
              { label: "Cliques no site", value: totals.website_clicks, icon: MousePointerClick },
              { label: "Ações totais", value: totals.total_actions, icon: Building2 },
            ].map((metric) => (
              <div key={metric.label} className="rounded-xl border bg-muted/20 p-3">
                <metric.icon className="mb-2 h-4 w-4 text-brand" />
                <p className="text-xl font-semibold tabular-nums">
                  {number.format(metric.value)}
                </p>
                <p className="text-[11px] text-muted-foreground">{metric.label}</p>
              </div>
            ))}
          </div>
          {daily.length > 1 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                Visualizações por dia
              </p>
              <ChartContainer config={chartConfig} className="h-[190px] w-full">
                <AreaChart data={daily} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="googleBusinessFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-visualizacoes)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-visualizacoes)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="dia" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} width={42} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    dataKey="visualizacoes"
                    type="monotone"
                    stroke="var(--color-visualizacoes)"
                    fill="url(#googleBusinessFill)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Unidade vinculada: <span className="font-medium text-foreground">{status.location_title}</span>.
          Atualize para carregar os indicadores deste período.
        </p>
      )}
    </div>
  );
}
