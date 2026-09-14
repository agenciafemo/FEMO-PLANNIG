import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, DollarSign, Loader2, Megaphone, MoreHorizontal, RefreshCw, UserRound } from "lucide-react";
import {
  type AdAccount,
  type AdsInsights,
  daysUntil,
  disconnectMetaAds,
  formatarQuando,
  getAdsInsights,
  getMetaAdsClientStatus,
  getMetaAdsStatus,
  listAdAccounts,
  loadClientAdAccounts,
  metaAdsReasonMessage,
  setClientAdAccount,
  startMetaAdsOAuth,
} from "@/lib/adsRpc";

// A partir de quantos dias antes do vencimento a tela começa a avisar.
const AVISO_VENCIMENTO_DIAS = 10;

const nf = new Intl.NumberFormat("pt-BR");
const cf = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Opções de período (igual ao Meta). preset != null -> vai como date_preset.
const PERIODS: { key: string; label: string; preset: string | null }[] = [
  { key: "last_7d", label: "Últimos 7 dias", preset: "last_7d" },
  { key: "last_14d", label: "Últimos 14 dias", preset: "last_14d" },
  { key: "last_30d", label: "Últimos 30 dias", preset: "last_30d" },
  { key: "this_month", label: "Este mês", preset: "this_month" },
  { key: "last_month", label: "Mês passado", preset: "last_month" },
  { key: "maximum", label: "Período todo", preset: "maximum" },
  { key: "custom", label: "Personalizado", preset: null },
];

// Nomes amigáveis para os action_type do Meta (a lista crua é confusa).
// Só os desta lista aparecem em "Principais"; o resto vai em "Outras".
const ACTION_LABELS: Record<string, string> = {
  "offsite_conversion.fb_pixel_purchase": "Compras (site)",
  "onsite_conversion.purchase": "Compras",
  "purchase": "Compras",
  "offsite_conversion.fb_pixel_lead": "Leads (site)",
  "onsite_conversion.lead_grouped": "Leads",
  "lead": "Leads",
  "onsite_conversion.messaging_conversation_started_7d": "Conversas iniciadas",
  "onsite_conversion.total_messaging_connection": "Conexões por mensagem",
  "onsite_conversion.messaging_first_reply": "Primeiras respostas",
  "link_click": "Cliques no link",
  "landing_page_view": "Visitas à página",
  "video_view": "Views de vídeo (3s)",
  "post_engagement": "Engajamento no post",
  "page_engagement": "Engajamento na página",
  "post_reaction": "Reações",
  "comment": "Comentários",
};
// Ordem de prioridade na exibição (conversões primeiro).
const ACTION_ORDER = Object.keys(ACTION_LABELS);

// Deixa um action_type desconhecido menos feio (fallback para "Outras").
function prettyAction(type: string): string {
  return type
    .replace(/^offsite_conversion\./, "")
    .replace(/^onsite_conversion\./, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Seção de Tráfego Pago (Meta Ads) para dentro do relatório de um cliente.
// onReport: avisa o pai (Relatórios) do último resultado, para incluir no PDF.
export function AdsReport({
  clientId,
  onReport,
}: {
  clientId: string;
  onReport?: (data: AdsInsights | null) => void;
}) {
  const { user } = useAuth();
  const { organizationId, role } = useOrganization();
  const queryClient = useQueryClient();
  const canEdit = role === "owner" || role === "admin" || role === "manager" || role === "editor";

  const [periodKey, setPeriodKey] = useState<string>("last_30d");
  const period = PERIODS.find((p) => p.key === periodKey) ?? PERIODS[2];
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [report, setReport] = useState<AdsInsights | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [showAllActions, setShowAllActions] = useState(false);

  const { data: mapping } = useQuery({
    queryKey: ["ads-mapping", organizationId],
    queryFn: () => loadClientAdAccounts(organizationId!),
    enabled: !!organizationId,
  });
  const currentAccount = mapping?.[clientId];

  // Conexão Meta Ads DA AGÊNCIA (uma para todos os clientes).
  const statusQuery = useQuery({
    queryKey: ["meta-ads-status", organizationId],
    queryFn: () => getMetaAdsStatus(organizationId!),
    enabled: !!organizationId,
    staleTime: 60 * 1000,
    // Sem a migration aplicada a RPC não existe: a seção segue no fluxo antigo.
    retry: false,
  });
  const adsStatus = statusQuery.data ?? null;
  const conectado = adsStatus?.connection_status === "active";
  const precisaReconectar = adsStatus?.connection_status === "reauth_required" ||
    adsStatus?.connection_status === "error";
  const nuncaConectou = adsStatus?.connection_status === "not_connected";
  const diasRestantes = conectado ? daysUntil(adsStatus?.token_expires_at ?? null) : null;
  const venceEmBreve = diasRestantes !== null && diasRestantes <= AVISO_VENCIMENTO_DIAS;
  // Conexão com o PERFIL DO CLIENTE: vale só para este cliente e tem prioridade
  // sobre a da agência no relatório dele.
  const clientStatusQuery = useQuery({
    queryKey: ["meta-ads-client-status", organizationId, clientId],
    queryFn: () => getMetaAdsClientStatus(organizationId!, clientId),
    enabled: !!organizationId && !!clientId,
    staleTime: 60 * 1000,
    // Sem a migration por cliente a RPC não existe: o painel simplesmente some.
    retry: false,
  });
  const clientStatus = clientStatusQuery.data ?? null;
  const clienteConectado = clientStatus?.connection_status === "active";
  const clientePrecisaReconectar = clientStatus?.connection_status === "reauth_required" ||
    clientStatus?.connection_status === "error";
  const clienteDias = clienteConectado ? daysUntil(clientStatus?.token_expires_at ?? null) : null;
  const clienteVenceEmBreve = clienteDias !== null && clienteDias <= AVISO_VENCIMENTO_DIAS;
  // Qual conexão o diálogo de confirmação vai desligar.
  const [confirmarDesconexao, setConfirmarDesconexao] = useState<"agency" | "client" | null>(null);

  // Volta do consentimento da Meta: o callback redireciona com ?meta_ads_status=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resultado = params.get("meta_ads_status");
    if (!resultado) return;
    const doCliente = params.get("meta_ads_scope") === "client";
    if (resultado === "connected") {
      toast.success(doCliente ? "Perfil do cliente conectado ao Meta Ads." : "Meta Ads da agência conectado.");
    } else {
      toast.error(metaAdsReasonMessage(params.get("reason_code") ?? "meta_ads_oauth_callback_failed"));
    }
    params.delete("meta_ads_status");
    params.delete("reason_code");
    params.delete("meta_ads_scope");
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
    queryClient.invalidateQueries({ queryKey: ["meta-ads-status"] });
    queryClient.invalidateQueries({ queryKey: ["meta-ads-client-status"] });
  }, [queryClient]);

  const conectar = useMutation({
    mutationFn: async (alvo: "agency" | "client") => {
      const url = await startMetaAdsOAuth(
        organizationId!,
        `${window.location.pathname}${window.location.search}`,
        alvo === "client" ? clientId : null,
      );
      try {
        sessionStorage.setItem("meta-ads-return-client", clientId);
      } catch {
        // Sem sessionStorage a conexão funciona igual; só não reabre o cliente.
      }
      window.location.assign(url);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const desconectar = useMutation({
    mutationFn: (alvo: "agency" | "client") =>
      disconnectMetaAds(organizationId!, alvo === "client" ? clientId : null),
    onSuccess: (_data, alvo) => {
      toast.success(
        alvo === "client"
          ? "Perfil do cliente desconectado. O relatório dele volta a usar a conexão da agência."
          : "Meta Ads da agência desconectado.",
      );
      setConfirmarDesconexao(null);
      queryClient.invalidateQueries({ queryKey: ["meta-ads-status"] });
      queryClient.invalidateQueries({ queryKey: ["meta-ads-client-status"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  async function handleLoadAccounts() {
    setLoadingAccounts(true);
    try {
      const list = await listAdAccounts(organizationId, clientId);
      setAccounts(list);
      if (list.length === 0) toast.warning("A conexão do Meta Ads não retornou nenhuma conta de anúncios.");
      else toast.success(`${list.length} conta(s) encontrada(s).`);
    } catch (e) {
      toast.error(`Erro ao listar contas: ${(e as Error).message}`);
    } finally {
      setLoadingAccounts(false);
      // Uma recusa da Meta muda o status da conexão: a tela mostra "Reconectar".
      queryClient.invalidateQueries({ queryKey: ["meta-ads-status"] });
      queryClient.invalidateQueries({ queryKey: ["meta-ads-client-status"] });
    }
  }

  async function handleSaveAccount(accountId: string) {
    if (!organizationId || !user) return;
    const acc = accounts?.find((a) => a.account_id === accountId);
    setSavingAccount(true);
    try {
      await setClientAdAccount({
        organizationId,
        clientId,
        adAccountId: accountId,
        adAccountName: acc?.name ?? null,
        userId: user.id,
      });
      toast.success("Conta de anúncios vinculada ao cliente.");
      queryClient.invalidateQueries({ queryKey: ["ads-mapping", organizationId] });
    } catch (e) {
      toast.error(`Erro ao salvar: ${(e as Error).message}`);
    } finally {
      setSavingAccount(false);
    }
  }

  async function handlePullReport() {
    if (period.key === "custom" && (!customFrom || !customTo)) {
      toast.error("Escolha as datas de início e fim do período personalizado.");
      return;
    }
    setLoadingReport(true);
    setReport(null);
    setShowAllActions(false);
    try {
      const data = period.preset
        ? await getAdsInsights({ clientId, datePreset: period.preset })
        : await getAdsInsights({ clientId, from: customFrom, to: customTo });
      setReport(data);
      onReport?.(data);
    } catch (e) {
      toast.error(`Erro ao puxar tráfego pago: ${(e as Error).message}`);
    } finally {
      setLoadingReport(false);
      queryClient.invalidateQueries({ queryKey: ["meta-ads-status"] });
      queryClient.invalidateQueries({ queryKey: ["meta-ads-client-status"] });
    }
  }

  // Separa as ações em "principais" (com nome amigável, na ordem definida) e
  // "outras" (o resto, com nome menos feio) — a lista crua do Meta é confusa.
  const principais = report
    ? ACTION_ORDER
        .map((type) => report.totais.acoes.find((a) => a.action_type === type))
        .filter((a): a is NonNullable<typeof a> => Boolean(a))
    : [];
  const outras = report
    ? report.totais.acoes.filter((a) => !ACTION_LABELS[a.action_type])
    : [];

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-semibold">Tráfego Pago (Meta Ads)</h3>
      </div>

      {/* Conexão Meta Ads da agência */}
      {statusQuery.isLoading ? (
        <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando conexão do Meta Ads…
        </p>
      ) : adsStatus && conectado ? (
        <div
          className={cn(
            "mb-4 rounded-xl border p-3",
            venceEmBreve ? "border-warning/30 bg-warning-soft/30" : "border-border bg-muted/20",
          )}
        >
          <p className="text-sm">
            Meta Ads da agência conectado
            {adsStatus.meta_user_name && (
              <> como <span className="font-medium">{adsStatus.meta_user_name}</span></>
            )}
            .
          </p>
          {diasRestantes !== null && adsStatus.token_expires_at && (
            <p className={cn("mt-0.5 text-xs", venceEmBreve ? "text-warning" : "text-muted-foreground")}>
              {diasRestantes < 0
                ? "A autorização venceu."
                : `A autorização vence em ${new Date(adsStatus.token_expires_at).toLocaleDateString("pt-BR")} (${diasRestantes} dia${diasRestantes === 1 ? "" : "s"}).`}
              {venceEmBreve && " Reconecte antes para o relatório não parar."}
            </p>
          )}
          {adsStatus.can_manage && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant={venceEmBreve ? "outline" : "ghost"}
                onClick={() => conectar.mutate("agency")}
                disabled={conectar.isPending}
              >
                {conectar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Reconectar Meta Ads
              </Button>
              {/* Desconectar mora num menu, longe do Reconectar: em 14/09 a
                  conexão da agência foi desligada com um clique ao lado dele.
                  modal={false}: abrir o AlertDialog a partir de um menu modal
                  deixa a página sem receber cliques. */}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Mais opções do Meta Ads da agência">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    disabled={desconectar.isPending}
                    onSelect={() => setConfirmarDesconexao("agency")}
                  >
                    Desconectar Meta Ads da agência
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      ) : adsStatus && !clienteConectado ? (
        <div
          className={cn(
            "mb-4 rounded-xl border p-3",
            precisaReconectar ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning-soft/30",
          )}
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className={cn("h-4 w-4", precisaReconectar ? "text-destructive" : "text-warning")} />
            {precisaReconectar
              ? "A Meta recusou o acesso de anúncios da agência"
              : "Meta Ads da agência não conectado"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {precisaReconectar
              ? "A autorização venceu ou foi revogada. Reconecte com o login do Facebook que enxerga as contas de anúncios dos clientes."
              : nuncaConectou
                ? "Conecte com o login do Facebook que enxerga as contas de anúncios dos clientes. Até lá, o relatório tenta usar o token antigo da agência, que pode parar sem aviso."
                : "Conecte com o login do Facebook que enxerga as contas de anúncios dos clientes."}
          </p>
          {adsStatus.connection_status === "disconnected" && adsStatus.disconnected_at && (
            <p className="mt-1 text-xs text-muted-foreground">
              Desconectado
              {adsStatus.disconnected_by_name && (
                <> por <span className="font-medium text-foreground">{adsStatus.disconnected_by_name}</span></>
              )}{" "}
              em {formatarQuando(adsStatus.disconnected_at)}.
            </p>
          )}
          {adsStatus.can_manage ? (
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => conectar.mutate("agency")}
              disabled={conectar.isPending}
            >
              {conectar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {precisaReconectar ? "Reconectar Meta Ads" : "Conectar Meta Ads"}
            </Button>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Peça para um ADM, Head ou quem tem a função Tráfego Pago conectar.
            </p>
          )}
        </div>
      ) : null}

      {/* Perfil do próprio cliente: conectado na ficha → Conexões. Aqui só o
          status, com atalho — um lugar só para conectar. */}
      {clientStatus && (
        <div
          className={cn(
            "mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3",
            clientePrecisaReconectar
              ? "border-destructive/30 bg-destructive/5"
              : clienteVenceEmBreve
                ? "border-warning/30 bg-warning-soft/30"
                : "border-border bg-muted/20",
          )}
        >
          <p className="flex min-w-0 items-start gap-2 text-sm">
            {clientePrecisaReconectar ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            ) : (
              <UserRound
                className={cn("mt-0.5 h-4 w-4 shrink-0", clienteConectado ? "text-brand" : "text-muted-foreground")}
              />
            )}
            <span>
              {clienteConectado ? (
                <>
                  Meta Ads com o perfil do cliente: conectado
                  {clientStatus.meta_user_name && (
                    <> (<span className="font-medium">{clientStatus.meta_user_name}</span>)</>
                  )}
                  {clienteDias !== null && clienteDias >= 0 && ` · vence em ${clienteDias} dia${clienteDias === 1 ? "" : "s"}`}
                  . O relatório usa esse perfil.
                </>
              ) : clientePrecisaReconectar ? (
                "Meta Ads com o perfil do cliente: a Meta recusou a autorização. Reconecte na ficha do cliente."
              ) : (
                <span className="text-muted-foreground">
                  Meta Ads com o perfil do cliente: não conectado — o relatório usa a conexão Meta Ads da agência. (O Instagram do cliente é outra conexão.)
                </span>
              )}
            </span>
          </p>
          <Button asChild size="sm" variant={clientePrecisaReconectar || clienteVenceEmBreve ? "outline" : "ghost"}>
            <Link to={`/plannings/cliente/${clientId}?secao=conexoes`}>
              {clienteConectado && !clienteVenceEmBreve ? "Gerenciar na ficha" : "Conectar na ficha do cliente"}
            </Link>
          </Button>
        </div>
      )}

      <AlertDialog
        open={confirmarDesconexao !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setConfirmarDesconexao(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmarDesconexao === "client"
                ? "Desconectar o perfil do cliente?"
                : "Desconectar o Meta Ads da agência?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmarDesconexao === "client"
                ? "O relatório deste cliente volta a usar a conexão da agência. Se a conta de anúncios só aparece para o perfil do cliente, o tráfego pago dele para de carregar. Os posts programados não são afetados."
                : "O relatório de tráfego pago para de funcionar para os clientes que usam a conexão da agência até alguém conectar de novo. Clientes conectados com o próprio perfil, as contas vinculadas e os posts programados não são afetados."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmarDesconexao) desconectar.mutate(confirmarDesconexao);
              }}
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Vínculo da conta de anúncios */}
      {currentAccount ? (
        <p className="mb-3 text-sm text-muted-foreground">
          Conta vinculada:{" "}
          <span className="font-medium text-foreground">
            {currentAccount.ad_account_name ?? currentAccount.ad_account_id}
          </span>{" "}
          <span className="text-xs">(act_{currentAccount.ad_account_id})</span>
        </p>
      ) : (
        <p className="mb-3 text-sm text-amber-600">
          Nenhuma conta de anúncios vinculada a este cliente ainda.
        </p>
      )}

      {canEdit && (
        <div className="mb-4 space-y-2">
          <Button size="sm" variant="outline" onClick={handleLoadAccounts} disabled={loadingAccounts}>
            {loadingAccounts ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
            {accounts ? "Recarregar contas" : (currentAccount ? "Trocar conta" : "Vincular conta de anúncios")}
          </Button>
          {accounts && accounts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Select onValueChange={handleSaveAccount} disabled={savingAccount}>
                <SelectTrigger className="max-w-sm"><SelectValue placeholder="Escolher conta para este cliente" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.account_id} value={a.account_id}>
                      {a.name ?? a.account_id} (act_{a.account_id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {savingAccount && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
          )}
        </div>
      )}

      {/* Puxar relatório do período */}
      <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Período</label>
          <Select value={periodKey} onValueChange={setPeriodKey}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {period.key === "custom" && (
          <>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">De</label>
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-40" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Até</label>
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-40" />
            </div>
          </>
        )}
        <Button onClick={handlePullReport} disabled={loadingReport || !currentAccount}>
          {loadingReport ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <DollarSign className="mr-1 h-4 w-4" />}
          Puxar tráfego pago
        </Button>
        {!currentAccount && <span className="text-xs text-amber-600">Vincule uma conta primeiro.</span>}
      </div>

      {report && (
        <div className="mt-4 space-y-4">
          {report.fonte && (
            <p className="text-xs text-muted-foreground">
              {report.fonte === "client"
                ? "Números lidos com o perfil do cliente."
                : report.fonte === "agency"
                  ? "Números lidos com a conexão da agência."
                  : "Números lidos com o token antigo da agência."}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Investimento", value: cf.format(report.totais.gasto) },
              { label: "Impressões", value: nf.format(report.totais.impressoes) },
              { label: "Alcance", value: nf.format(report.totais.alcance) },
              { label: "Cliques", value: nf.format(report.totais.cliques) },
            ].map((m) => (
              <div key={m.label} className="rounded-xl bg-muted/40 p-3 text-center">
                <p className="text-lg font-semibold tabular-nums">{m.value}</p>
                <p className="text-[11px] text-muted-foreground">{m.label}</p>
              </div>
            ))}
          </div>

          {report.totais.acoes.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Resultados</p>
              {principais.length > 0 ? (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {principais.map((a) => {
                    const custo = report.totais.custo_por_acao.find((c) => c.action_type === a.action_type);
                    return (
                      <div key={a.action_type} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-1.5 text-sm">
                        <span className="truncate">{ACTION_LABELS[a.action_type]}</span>
                        <span className="font-medium tabular-nums">
                          {nf.format(Number(a.value))}
                          {custo && <span className="ml-2 text-xs text-muted-foreground">· {cf.format(Number(custo.value))}/un</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Sem resultados principais neste período.</p>
              )}

              {outras.length > 0 && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setShowAllActions((v) => !v)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAllActions ? "rotate-180" : ""}`} />
                    {showAllActions ? "Ocultar" : `Ver outras métricas (${outras.length})`}
                  </button>
                  {showAllActions && (
                    <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                      {outras.map((a) => {
                        const custo = report.totais.custo_por_acao.find((c) => c.action_type === a.action_type);
                        return (
                          <div key={a.action_type} className="flex items-center justify-between rounded-lg bg-muted/20 px-3 py-1.5 text-sm">
                            <span className="truncate text-muted-foreground">{prettyAction(a.action_type)}</span>
                            <span className="font-medium tabular-nums">
                              {nf.format(Number(a.value))}
                              {custo && <span className="ml-2 text-xs text-muted-foreground">· {cf.format(Number(custo.value))}/un</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Campanhas no período</p>
            {report.campanhas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma campanha com dados no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3">Campanha</th>
                      <th className="py-2 pr-3 text-right">Gasto</th>
                      <th className="py-2 pr-3 text-right">Alcance</th>
                      <th className="py-2 text-right">Cliques</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.campanhas.map((c, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <div className="font-medium">{c.nome ?? "—"}</div>
                          {c.objetivo && <div className="text-[11px] text-muted-foreground">{c.objetivo}</div>}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{cf.format(c.gasto)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{nf.format(c.alcance)}</td>
                        <td className="py-2 text-right tabular-nums">{nf.format(c.cliques)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
