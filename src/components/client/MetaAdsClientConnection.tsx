import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Megaphone } from "lucide-react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/hooks/useOrganization";
import { cn } from "@/lib/utils";
import {
  daysUntil,
  disconnectMetaAds,
  getMetaAdsClientStatus,
  metaAdsReasonMessage,
  startMetaAdsOAuth,
} from "@/lib/adsRpc";

// A partir de quantos dias antes do vencimento a ficha começa a avisar.
const AVISO_VENCIMENTO_DIAS = 10;

/**
 * Meta Ads com o PERFIL DO CLIENTE, na ficha → Conexões.
 *
 * Mora aqui, junto do Instagram/Facebook, porque é uma conexão do cliente: a
 * equipe procura "conectar" na ficha, não no meio do relatório. O relatório de
 * tráfego pago usa esta conexão automaticamente (ela tem prioridade sobre a da
 * agência) e só mostra o status, com atalho para cá.
 */
export function MetaAdsClientConnection({ clientId }: { clientId: string }) {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const [confirmarDesconexao, setConfirmarDesconexao] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["meta-ads-client-status", organizationId, clientId],
    queryFn: () => getMetaAdsClientStatus(organizationId!, clientId),
    enabled: !!organizationId && !!clientId,
    staleTime: 60 * 1000,
    // Sem a migration por cliente a RPC não existe: o bloco simplesmente some.
    retry: false,
  });

  // Volta do consentimento da Meta com ?meta_ads_status=...&meta_ads_scope=client
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resultado = params.get("meta_ads_status");
    if (!resultado || params.get("meta_ads_scope") !== "client") return;
    if (resultado === "connected") {
      toast.success("Perfil do cliente conectado ao Meta Ads.");
    } else {
      toast.error(
        metaAdsReasonMessage(params.get("reason_code") ?? "meta_ads_oauth_callback_failed"),
        { duration: 15000 },
      );
    }
    ["meta_ads_status", "reason_code", "meta_ads_scope"].forEach((chave) => params.delete(chave));
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
    queryClient.invalidateQueries({ queryKey: ["meta-ads-client-status"] });
  }, [queryClient]);

  const conectar = useMutation({
    mutationFn: async () => {
      // Volta direto para Conexões, onde o resultado aparece.
      const url = await startMetaAdsOAuth(
        organizationId!,
        `${window.location.pathname}?secao=conexoes`,
        clientId,
      );
      window.location.assign(url);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const desconectar = useMutation({
    mutationFn: () => disconnectMetaAds(organizationId!, clientId),
    onSuccess: () => {
      toast.success("Perfil do cliente desconectado. O relatório volta a usar a conexão da agência.");
      setConfirmarDesconexao(false);
      queryClient.invalidateQueries({ queryKey: ["meta-ads-client-status"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const status = statusQuery.data ?? null;
  if (!organizationId || statusQuery.isError) return null;
  if (!statusQuery.isLoading && !status) return null;

  const conectado = status?.connection_status === "active";
  const precisaReconectar = status?.connection_status === "reauth_required" ||
    status?.connection_status === "error";
  const dias = conectado ? daysUntil(status?.token_expires_at ?? null) : null;
  const venceEmBreve = dias !== null && dias <= AVISO_VENCIMENTO_DIAS;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-5",
        precisaReconectar
          ? "border-destructive/30"
          : conectado && venceEmBreve
            ? "border-warning/40"
            : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-semibold">Meta Ads com o perfil do cliente</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Para quando a conta de anúncios só aparece para o próprio cliente. Sem esta conexão, o
        relatório de tráfego pago usa a conexão Meta Ads da agência.
      </p>

      {statusQuery.isLoading || !status ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando conexão…
        </p>
      ) : conectado ? (
        <div className="mt-3">
          <p className="text-sm">
            Conectado
            {status.meta_user_name && (
              <> como <span className="font-medium">{status.meta_user_name}</span></>
            )}
            . O relatório deste cliente lê os anúncios com esse perfil.
          </p>
          {dias !== null && status.token_expires_at && (
            <p className={cn("mt-0.5 text-xs", venceEmBreve ? "text-warning" : "text-muted-foreground")}>
              {dias < 0
                ? "A autorização venceu."
                : `A autorização vence em ${new Date(status.token_expires_at).toLocaleDateString("pt-BR")} (${dias} dia${dias === 1 ? "" : "s"}).`}
              {venceEmBreve && " Reconecte com o cliente antes para o relatório não parar."}
            </p>
          )}
          {status.can_manage && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={venceEmBreve ? "outline" : "ghost"}
                onClick={() => conectar.mutate()}
                disabled={conectar.isPending}
              >
                {conectar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Reconectar perfil do cliente
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmarDesconexao(true)}
                disabled={desconectar.isPending}
              >
                Desconectar
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3">
          {precisaReconectar && (
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              A Meta recusou o perfil do cliente — a autorização venceu ou foi revogada.
            </p>
          )}
          {status.can_manage ? (
            <>
              <p className="text-xs text-muted-foreground">
                Abra o Norteia numa <span className="font-medium text-foreground">janela anônima</span>{" "}
                antes de clicar — senão o Facebook segue com o login da agência aberto neste
                navegador. Na tela da Meta, o cliente digita o usuário e a senha dele. Enquanto a
                Meta não aprovar o acesso avançado, o perfil precisa ser testador do app.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => conectar.mutate()} disabled={conectar.isPending}>
                  {conectar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  {precisaReconectar ? "Reconectar perfil do cliente" : "Conectar com o perfil do cliente"}
                </Button>
                {precisaReconectar && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmarDesconexao(true)}
                    disabled={desconectar.isPending}
                  >
                    Desconectar
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Não conectado. Peça para um ADM, Head ou quem tem a função Tráfego Pago conectar.
            </p>
          )}
        </div>
      )}

      <AlertDialog open={confirmarDesconexao} onOpenChange={setConfirmarDesconexao}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar o perfil do cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              O relatório deste cliente volta a usar a conexão Meta Ads da agência. Se a conta de
              anúncios só aparece para o perfil do cliente, o tráfego pago dele para de carregar. Os
              posts programados não são afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => desconectar.mutate()}
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
