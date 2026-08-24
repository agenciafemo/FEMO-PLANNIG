import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarX2, CircleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

// A partir deste dia do mês, cliente sem conteúdo planejado vira alerta.
const DIA_LIMITE = 15;

type ClientRow = { id: string; name: string; traffic_only: boolean | null };

type Pendencia = {
  client: ClientRow;
  motivo: "sem_planejamento" | "planejamento_vazio";
};

// Avisa quais clientes chegaram ao dia 15 do mês sem conteúdo: nenhum
// planejamento criado, ou planejamento criado e ainda sem nenhuma peça.
// Clientes marcados como "só tráfego pago" ficam de fora — eles não têm
// planejamento de conteúdo por definição.
export function ClientAttentionAlert() {
  const { organizationId, isLegacy } = useOrganization();

  const hoje = new Date();
  const passouDoLimite = hoje.getDate() >= DIA_LIMITE;
  const mes = hoje.getMonth() + 1;
  const ano = hoje.getFullYear();

  const query = useQuery({
    queryKey: ["client-attention", organizationId, mes, ano],
    queryFn: async (): Promise<Pendencia[]> => {
      let clientsQuery = (supabase as AnyClient)
        .from("clients").select("id,name,traffic_only").order("name");
      if (!isLegacy) clientsQuery = clientsQuery.eq("organization_id", organizationId);
      const { data: clients, error } = await clientsQuery;
      if (error) throw error;

      const alvo = ((clients ?? []) as ClientRow[]).filter((c) => !c.traffic_only);
      if (alvo.length === 0) return [];

      // Planejamentos do mês corrente desses clientes.
      const { data: plannings, error: plErr } = await (supabase as AnyClient)
        .from("plannings").select("id,client_id")
        .in("client_id", alvo.map((c) => c.id))
        .eq("month", mes).eq("year", ano);
      if (plErr) throw plErr;

      const planningPorCliente = new Map<string, string>();
      for (const p of (plannings ?? []) as Array<{ id: string; client_id: string }>) {
        planningPorCliente.set(p.client_id, p.id);
      }

      // Quais desses planejamentos já têm ao menos uma peça.
      const ids = [...planningPorCliente.values()];
      const comPost = new Set<string>();
      if (ids.length > 0) {
        const { data: posts, error: postErr } = await (supabase as AnyClient)
          .from("posts").select("planning_id").in("planning_id", ids);
        if (postErr) throw postErr;
        for (const post of (posts ?? []) as Array<{ planning_id: string }>) {
          comPost.add(post.planning_id);
        }
      }

      return alvo.flatMap<Pendencia>((client) => {
        const planningId = planningPorCliente.get(client.id);
        if (!planningId) return [{ client, motivo: "sem_planejamento" }];
        if (!comPost.has(planningId)) return [{ client, motivo: "planejamento_vazio" }];
        return [];
      });
    },
    enabled: passouDoLimite && (isLegacy || !!organizationId),
    retry: false,
  });

  const pendentes = query.data ?? [];
  if (!passouDoLimite || pendentes.length === 0) return null;

  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
          <CalendarX2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-destructive">
            {pendentes.length === 1
              ? "1 cliente está sem conteúdo planejado este mês"
              : `${pendentes.length} clientes estão sem conteúdo planejado este mês`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Já passou do dia {DIA_LIMITE}. Quem só faz tráfego pago não entra aqui —
            marque isso na ficha do cliente.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {pendentes.map(({ client, motivo }) => (
              <Link
                key={client.id}
                to={`/clients/${client.id}/plannings`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-destructive/60 hover:bg-destructive/10"
                title={motivo === "sem_planejamento"
                  ? "Nenhum planejamento criado para este mês"
                  : "Planejamento criado, mas ainda sem nenhuma peça"}
              >
                <CircleAlert className="h-3.5 w-3.5 text-destructive" />
                {client.name}
                <span className="text-muted-foreground">
                  {motivo === "sem_planejamento" ? "sem planejamento" : "sem peças"}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
