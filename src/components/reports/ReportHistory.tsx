import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FileClock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { loadReportHistory, type ReportHistoryItem } from "@/lib/reportHistory";

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value.length <= 10 ? `${value}T12:00:00-03:00` : value);
  return format(d, "dd/MM/yyyy");
}

function num(dados: Record<string, unknown> | null, key: string): number | null {
  const v = dados?.[key];
  return typeof v === "number" ? v : null;
}

export function ReportHistory({
  organizationId,
  clientId,
}: {
  organizationId: string;
  clientId: string;
}) {
  const [viewing, setViewing] = useState<ReportHistoryItem | null>(null);

  const historyQuery = useQuery({
    queryKey: ["report-history", organizationId, clientId],
    queryFn: () => loadReportHistory(organizationId, clientId),
    enabled: !!organizationId && !!clientId,
  });

  if (!clientId) return null;
  const items = historyQuery.data ?? [];
  const metricas = viewing?.metricas ?? null;

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <FileClock className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-semibold">Histórico de relatórios deste cliente</h3>
      </div>

      {historyQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum relatório gerado ainda. Os que você gerar a partir de agora ficam salvos aqui.
        </p>
      ) : (
        <div className="divide-y">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  Gerado em {format(new Date(item.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                </p>
                <p className="text-xs text-muted-foreground">
                  Período: {fmtDate(item.period_from)} — {fmtDate(item.period_to)}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setViewing(item)}>Ver</Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!viewing} onOpenChange={(v) => { if (!v) setViewing(null); }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Relatório de {viewing ? fmtDate(viewing.period_from) : ""} a {viewing ? fmtDate(viewing.period_to) : ""}
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              {/* Números do período */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "Posts no período", value: num(viewing.dados, "total_posts_no_periodo") },
                  { label: "Publicados", value: num(viewing.dados, "publicados_no_instagram_via_norteia") },
                  { label: "Seguidores", value: metricas ? (metricas["seguidores"] as number | null) : null },
                  { label: "Alcance", value: metricas ? (metricas["alcance_no_periodo"] as number | null) : null },
                ].map((m) => (
                  <div key={m.label} className="rounded-lg bg-muted/50 p-2.5 text-center">
                    <p className="text-lg font-semibold tabular-nums">{m.value ?? "—"}</p>
                    <p className="text-[11px] text-muted-foreground">{m.label}</p>
                  </div>
                ))}
              </div>

              {/* Análise da IA */}
              {viewing.analysis && (
                <div className="rounded-lg border border-border p-3">
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Análise</p>
                  <div className="space-y-2 whitespace-pre-wrap leading-6 text-foreground">
                    {viewing.analysis}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
