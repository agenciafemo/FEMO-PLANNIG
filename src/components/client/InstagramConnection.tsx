import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, Instagram, Link2, Loader2, Unlink } from "lucide-react";
import {
  disconnectMeta,
  finalizeMetaConnection,
  getClientMetaStatus,
  listMetaPages,
  MetaFunctionError,
  startMetaOAuth,
} from "@/lib/metaRpc";

// Onde o Facebook devolve o navegador após o OAuth. O callback anexa
// ?meta_status=pending&connection_id=...&client_id=... a esta rota.
// Retornar do OAuth PARA A PÁGINA DO CLIENTE (onde este componente vive) — na
// lista /clients o componente não é montado e a seleção de página se perderia.
const returnPathFor = (clientId: string) => `/clients/${clientId}`;

// Erros de sessão comuns a todas as ações Meta → mensagem clara de re-login.
function sessionErrorMessage(error: unknown): string | null {
  const reason = error instanceof MetaFunctionError ? error.reasonCode : (error as Error)?.message ?? "";
  if (reason === "session_expired" || reason === "invalid_user_session" || reason === "authentication_required") {
    return "Sua sessão expirou. Recarregue a página (F5) ou entre novamente e tente de novo.";
  }
  return null;
}

function pagesErrorMessage(error: unknown): string {
  const reason = error instanceof MetaFunctionError ? error.reasonCode : "";
  if (
    reason === "connection_token_unavailable" ||
    /^meta_4\d\d_(102|190)(_|$)/.test(reason)
  ) {
    return "A autorização da Meta expirou. Refaça a conexão para continuar.";
  }
  if (/^meta_4\d\d_(10|200)(_|$)/.test(reason)) {
    return "A Meta não liberou as permissões necessárias. Refaça a conexão e autorize todas as opções solicitadas.";
  }
  if (reason === "meta_request_timeout" || reason === "meta_network_error") {
    return "A Meta demorou para responder. Tente buscar as páginas novamente.";
  }
  return "Não foi possível buscar as páginas. Tente novamente ou refaça a conexão.";
}

export function InstagramConnection({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const [selectOpen, setSelectOpen] = useState(false);
  const [pendingConnectionId, setPendingConnectionId] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["meta-status", clientId],
    queryFn: () => getClientMetaStatus(clientId),
  });

  const first = rows?.[0];
  const status = first?.connection_status ?? "not_connected";
  const connectionId = first?.connection_id ?? null;
  const canManage = first?.can_manage ?? false;
  const channels = (rows ?? []).filter((r) => r.channel_id);
  const igChannel = channels.find((c) => c.channel_type === "instagram");
  const pageChannel = channels.find((c) => c.channel_type === "facebook_page");

  // Retomar a seleção: retorno recente do OAuth, ou conexão já pendente no banco.
  const effectivePendingId = pendingConnectionId ?? (status === "pending" ? connectionId : null);

  // Trata o retorno do OAuth na URL (uma vez, para este cliente).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("client_id") !== clientId) return;
    const metaStatus = p.get("meta_status");
    if (metaStatus === "pending" && p.get("connection_id")) {
      setPendingConnectionId(p.get("connection_id"));
      setSelectOpen(true);
    } else if (metaStatus === "error") {
      toast.error("Não foi possível conectar: " + (p.get("reason_code") ?? "erro"));
    }
    if (metaStatus) {
      const url = new URL(window.location.href);
      ["meta_status", "connection_id", "client_id", "reason_code"].forEach((k) =>
        url.searchParams.delete(k),
      );
      window.history.replaceState({}, "", url.toString());
    }
  }, [clientId]);

  const pagesQuery = useQuery({
    queryKey: ["meta-pages", effectivePendingId],
    queryFn: () => listMetaPages(effectivePendingId!),
    enabled: selectOpen && !!effectivePendingId,
  });

  const connect = useMutation({
    mutationFn: async () => {
      const url = await startMetaOAuth(clientId, returnPathFor(clientId));
      window.location.href = url; // navega para o Facebook
    },
    onError: (e: unknown) => toast.error(sessionErrorMessage(e) ?? "Erro ao iniciar conexão: " + (e as Error).message),
  });

  // Uma conexão pendente ocupa o único slot permitido por cliente. Para
  // refazer o OAuth, primeiro a encerramos pela Edge Function (que valida a
  // permissão do usuário) e só então iniciamos uma autorização nova.
  const reconnectPending = useMutation({
    mutationFn: async () => {
      if (effectivePendingId) await disconnectMeta(effectivePendingId);
      const url = await startMetaOAuth(clientId, returnPathFor(clientId));
      window.location.href = url;
    },
    onError: (e: unknown) => toast.error(sessionErrorMessage(e) ?? "Erro ao reconectar: " + (e as Error).message),
  });

  const finalize = useMutation({
    mutationFn: (pageId: string) => finalizeMetaConnection(effectivePendingId!, pageId),
    onSuccess: () => {
      toast.success("Instagram conectado!");
      setSelectOpen(false);
      setPendingConnectionId(null);
      queryClient.invalidateQueries({ queryKey: ["meta-status", clientId] });
    },
    onError: (e: unknown) => toast.error("Erro ao finalizar: " + (e as Error).message),
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectMeta(connectionId!),
    onSuccess: () => {
      toast.success("Instagram desconectado");
      queryClient.invalidateQueries({ queryKey: ["meta-status", clientId] });
    },
    onError: (e: unknown) => toast.error("Erro ao desconectar: " + (e as Error).message),
  });

  if (isLoading) {
    return <div className="text-xs text-muted-foreground">Carregando conexão…</div>;
  }
  // 0 linhas = usuário sem acesso a este cliente: não expõe nada.
  if (!rows || rows.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Instagram className="h-4 w-4" /> Instagram
      </div>

      {status === "active" && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-emerald-600">
            <CheckCircle2 className="h-4 w-4" /> Conectado
          </div>
          {igChannel && <p className="mt-1">@{igChannel.username ?? igChannel.display_name}</p>}
          {pageChannel && (
            <p className="text-xs text-muted-foreground">Página: {pageChannel.display_name}</p>
          )}
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              <Unlink className="mr-1.5 h-3.5 w-3.5" /> Desconectar
            </Button>
          )}
        </div>
      )}

      {(status === "reauth_required" || status === "error") && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-amber-600">
            <AlertTriangle className="h-4 w-4" /> Reconexão necessária
          </div>
          {canManage && (
            <Button
              size="sm"
              className="mt-2"
              disabled={connect.isPending}
              onClick={() => connect.mutate()}
            >
              <Link2 className="mr-1.5 h-3.5 w-3.5" /> Reconectar
            </Button>
          )}
        </div>
      )}

      {status === "pending" && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="text-muted-foreground">Conexão iniciada — falta escolher a página.</p>
          {canManage && (
            <Button
              size="sm"
              className="mt-2"
              onClick={() => {
                setPendingConnectionId(connectionId);
                setSelectOpen(true);
              }}
            >
              Escolher página
            </Button>
          )}
        </div>
      )}

      {(status === "not_connected" || status === "disconnected") && canManage && (
        <div>
          <p className="mb-2 text-xs text-muted-foreground">
            {status === "disconnected"
              ? "Instagram desconectado. Conecte novamente para publicar e ler métricas."
              : "Conecte o Instagram deste cliente para publicar pelo Norteia."}
          </p>
          <Button size="sm" disabled={connect.isPending} onClick={() => connect.mutate()}>
            {connect.isPending
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <Instagram className="mr-1.5 h-3.5 w-3.5" />}
            Conectar Instagram
          </Button>
        </div>
      )}

      <Dialog
        open={selectOpen}
        onOpenChange={(v) => {
          setSelectOpen(v);
          if (!v) setPendingConnectionId(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Escolher página / Instagram</DialogTitle>
          </DialogHeader>
          {pagesQuery.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando páginas…
            </div>
          ) : pagesQuery.isError ? (
            <div className="space-y-3 py-4">
              <p className="text-sm text-destructive">
                {pagesErrorMessage(pagesQuery.error)}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pagesQuery.isFetching || reconnectPending.isPending}
                  onClick={() => pagesQuery.refetch()}
                >
                  {pagesQuery.isFetching && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Tentar novamente
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={reconnectPending.isPending}
                  onClick={() => reconnectPending.mutate()}
                >
                  {reconnectPending.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Refazer conexão
                </Button>
              </div>
            </div>
          ) : (
            <div className="max-h-80 space-y-1.5 overflow-y-auto">
              {(pagesQuery.data ?? []).map((page) => (
                <button
                  key={page.id}
                  disabled={finalize.isPending}
                  onClick={() => finalize.mutate(page.id)}
                  className="flex w-full items-center justify-between rounded-lg border p-2.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                >
                  <span>
                    <span className="font-medium">{page.name}</span>
                    {page.instagram?.username && (
                      <span className="block text-xs text-muted-foreground">
                        @{page.instagram.username}
                      </span>
                    )}
                  </span>
                  {page.instagram
                    ? <Instagram className="h-4 w-4 shrink-0 text-muted-foreground" />
                    : <span className="shrink-0 text-[10px] text-muted-foreground">sem IG</span>}
                </button>
              ))}
              {(pagesQuery.data ?? []).length === 0 && (
                <p className="py-4 text-sm text-muted-foreground">Nenhuma página encontrada.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
