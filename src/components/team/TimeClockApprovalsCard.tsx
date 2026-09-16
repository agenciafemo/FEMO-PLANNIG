import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clock3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";

/**
 * Card do Dashboard de quem aprova o Ponto (ADM/Head).
 *
 * Um pedido de ajuste de horário só aparecia para quem abrisse a aba "Visão da
 * equipe" do Ponto — quem pediu ficava esperando sem ninguém saber. O card
 * aparece apenas quando há pedido em aberto, e só para quem pode responder.
 */

// can_view_team_time_clock não consta no types.ts gerado.
type PontoRpc = {
  rpc(fn: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: Error | null }>;
};

async function contarPendentes(
  relation: "time_clock_adjustment_requests" | "time_clock_absences",
  organizationId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from(relation)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

export function TimeClockApprovalsCard() {
  const { user } = useAuth();
  const { organizationId, isLegacy } = useOrganization();

  const permissaoQuery = useQuery({
    queryKey: ["time-clock-team-permission", organizationId, user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as PontoRpc).rpc(
        "can_view_team_time_clock",
        { _organization_id: organizationId! },
      );
      if (error) throw error;
      return data === true;
    },
    enabled: !!user && !!organizationId && !isLegacy,
    retry: false,
  });

  const podeAprovar = permissaoQuery.data === true;

  const pendentesQuery = useQuery({
    queryKey: ["time-clock-pendentes", organizationId],
    queryFn: async () => {
      const [ajustes, ausencias] = await Promise.all([
        contarPendentes("time_clock_adjustment_requests", organizationId!),
        contarPendentes("time_clock_absences", organizationId!),
      ]);
      return { ajustes, ausencias };
    },
    enabled: podeAprovar && !!organizationId,
    retry: false,
    refetchInterval: 5 * 60 * 1000,
  });

  const ajustes = pendentesQuery.data?.ajustes ?? 0;
  const ausencias = pendentesQuery.data?.ausencias ?? 0;
  const total = ajustes + ausencias;
  if (!podeAprovar || total === 0) return null;

  const partes = [
    ajustes > 0 ? `${ajustes} ${ajustes === 1 ? "horário" : "horários"}` : null,
    ausencias > 0 ? `${ausencias} ${ausencias === 1 ? "ausência" : "ausências"}` : null,
  ].filter(Boolean);

  return (
    <Link to="/ponto" className="group block">
      <div className="nrt-glass flex items-center justify-between gap-4 rounded-2xl p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/10">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
            <Clock3 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight">
              {total === 1 ? "1 pedido do Ponto esperando você" : `${total} pedidos do Ponto esperando você`}
            </p>
            <p className="text-xs text-muted-foreground">
              {partes.join(" · ")} para aprovar ou recusar
            </p>
          </div>
        </div>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}
