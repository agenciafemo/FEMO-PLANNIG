import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ChevronDown, DollarSign, Loader2, Megaphone, RefreshCw } from "lucide-react";
import {
  type AdAccount,
  type AdsInsights,
  getAdsInsights,
  listAdAccounts,
  loadClientAdAccounts,
  setClientAdAccount,
} from "@/lib/adsRpc";

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
export function AdsReport({ clientId }: { clientId: string }) {
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

  async function handleLoadAccounts() {
    setLoadingAccounts(true);
    try {
      const list = await listAdAccounts();
      setAccounts(list);
      if (list.length === 0) toast.warning("O token não retornou nenhuma conta de anúncios.");
      else toast.success(`${list.length} conta(s) encontrada(s).`);
    } catch (e) {
      toast.error(`Erro ao listar contas: ${(e as Error).message}`);
    } finally {
      setLoadingAccounts(false);
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
    } catch (e) {
      toast.error(`Erro ao puxar tráfego pago: ${(e as Error).message}`);
    } finally {
      setLoadingReport(false);
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
