import { useMemo, useState } from "react";
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
import { toast } from "sonner";
import { DollarSign, Loader2, Megaphone, RefreshCw } from "lucide-react";
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

function lastMonths(n: number): { key: string; label: string; from: string; to: string }[] {
  const out: { key: string; label: string; from: string; to: string }[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const from = new Date(d.getFullYear(), d.getMonth(), 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
      from: iso(from),
      to: iso(to),
    });
  }
  return out;
}

// Seção de Tráfego Pago (Meta Ads) para dentro do relatório de um cliente.
export function AdsReport({ clientId }: { clientId: string }) {
  const { user } = useAuth();
  const { organizationId, role } = useOrganization();
  const queryClient = useQueryClient();
  const canEdit = role === "owner" || role === "admin" || role === "manager" || role === "editor";

  const months = useMemo(() => lastMonths(6), []);
  const [monthKey, setMonthKey] = useState<string>(months[0].key);
  const month = months.find((m) => m.key === monthKey) ?? months[0];

  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [report, setReport] = useState<AdsInsights | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

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
    setLoadingReport(true);
    setReport(null);
    try {
      const data = await getAdsInsights({ clientId, from: month.from, to: month.to });
      setReport(data);
    } catch (e) {
      toast.error(`Erro ao puxar tráfego pago: ${(e as Error).message}`);
    } finally {
      setLoadingReport(false);
    }
  }

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

      {/* Puxar relatório do mês */}
      <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Mês</label>
          <Select value={monthKey} onValueChange={setMonthKey}>
            <SelectTrigger className="w-52 capitalize"><SelectValue /></SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m.key} value={m.key} className="capitalize">{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Resultados (por tipo de ação)</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {report.totais.acoes.map((a) => {
                  const custo = report.totais.custo_por_acao.find((c) => c.action_type === a.action_type);
                  return (
                    <div key={a.action_type} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-1.5 text-sm">
                      <span className="truncate text-muted-foreground">{a.action_type}</span>
                      <span className="font-medium tabular-nums">
                        {nf.format(Number(a.value))}
                        {custo && <span className="ml-2 text-xs text-muted-foreground">· {cf.format(Number(custo.value))}/un</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Campanhas no mês</p>
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
