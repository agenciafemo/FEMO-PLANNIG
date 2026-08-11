import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };

interface FilterBuilder<T> extends PromiseLike<QueryResult<T>> {
  select(columns?: string): FilterBuilder<T>;
  eq(column: string, value: unknown): FilterBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): FilterBuilder<T>;
  limit(count: number): FilterBuilder<T>;
}

const timeClockDb = supabase as unknown as {
  from<T>(relation: string): FilterBuilder<T>;
  rpc<T>(name: string, params: Record<string, unknown>): PromiseLike<QueryResult<T>>;
};

type PendingRequest = {
  id: string;
  user_id: string;
  requested_punched_at: string;
  kind: "entrada" | "saida_almoco" | "volta_almoco" | "saida";
  reason: string;
};

type TeamMember = {
  user_id: string;
  display_name: string;
};

const KIND_LABELS: Record<PendingRequest["kind"], string> = {
  entrada: "Entrada",
  saida_almoco: "Saída para almoço",
  volta_almoco: "Volta do almoço",
  saida: "Saída",
};

export function TimeClockReviewBell() {
  const { user } = useAuth();
  const { organizationId, isLegacy } = useOrganization();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const permissionQuery = useQuery({
    queryKey: ["time-clock-review-notification-permission", organizationId, user?.id],
    queryFn: async () => {
      const result = await timeClockDb.rpc<boolean>("can_view_team_time_clock", {
        _organization_id: organizationId!,
      });
      if (result.error) return false;
      return result.data === true;
    },
    enabled: !!user && !!organizationId && !isLegacy,
    retry: false,
  });

  const requestsQuery = useQuery({
    queryKey: ["time-clock-pending-adjustments", organizationId],
    queryFn: async () => {
      const result = await timeClockDb
        .from<PendingRequest[]>("time_clock_adjustment_requests")
        .select("id, user_id, requested_punched_at, kind, reason")
        .eq("organization_id", organizationId!)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(20);
      return result.error ? [] : result.data ?? [];
    },
    enabled: permissionQuery.data === true && !!organizationId,
    refetchInterval: 30_000,
    retry: false,
  });

  const membersQuery = useQuery({
    queryKey: ["time-clock-review-notification-members", organizationId],
    queryFn: async () => {
      const result = await timeClockDb.rpc<TeamMember[]>("get_task_assignees", {
        _organization_id: organizationId!,
      });
      return result.error ? [] : result.data ?? [];
    },
    enabled: permissionQuery.data === true && !!organizationId,
    retry: false,
  });

  if (permissionQuery.data !== true) return null;

  const requests = requestsQuery.data ?? [];
  const memberName = (userId: string) =>
    membersQuery.data?.find((member) => member.user_id === userId)?.display_name ?? "Colaborador";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={requests.length > 0 ? `${requests.length} ajustes de ponto pendentes` : "Ajustes de ponto"}
        >
          <Clock3 className={cn("h-5 w-5", requests.length > 0 && "nrt-clock-attention text-warning")} />
          {requests.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-warning-foreground ring-2 ring-background">
              {requests.length > 9 ? "9+" : requests.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Ajustes de ponto</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {requests.length === 0 ? "Nenhuma solicitação pendente" : `${requests.length} aguardando análise`}
          </p>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {requests.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Tudo em dia.</p>
          ) : (
            requests.slice(0, 5).map((request) => (
              <div key={request.id} className="border-b px-4 py-3 last:border-0">
                <div className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warning" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{memberName(request.user_id)}</p>
                    <p className="text-xs text-muted-foreground">
                      {KIND_LABELS[request.kind]} · {format(new Date(request.requested_punched_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{request.reason}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="border-t p-2">
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setOpen(false);
              navigate("/ponto#ajustes-ponto");
            }}
          >
            Abrir análise do ponto
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
