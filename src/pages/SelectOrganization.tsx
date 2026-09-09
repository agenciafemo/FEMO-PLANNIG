import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganizationContext } from "@/contexts/OrganizationContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, Search } from "lucide-react";
import { myOrganizationRequests, organizationRoleLabels, requestOrganizationAccess, searchOrganizations } from "@/lib/organizationAccess";
import TetrisLoading from "@/components/ui/tetris-loader";

export default function SelectOrganization() {
  const { memberships, switchOrganization, loading, error, refresh } = useOrganizationContext();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [switching, setSwitching] = useState<string | null>(null);
  const canCreateOrganization = memberships.some((membership) => membership.role === "owner" || membership.role === "admin");
  const directory = useQuery({
    queryKey: ["organization-directory", user?.id, search, offset],
    queryFn: () => searchOrganizations(search, offset), enabled: !!user && !loading && !error,
    staleTime: 0,
  });
  const requests = useQuery({
    queryKey: ["my-organization-requests", user?.id], queryFn: myOrganizationRequests,
    enabled: !!user && !loading && !error, staleTime: 0, refetchInterval: 15000, refetchOnWindowFocus: true,
  });
  const hasApprovedRequest = requests.data?.some((request) => request.status === "approved") ?? false;
  useEffect(() => {
    if (hasApprovedRequest) {
      void queryClient.invalidateQueries({ queryKey: ["organization-context", user?.id] });
    }
  }, [hasApprovedRequest, requests.dataUpdatedAt, queryClient, user?.id]);
  const request = useMutation({
    mutationFn: requestOrganizationAccess,
    onSuccess: async () => {
      toast.success("Solicitação enviada. Aguarde a aprovação da liderança.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-organization-requests", user?.id] }),
        queryClient.invalidateQueries({ queryKey: ["organization-directory", user?.id] }),
      ]);
    },
    onError: (failure: Error) => toast.error(failure.message),
  });
  const handleSelect = async (id: string) => {
    if (switching) return;
    setSwitching(id);
    try {
      await switchOrganization(id);
      navigate("/dashboard", { replace: true });
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Não foi possível entrar na agência");
    } finally { setSwitching(null); }
  };
  const handleSearch = (event: FormEvent) => {
    event.preventDefault(); setSearch(input.trim()); setOffset(0);
  };
  if (loading) return <div role="status" className="p-8 text-center">Carregando suas agências...</div>;

  return <main className="min-h-screen bg-background px-4 py-10">
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <img src="/brand/norteia/logo/NORTEIA.png" alt="Norteia" className="mb-6 h-8 dark:brightness-0 dark:invert" />
        <h1 className="text-2xl font-semibold">Qual agência você quer acessar?</h1>
        <p className="text-muted-foreground">Entre na sua equipe ou solicite acesso a uma agência. Você não precisa criar outra.</p>
        <div className="flex items-center justify-between gap-3 text-sm"><span className="break-all">{user?.email}</span><Button variant="ghost" onClick={() => void signOut()}>Sair / trocar conta</Button></div>
      </header>
      {error ? <section role="alert" className="space-y-3 rounded-xl border p-5">
        <p>{error}</p><Button onClick={() => void refresh().catch(() => toast.error("Não foi possível atualizar suas agências."))}>Tentar novamente</Button>
      </section> : <>
        <section aria-label="Minhas agências" className="space-y-3">
          <h2 className="font-semibold">Minhas agências</h2>
          {memberships.length === 0 ? <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">Você ainda não participa de uma agência. Procure sua equipe abaixo ou abra o link de convite recebido.</p> : <div className="grid gap-3 sm:grid-cols-2">
            {memberships.map((member) => <button key={member.organizationId} disabled={!!switching} onClick={() => void handleSelect(member.organizationId)} className="flex items-center gap-3 rounded-xl border bg-card p-5 text-left hover:border-primary disabled:opacity-50">
              <Building2 className="h-6 w-6 shrink-0 text-primary" /><span className="min-w-0"><span className="block truncate font-semibold">{member.organizationName}</span><span className="text-sm text-muted-foreground">{organizationRoleLabels[member.role]} · {switching === member.organizationId ? "Entrando..." : "Entrar"}</span></span>
            </button>)}
          </div>}
        </section>
        <section aria-label="Meus pedidos" className="space-y-3">
          <h2 className="font-semibold">Meus pedidos</h2>
          {requests.isError ? <p role="alert">Não foi possível consultar seus pedidos. <button className="underline" onClick={() => void requests.refetch()}>Tentar novamente</button></p> : requests.isPending ? <p role="status">Carregando pedidos...</p> :
            !requests.data.length ? <p className="text-sm text-muted-foreground">Nenhuma solicitação enviada.</p> : requests.data.map((item) => item.status === "pending" ? (
              <div key={item.id} role="status" aria-live="polite" className="flex items-center gap-5 rounded-xl border bg-card p-5 sm:p-6">
                <TetrisLoading size="sm" />
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm text-muted-foreground">{item.organization_name}</p>
                  <p className="font-semibold">Esperando autorização da equipe</p>
                  <p className="text-sm text-muted-foreground">Assim que um líder aprovar, esta agência aparecerá em “Minhas agências”. Você ainda não tem acesso aos dados.</p>
                </div>
              </div>
            ) : <div key={item.id} className="rounded-xl border bg-card p-4">
              <p className="font-medium">{item.organization_name}</p>
              <p className="text-sm text-muted-foreground">{item.status === "approved" ? "Pedido aprovado. Se o vínculo continuar ativo, a agência aparece em Minhas agências." : "Pedido recusado. Fale com a liderança da agência."}</p>
            </div>)}
        </section>
        <section aria-label="Encontrar agência" className="space-y-4 rounded-2xl border bg-card p-5">
          <div><h2 className="font-semibold">Encontrar minha agência</h2><p className="text-sm text-muted-foreground">Aparecem apenas agências que permitem solicitações. Se não encontrar a sua, peça um convite ao líder.</p></div>
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input aria-label="Nome ou identificador da agência" placeholder="Ex.: Femo" value={input} onChange={(event) => setInput(event.target.value)} maxLength={100} />
            <Button type="submit" variant="outline"><Search className="mr-2 h-4 w-4" />Buscar</Button>
          </form>
          {directory.isPending ? <p role="status">Buscando agências...</p> : directory.isError ? <div role="alert"><p>A busca está indisponível no momento.</p><Button variant="outline" onClick={() => void directory.refetch()}>Tentar novamente</Button></div> :
            directory.data.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma agência disponível nesta busca. Você não precisa criar uma nova para entrar na equipe existente.</p> :
            directory.data.map((agency) => <div key={agency.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <div><p className="font-medium">{agency.name}</p><p className="text-xs text-muted-foreground">@{agency.slug}</p></div>
              <Button variant="outline" disabled={request.isPending || !!agency.request_status} onClick={() => request.mutate(agency.id)}>
                {agency.request_status === "pending" ? "Aguardando aprovação" : agency.request_status ? "Pedido analisado" : "Solicitar acesso"}
              </Button>
            </div>)}
          <div className="flex justify-between">
            <Button variant="ghost" disabled={offset === 0 || directory.isFetching} onClick={() => setOffset((value) => Math.max(0, value - 20))}>Anterior</Button>
            <Button variant="ghost" disabled={directory.data?.length !== 20 || directory.isFetching} onClick={() => setOffset((value) => value + 20)}>Próxima</Button>
          </div>
        </section>
        {canCreateOrganization && <footer className="border-t pt-5 text-sm text-muted-foreground">
          <p>Precisa administrar outra operação separada?</p>
          <Button variant="link" className="px-0 text-foreground underline underline-offset-4" onClick={() => navigate("/organizations/new")}>Criar outra agência</Button>
        </footer>}
      </>}
    </div>
  </main>;
}
