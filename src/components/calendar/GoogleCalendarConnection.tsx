import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, CalendarSync, ExternalLink, Loader2, Unplug } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  googleCalendarErrorMessage,
  GoogleCalendarFunctionError,
  startGoogleCalendarOAuth,
  syncGoogleCalendar,
} from "@/lib/googleCalendar";

type Props = { organizationId: string | null };

function friendlyError(error: unknown): string {
  if (error instanceof GoogleCalendarFunctionError) {
    return googleCalendarErrorMessage(error.reasonCode);
  }
  if (error instanceof Error) return googleCalendarErrorMessage(error.message);
  return googleCalendarErrorMessage("unknown");
}

export function GoogleCalendarConnection({ organizationId }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["google-calendar-connection", organizationId],
    queryFn: () => getGoogleCalendarStatus(organizationId!),
    enabled: !!organizationId,
    retry: false,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackStatus = params.get("google_calendar_status");
    if (!callbackStatus) return;
    if (callbackStatus === "connected") {
      toast.success("Google Calendar conectado com sucesso.");
      void queryClient.invalidateQueries({ queryKey: ["google-calendar-connection"] });
      setOpen(true);
    } else {
      const reason = params.get("reason_code") ?? "google_oauth_callback_failed";
      toast.error(googleCalendarErrorMessage(reason));
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("google_calendar_status");
    url.searchParams.delete("reason_code");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [queryClient]);

  const connect = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("organization_id_invalid");
      return startGoogleCalendarOAuth(organizationId);
    },
    onSuccess: (authorizeUrl) => window.location.assign(authorizeUrl),
    onError: (error) => toast.error(friendlyError(error)),
  });

  const sync = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("organization_id_invalid");
      return syncGoogleCalendar({ organizationId, operation: "reconcile" });
    },
    onSuccess: async ({ result }) => {
      await queryClient.invalidateQueries({ queryKey: ["google-calendar-connection", organizationId] });
      if (typeof result === "object") {
        const detail = `${result.synced} sincronizado(s), ${result.deleted} removido(s)`;
        if (result.failed > 0) {
          toast.warning(`Sincronização parcial: ${detail}; ${result.failed} falha(s).`);
        } else {
          toast.success(`Google Calendar atualizado: ${detail}.`);
        }
      } else {
        toast.success("Google Calendar atualizado.");
      }
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("organization_id_invalid");
      await disconnectGoogleCalendar(organizationId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["google-calendar-connection", organizationId] });
      setConfirmDisconnect(false);
      toast.success("Google Calendar desconectado. Os eventos já criados no Google foram preservados.");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const status = statusQuery.data;
  const active = status?.connection_status === "active";
  const needsReconnect = status?.connection_status === "reauth_required" || status?.connection_status === "error";

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={!organizationId}
        className="shrink-0"
      >
        {active ? <CalendarCheck2 className="mr-2 h-4 w-4 text-emerald-500" /> : <CalendarSync className="mr-2 h-4 w-4" />}
        {active ? "Google conectado" : "Conectar Google"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarSync className="h-5 w-5 text-brand" /> Google Calendar
            </DialogTitle>
          </DialogHeader>

          {statusQuery.isLoading ? (
            <div className="flex min-h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : statusQuery.isError ? (
            <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
              <p className="font-medium">Integração ainda não disponível neste ambiente.</p>
              <p className="text-muted-foreground">
                A migration e as Edge Functions do Google Calendar precisam ser configuradas antes da conexão.
              </p>
            </div>
          ) : active || needsReconnect ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{status?.google_account_email}</p>
                    <p className="text-xs text-muted-foreground">{status?.calendar_name ?? "Calendário principal"}</p>
                  </div>
                  <Badge variant={active ? "secondary" : "destructive"}>
                    {active ? "Conectado" : "Reconectar"}
                  </Badge>
                </div>
                {status?.last_synced_at && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Última sincronização: {format(new Date(status.last_synced_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                )}
                {active && status?.last_error_code && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    A última sincronização foi parcial. Use “Sincronizar agora” para tentar novamente.
                  </p>
                )}
              </div>

              <p className="text-sm text-muted-foreground">
                Campanhas e eventos personalizados do Norteia são enviados ao calendário principal. Datas comemorativas permanecem somente no Norteia.
              </p>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                {status?.can_manage && (
                  <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDisconnect(true)}>
                    <Unplug className="mr-2 h-4 w-4" /> Desconectar
                  </Button>
                )}
                {active && status?.can_manage && (
                  <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
                    {sync.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarSync className="mr-2 h-4 w-4" />}
                    Sincronizar agora
                  </Button>
                )}
                {status?.can_manage && needsReconnect && (
                  <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
                    {connect.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
                    Reconectar Google
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                Conecte a conta Google da agência para copiar campanhas e eventos personalizados do Norteia para o calendário principal.
              </div>
              {status?.can_manage ? (
                <Button className="w-full" onClick={() => connect.mutate()} disabled={connect.isPending}>
                  {connect.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
                  Conectar com Google
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">Peça para um ADM ou Head realizar a conexão.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar o Google Calendar?</AlertDialogTitle>
            <AlertDialogDescription>
              O Norteia deixará de atualizar o Google. Os eventos que já foram enviados serão preservados no calendário.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnect.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={disconnect.isPending}
              onClick={(event) => {
                event.preventDefault();
                disconnect.mutate();
              }}
            >
              {disconnect.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
