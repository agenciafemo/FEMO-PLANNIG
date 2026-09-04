import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOrganization } from "@/hooks/useOrganization";
import {
  getGoogleBusinessStatus,
  googleBusinessErrorMessage,
  GoogleBusinessFunctionError,
  listGoogleBusinessLocations,
  selectGoogleBusinessLocation,
  startGoogleBusinessOAuth,
  type GoogleBusinessLocation,
} from "@/lib/googleBusiness";

function friendlyError(error: unknown): string {
  const reason = error instanceof GoogleBusinessFunctionError
    ? error.reasonCode
    : error instanceof Error
    ? error.message
    : "unknown";
  return googleBusinessErrorMessage(reason);
}

function address(location: GoogleBusinessLocation): string {
  const value = location.storefrontAddress;
  if (!value) return "";
  return [
    ...(value.addressLines ?? []),
    value.locality,
    value.administrativeArea,
  ].filter(Boolean).join(", ");
}

export function GoogleBusinessConnection({ clientId }: { clientId: string }) {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const [locationsOpen, setLocationsOpen] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["google-business-status", organizationId, clientId],
    queryFn: () => getGoogleBusinessStatus(organizationId!, clientId),
    enabled: !!organizationId && !!clientId,
    retry: false,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackStatus = params.get("google_business_status");
    if (!callbackStatus) return;
    if (callbackStatus === "connected") {
      toast.success("Conta Google conectada. Agora escolha a unidade do cliente.");
      void queryClient.invalidateQueries({ queryKey: ["google-business-status"] });
      setLocationsOpen(true);
    } else {
      toast.error(
        googleBusinessErrorMessage(
          params.get("reason_code") ?? "google_business_oauth_callback_failed",
        ),
      );
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("google_business_status");
    url.searchParams.delete("reason_code");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [queryClient]);

  const connect = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("organization_id_invalid");
      return startGoogleBusinessOAuth(organizationId, window.location.pathname);
    },
    onSuccess: (authorizeUrl) => window.location.assign(authorizeUrl),
    onError: (error) => toast.error(friendlyError(error)),
  });

  const locationsQuery = useQuery({
    queryKey: ["google-business-locations", organizationId, clientId],
    queryFn: () => listGoogleBusinessLocations(organizationId!, clientId),
    enabled: locationsOpen && !!organizationId,
    retry: false,
  });

  const selectLocation = useMutation({
    mutationFn: (location: GoogleBusinessLocation) =>
      selectGoogleBusinessLocation(organizationId!, clientId, location),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["google-business-status", organizationId, clientId],
      });
      setLocationsOpen(false);
      toast.success("Unidade Google vinculada ao cliente.");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  if (statusQuery.isLoading) {
    return <div className="text-xs text-muted-foreground">Carregando Google…</div>;
  }

  if (statusQuery.isError) {
    return (
      <div className="rounded-2xl border border-warning/30 bg-warning-soft/30 p-4 text-sm">
        <p className="font-medium">Perfil da Empresa ainda não configurado</p>
        <p className="mt-1 text-xs text-muted-foreground">
          A integração precisa da migration e das Edge Functions no Supabase.
        </p>
      </div>
    );
  }

  const status = statusQuery.data;
  const active = status?.connection_status === "active";
  const selected = active && !!status.google_location_name;
  const reconnect =
    status?.connection_status === "reauth_required" ||
    status?.connection_status === "error";

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-brand" />
              <h2 className="text-sm font-semibold">Perfil da Empresa no Google</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Conecte a unidade para trazer visualizações, ligações, rotas e cliques
              ao relatório deste cliente.
            </p>
          </div>
          {selected && <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />}
        </div>

        {selected ? (
          <div className="mt-4 rounded-xl border border-border/70 bg-muted/20 p-3">
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{status.location_title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {status.google_account_email}
                </p>
              </div>
              {status.can_manage && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLocationsOpen(true)}
                >
                  Trocar unidade
                </Button>
              )}
            </div>
          </div>
        ) : reconnect ? (
          <div className="mt-4 rounded-xl border border-warning/40 bg-warning-soft/30 p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Reconexão necessária
            </p>
            {status.can_manage && (
              <Button
                className="mt-3"
                size="sm"
                onClick={() => connect.mutate()}
                disabled={connect.isPending}
              >
                {connect.isPending
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <RefreshCw className="mr-2 h-4 w-4" />}
                Reconectar Google
              </Button>
            )}
          </div>
        ) : active ? (
          <div className="mt-4">
            <p className="mb-3 text-xs text-muted-foreground">
              Conta conectada: {status.google_account_email}. Falta escolher qual
              unidade pertence a este cliente.
            </p>
            {status.can_manage && (
              <Button size="sm" onClick={() => setLocationsOpen(true)}>
                <MapPin className="mr-2 h-4 w-4" /> Escolher unidade
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-4">
            {status?.can_manage ? (
              <Button
                size="sm"
                onClick={() => connect.mutate()}
                disabled={connect.isPending}
              >
                {connect.isPending
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <ExternalLink className="mr-2 h-4 w-4" />}
                Conectar conta Google da agência
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Peça para um ADM ou Head conectar a conta Google da agência.
              </p>
            )}
          </div>
        )}
      </div>

      <Dialog open={locationsOpen} onOpenChange={setLocationsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Escolher unidade do Google</DialogTitle>
            <DialogDescription>
              Selecione o Perfil da Empresa que pertence a este cliente. Uma
              unidade não pode ser vinculada a dois clientes.
            </DialogDescription>
          </DialogHeader>
          {locationsQuery.isLoading ? (
            <div className="flex min-h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : locationsQuery.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p>{friendlyError(locationsQuery.error)}</p>
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={() => locationsQuery.refetch()}
              >
                Tentar novamente
              </Button>
            </div>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {(locationsQuery.data ?? []).map((location) => (
                <button
                  key={location.name}
                  type="button"
                  disabled={selectLocation.isPending}
                  onClick={() => selectLocation.mutate(location)}
                  className="w-full rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                >
                  <p className="text-sm font-medium">{location.title}</p>
                  {address(location) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {address(location)}
                    </p>
                  )}
                  {location.storeCode && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Código: {location.storeCode}
                    </p>
                  )}
                </button>
              ))}
              {(locationsQuery.data ?? []).length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nenhuma unidade foi encontrada nessa conta Google.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
