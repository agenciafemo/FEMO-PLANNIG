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
import { FileText, Sparkles, Loader2, Copy } from "lucide-react";
import { generateReport, type ReportResult } from "@/lib/reportRpc";
import { usePersistedState } from "@/hooks/usePersistedState";

export default function Relatorios() {
  const { user } = useAuth();
  const { organizationId, isLegacy } = useOrganization();
  const [selected, setSelected] = usePersistedState<string>("report-client", "");
  const [result, setResult] = useState<ReportResult | null>(null);

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
    mutationFn: () => generateReport({ clientId }),
    onSuccess: (r) => setResult(r),
    onError: (e: unknown) => toast.error("Erro ao gerar: " + (e as Error).message),
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
          A IA analisa a atividade dos últimos 30 dias deste cliente (produção, formatos,
          status do fluxo e publicações feitas pelo Norteia) e escreve uma análise pronta
          para apresentar. Métricas de engajamento (curtidas, alcance) ainda não entram —
          virão numa próxima etapa.
        </p>
        <Button
          className="mt-4"
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

      {result && (
        <div className="space-y-4">
          {/* Números que alimentaram a análise */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Posts no período" value={result.dados.total_posts_no_periodo} />
            <Metric label="Publicados (IG)" value={result.dados.publicados_no_instagram_via_norteia} />
            <Metric label="Formatos" value={Object.keys(result.dados.posts_por_formato).length} />
            <Metric label="Período" value={`${result.dados.periodo.de} → ${result.dados.periodo.ate}`} small />
          </div>

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
