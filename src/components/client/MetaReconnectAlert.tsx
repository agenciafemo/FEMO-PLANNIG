import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { getClientMetaStatus } from "@/lib/metaRpc";
import { META_CONNECT_ENABLED } from "@/lib/featureFlags";

// Estados de uma conexão Meta que exigem reconexão (token invalidado / erro).
// not_connected / disconnected / pending NÃO entram: são ausência de conexão,
// não uma conexão quebrada. Espelha o que o InstagramConnection trata como
// "Reconectar".
const NEEDS_RECONNECT = new Set(["reauth_required", "error"]);

type ClientRow = { id: string; name: string };

// Banner global que avisa quais clientes tiveram a conexão com o Instagram/Meta
// quebrada (o problema recorrente de token expirado). Só aparece quando há de
// fato contas a reconectar. Silencioso em qualquer falha (best-effort).
export function MetaReconnectAlert() {
  const { organizationId, isLegacy } = useOrganization();

  const clientsQuery = useQuery({
    queryKey: ["meta-reconnect-clients", organizationId],
    queryFn: async () => {
      let query = supabase.from("clients").select("id,name").order("name") as any;
      if (!isLegacy) query = query.eq("organization_id", organizationId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as ClientRow[];
    },
    enabled: META_CONNECT_ENABLED && (isLegacy || !!organizationId),
    retry: false,
  });

  const clients = clientsQuery.data ?? [];

  const reconnectQuery = useQuery({
    queryKey: ["meta-reconnect-status", organizationId, clients.map((client) => client.id).join(",")],
    queryFn: async () => {
      const checks = await Promise.all(
        clients.map(async (client) => {
          try {
            const rows = await getClientMetaStatus(client.id);
            const broken = rows.some((row) => NEEDS_RECONNECT.has(row.connection_status));
            return broken ? client : null;
          } catch {
            return null;
          }
        }),
      );
      return checks.filter((client): client is ClientRow => client !== null);
    },
    enabled: META_CONNECT_ENABLED && clients.length > 0,
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  });

  const needing = reconnectQuery.data ?? [];

  if (!META_CONNECT_ENABLED || needing.length === 0) return null;

  return (
    <div className="rounded-2xl border border-warning/30 bg-warning-soft/60 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-warning">
            {needing.length === 1
              ? "1 conta precisa de reconexão com o Instagram/Meta"
              : `${needing.length} contas precisam de reconexão com o Instagram/Meta`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A publicação e as métricas dessas contas ficam pausadas até reconectar.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {needing.map((client) => (
              <Link
                key={client.id}
                to={`/plannings/cliente/${client.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-warning/30 bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-warning/60 hover:bg-warning-soft"
              >
                <Link2 className="h-3.5 w-3.5 text-warning" />
                {client.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
