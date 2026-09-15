import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, MessageCircle } from "lucide-react";
import { useOrganization } from "@/hooks/useOrganization";
import { loadTodaySummaries } from "@/lib/whatsapp";

/**
 * Card do Dashboard: só aparece quando saiu resumo do WhatsApp hoje. Sem
 * resumo (ou sem a migration aplicada) não ocupa espaço — igual aos outros
 * alertas do topo.
 */
export function WhatsAppForaDoHorarioCard() {
  const { organizationId } = useOrganization();
  const { data } = useQuery({
    queryKey: ["whatsapp-today", organizationId],
    queryFn: () => loadTodaySummaries(organizationId!),
    enabled: !!organizationId,
    retry: false,
    refetchInterval: 5 * 60 * 1000,
  });

  const total = data?.length ?? 0;
  if (total === 0) return null;
  const urgentes = (data ?? []).filter((resumo) => resumo.urgency === "alta").length;

  return (
    <Link to="/whatsapp" className="group block">
      <div className="nrt-glass flex items-center justify-between gap-4 rounded-2xl p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/10">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <MessageCircle className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight">Chegou fora do horário</p>
            <p className="text-xs text-muted-foreground">
              {total === 1 ? "1 resumo do WhatsApp hoje" : `${total} resumos do WhatsApp hoje`}
              {urgentes > 0 ? ` · ${urgentes} urgente${urgentes === 1 ? "" : "s"}` : ""}
            </p>
          </div>
        </div>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}
