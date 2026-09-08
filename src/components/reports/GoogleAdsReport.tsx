import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Link2,
  Loader2,
  MousePointerClick,
  Percent,
  RefreshCw,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOrganization } from "@/hooks/useOrganization";
import { cn } from "@/lib/utils";
import {
  disconnectGoogleAds,
  formatGoogleAdsMoney,
  getGoogleAdsInsights,
  getGoogleAdsStatus,
  googleAdsErrorMessage,
  listGoogleAdsAccounts,
  selectGoogleAdsAccount,
  startGoogleAdsOAuth,
  type GoogleAdsInsights,
} from "@/lib/googleAds";

const number = new Intl.NumberFormat("pt-BR");
const chartConfig = {
  investimento: { label: "Investimento", color: "hsl(217 91% 60%)" },
} satisfies ChartConfig;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : "google_ads_request_failed";
}

type Props = {
  clientId: string;
  from: string;
  to: string;
  onReport?: (data: GoogleAdsInsights | null) => void;
};

export function GoogleAdsReport({ clientId, from, to, onReport }: Props) {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const [escolhendoConta, setEscolhendoConta] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["google-ads-status", organizationId, clientId],
    queryFn: () => getGoogleAdsStatus(organizationId!, clientId),
    enabled: !!organizationId && !!clientId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const metricsQuery = useQuery({
    queryKey: ["google-ads-insights", organizationId, clientId, from, to],
    queryFn: () => getGoogleAdsInsights({
      organizationId: organizationId!,
      clientId,
      from,
      to,
    }),
    // Só busca no clique: cada chamada consome operações da cota diária do
    // developer token, e abrir a tela não é pedir relatório.
    enabled: false,
    retry: false,
  });

  useEffect(() => {
    onReport?.(metricsQuery.data ?? null);
  }, [metricsQuery.data, onReport]);

  const contasQuery = useQuery({
    queryKey: ["google-ads-accounts", organizationId],
    queryFn: () => listGoogleAdsAccounts(organizationId!),
    enabled: escolhendoConta && !!organizationId,
    retry: false,
  });

  const conectar = useMutation({
    mutationFn: async () => {
      const url = await startGoogleAdsOAuth(
        organizationId!,
        `${window.location.pathname}${window.location.search}`,
      );
      window.location.assign(url);
    },
    onError: (error) => toast.error(googleAdsErrorMessage(reasonOf(error))),
  });

  const vincular = useMutation({
    mutationFn: (customerId: string) => selectGoogleAdsAccount({
      organizationId: organizationId!,
      clientId,
      customerId,
    }),
    onSuccess: () => {
      toast.success("Conta de anúncios vinculada.");
      setEscolhendoConta(false);
      queryClient.invalidateQueries({ queryKey: ["google-ads-status"] });
    },
    onError: (error) => toast.error(googleAdsErrorMessage(reasonOf(error))),
  });

  const desconectar = useMutation({
    mutationFn: () => disconnectGoogleAds(organizationId!),
    onSuccess: () => {
      toast.success("Conta Google Ads desconectada.");
      queryClient.invalidateQueries({ queryKey: ["google-ads-status"] });
    },
    onError: (error) => toast.error(googleAdsErrorMessage(reasonOf(error))),
  });

  const status = statusQuery.data;
  const conectado = status?.connection_status === "active";
  const pronto = conectado && !!status?.customer_id;
  const dados = metricsQuery.data;
  const moeda = dados?.account.currency ?? status?.currency_code ?? null;

  const serie = (dados?.daily ?? []).map((dia) => ({
    dia: dia.date.slice(5).replace("-", "/"),
    investimento: dia.cost,
  }));

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-brand" />
            <h3 className="text-sm font-semibold">Tráfego pago no Google (Google Ads)</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Investimento, cliques e conversões das campanhas do cliente.
          </p>
        </div>
        {pronto && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => metricsQuery.refetch()}
            disabled={metricsQuery.isFetching}
          >
            {metricsQuery.isFetching
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              : <RefreshCw className="mr-1.5 h-4 w-4" />}
            Atualizar métricas
          </Button>
        )}
      </div>

      {statusQuery.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Verificando conexão…
        </div>
      ) : statusQuery.isError ? (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
          Não foi possível ler o status do Google Ads. Se este ambiente ainda não
          recebeu a migration da integração, ela precisa ser aplicada antes.
        </div>
      ) : !conectado ? (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft/30 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Conta Google Ads da agência não conectada
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Conecte com o login que administra a conta de administrador (MCC) da
            agência — é ela que enxerga as contas dos clientes.
          </p>
          {status?.can_manage && (
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => conectar.mutate()}
              disabled={conectar.isPending}
            >
              {conectar.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Conectar conta Google Ads
            </Button>
          )}
        </div>
      ) : !pronto ? (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft/30 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Nenhuma conta de anúncios vinculada a este cliente
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Conectado como {status?.google_account_email}.
          </p>
          {status?.can_manage && (
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => setEscolhendoConta(true)}
            >
              <Link2 className="mr-1.5 h-4 w-4" /> Vincular conta de anúncios
            </Button>
          )}
        </div>
      ) : metricsQuery.isError ? (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
          {googleAdsErrorMessage(reasonOf(metricsQuery.error))}
        </div>
      ) : dados ? (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-sm font-medium">{dados.account.name}</p>
            <p className="text-xs text-muted-foreground">
              {from} a {to} · conta {dados.account.customer_id}
              {moeda ? ` · valores em ${moeda}` : ""}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { label: "Investimento", valor: formatGoogleAdsMoney(dados.totals.cost, moeda), icon: Wallet },
              { label: "Impressões", valor: number.format(dados.totals.impressions), icon: TrendingUp },
              { label: "Cliques", valor: number.format(dados.totals.clicks), icon: MousePointerClick },
              { label: "CTR", valor: `${dados.totals.ctr.toFixed(2)}%`, icon: Percent },
              { label: "Custo por clique", valor: formatGoogleAdsMoney(dados.totals.cpc, moeda), icon: Wallet },
              { label: "Conversões", valor: number.format(dados.totals.conversions), icon: Target },
            ].map((metrica) => (
              <div key={metrica.label} className="rounded-xl border bg-muted/20 p-3">
                <metrica.icon className="mb-2 h-4 w-4 text-brand" />
                <p className="text-xl font-semibold tabular-nums">{metrica.valor}</p>
                <p className="text-[11px] text-muted-foreground">{metrica.label}</p>
              </div>
            ))}
          </div>

          {serie.length > 1 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                Investimento por dia
              </p>
              <ChartContainer config={chartConfig} className="h-[190px] w-full">
                <AreaChart data={serie} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="googleAdsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-investimento)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-investimento)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="dia" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} width={52} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    dataKey="investimento"
                    type="monotone"
                    stroke="var(--color-investimento)"
                    fill="url(#googleAdsFill)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            </div>
          )}

          {dados.campaigns.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                Campanhas por investimento
              </p>
              {/* A tabela rola sozinha: numa tela estreita, nomes de campanha
                  empurrariam a página inteira para o lado. */}
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Campanha</th>
                      <th className="px-3 py-2 text-right font-medium">Investimento</th>
                      <th className="px-3 py-2 text-right font-medium">Cliques</th>
                      <th className="px-3 py-2 text-right font-medium">Conversões</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.campaigns.slice(0, 10).map((campanha) => (
                      <tr key={campanha.name} className="border-b last:border-0">
                        <td className="px-3 py-2">{campanha.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatGoogleAdsMoney(campanha.cost, moeda)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {number.format(campanha.clicks)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {number.format(campanha.conversions)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {status?.can_manage && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="ghost" onClick={() => setEscolhendoConta(true)}>
                Trocar conta de anúncios
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => desconectar.mutate()}
                disabled={desconectar.isPending}
              >
                Desconectar Google Ads
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Conta vinculada:{" "}
          <span className="font-medium text-foreground">{status?.descriptive_name}</span>.
          Atualize para carregar os números deste período.
        </p>
      )}

      <Dialog open={escolhendoConta} onOpenChange={setEscolhendoConta}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Conta de anúncios deste cliente</DialogTitle>
            <DialogDescription>
              A lista vem da conta de administrador da agência. Contas
              administradoras aparecem no fim — elas agrupam clientes, não
              veiculam anúncios.
            </DialogDescription>
          </DialogHeader>

          {contasQuery.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando contas no Google…
            </div>
          ) : contasQuery.isError ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              {googleAdsErrorMessage(reasonOf(contasQuery.error))}
            </p>
          ) : (contasQuery.data ?? []).length === 0 ? (
            <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
              Nenhuma conta encontrada para este login do Google.
            </p>
          ) : (
            <ScrollArea className="max-h-72 rounded-lg border">
              <div className="divide-y">
                {(contasQuery.data ?? []).map((conta) => (
                  <button
                    key={conta.customerId}
                    type="button"
                    disabled={vincular.isPending}
                    onClick={() => vincular.mutate(conta.customerId)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                      vincular.isPending && "opacity-60",
                    )}
                  >
                    <span className="flex-1">
                      <span className="font-medium">{conta.descriptiveName}</span>
                      <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                        {conta.customerId}
                      </span>
                    </span>
                    {conta.manager && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        administradora
                      </span>
                    )}
                    {conta.testAccount && (
                      <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] text-muted-foreground">
                        teste
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEscolhendoConta(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
