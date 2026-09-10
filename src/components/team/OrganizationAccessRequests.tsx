import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { organizationReviewQueue, reviewOrganizationRequest, setOrganizationDiscovery } from "@/lib/organizationAccess";

export function OrganizationAccessRequests({ organizationId, canConfigure }: { organizationId: string; canConfigure: boolean }) {
  const queryClient = useQueryClient();
  const key = ["organization-access-review", organizationId];
  const queue = useQuery({ queryKey: key, queryFn: () => organizationReviewQueue(organizationId), staleTime: 0, refetchInterval: 30000, refetchOnWindowFocus: true });
  const decision = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => reviewOrganizationRequest(id, approve),
    onSuccess: async (_, { approve }) => {
      toast.success(approve ? "Acesso aprovado como colaborador." : "Solicitação recusada.");
      await Promise.all([queryClient.invalidateQueries({ queryKey: key }), queryClient.invalidateQueries({ queryKey: ["team-function-management", organizationId] })]);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const discovery = useMutation({
    mutationFn: (enabled: boolean) => setOrganizationDiscovery(organizationId, enabled),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: key }); void queryClient.invalidateQueries({ queryKey: ["organization-directory"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  return <section className="space-y-4 rounded-2xl border bg-card p-5" aria-label="Solicitações de acesso">
    <div><h2 className="font-semibold">Solicitações de acesso</h2>
      <p className="text-sm text-muted-foreground">Só a liderança desta agência pode aprovar. O novo membro entra como colaborador, sem acesso administrativo automático.</p></div>
    {queue.isPending ? <p role="status">Carregando solicitações...</p> : queue.isError ? <div role="alert">
      <p>Não foi possível carregar as solicitações. Verifique se o recurso já está habilitado.</p>
      <Button variant="outline" onClick={() => void queue.refetch()}>Tentar novamente</Button>
    </div> : <>
      {canConfigure && <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={queue.data.accepts_join_requests} disabled={discovery.isPending}
          onChange={(event) => discovery.mutate(event.target.checked)} className="mt-1" />
        <span>Permitir que encontrem esta agência no Norteia
          <span className="block text-muted-foreground">Mostra apenas nome e identificador a usuários logados. Cada entrada continua exigindo aprovação.</span></span>
      </label>}
      {queue.data.requests.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma solicitação pendente.</p> : queue.data.requests.map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div className="min-w-0"><p className="break-all font-medium">{request.email}</p><p className="text-xs text-muted-foreground">Recebida em {new Date(request.created_at).toLocaleDateString("pt-BR")}</p></div>
        <div className="flex gap-2"><Button variant="outline" disabled={decision.isPending} onClick={() => decision.mutate({ id: request.id, approve: false })}>Recusar</Button>
          <Button disabled={decision.isPending} onClick={() => decision.mutate({ id: request.id, approve: true })}>Aprovar colaborador</Button></div>
      </div>)}
    </>}
  </section>;
}
