import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, CheckCircle2, Instagram, Link2, Loader2, Unlink, UserRoundCog } from "lucide-react";
import {
  disconnectMeta,
  finalizeMetaConnection,
  getClientMetaStatus,
  listMetaPages,
  MetaFunctionError,
  PROVIDER_LABEL,
  startMetaOAuth,
  type MetaProvider,
} from "@/lib/metaRpc";
import { requiresFacebookPageSelection } from "@/lib/metaConnectionFlow";

// Onde o Facebook devolve o navegador após o OAuth. O callback anexa
// ?meta_status=pending&connection_id=...&client_id=... a esta rota.
// Retornar do OAuth PARA A PÁGINA ONDE ESTE COMPONENTE ESTÁ MONTADO — hoje
// /clients/:clientId ou /plannings/cliente/:clientId; numa lista sem a ficha
// aberta ele não é montado e a seleção de página se perderia. `clientId` não
// entra mais no cálculo: a página atual já é a fonte de verdade, e isso
// mantém o retorno certo em qualquer lugar novo que venha a montar a ficha.
const returnPathFor = () => window.location.pathname;

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

// Diz com QUAL conta do Facebook a conexão foi feita. Enquanto vários clientes
// estiverem na mesma conta, a queda de uma sessão derruba todos — é por isso
// que essa linha existe: ela torna a migração para a conta de cada cliente
// visível, cliente a cliente.
function AuthorLine({ name, provider }: { name: string | null; provider: MetaProvider }) {
  return (
    <p className="mt-1.5 text-xs text-muted-foreground">
      {name
        ? <>Conectado pela conta de <span className="font-medium text-foreground">{name}</span></>
        : "Conectado antes do registro de conta — reconecte para saber de quem é"}
      {" · "}
      {/* Qual porta foi usada muda o que dá para fazer: só a do Facebook
          publica na Página. */}
      <span className="font-medium text-foreground">login do {PROVIDER_LABEL[provider]}</span>
    </p>
  );
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
  const authorName = first?.meta_user_name ?? null;
  const provider: MetaProvider = first?.provider ?? "facebook";
  const channels = (rows ?? []).filter((r) => r.channel_id);
  const igChannel = channels.find((c) => c.channel_type === "instagram");
  const pageChannel = channels.find((c) => c.channel_type === "facebook_page");
  const pageSelectionRequired = requiresFacebookPageSelection(status, provider);

  // Retomar a selecao somente no fluxo Facebook. Uma conexao Instagram direta
  // nunca deve chamar /me/accounts nem abrir o seletor de Pagina.
  const effectivePendingId = pendingConnectionId ?? (pageSelectionRequired ? connectionId : null);

  // Trata o retorno do OAuth na URL (uma vez, para este cliente).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("client_id") !== clientId) return;
    const metaStatus = p.get("meta_status");
    if (metaStatus === "pending" && p.get("connection_id")) {
      setPendingConnectionId(p.get("connection_id"));
    } else if (metaStatus === "connected") {
      toast.success("Instagram conectado!");
      queryClient.invalidateQueries({ queryKey: ["meta-status", clientId] });
    } else if (metaStatus === "error") {
      toast.error("Não foi possível conectar: " + (p.get("reason_code") ?? "erro"));
    }
    if (metaStatus) {
      const url = new URL(window.location.href);
      ["meta_status", "connection_id", "client_id", "provider", "reason_code"].forEach((k) =>
        url.searchParams.delete(k),
      );
      window.history.replaceState({}, "", url.toString());
    }
  }, [clientId, queryClient]);

  // Aguarda o status carregado do banco confirmar a porta usada. Isso evita
  // abrir o seletor por engano se o frontend novo entrar no ar antes do
  // callback novo e receber uma URL pendente antiga, sem `provider`.
  useEffect(() => {
    if (!isLoading && pendingConnectionId && provider === "facebook") {
      setSelectOpen(true);
    }
  }, [isLoading, pendingConnectionId, provider]);

  const pagesQuery = useQuery({
    queryKey: ["meta-pages", effectivePendingId],
    queryFn: () => listMetaPages(effectivePendingId!),
    enabled: selectOpen && !!effectivePendingId,
  });

  // forceAccount = conectar com a conta do PRÓPRIO cliente. Sem isso o Facebook
  // reaproveita a sessão aberta no navegador (a da agência) e reautoriza em
  // silêncio — você acha que migrou e não migrou.
  const connect = useMutation<void, Error, { forceAccount: boolean; provider: MetaProvider }>({
    mutationFn: async ({ forceAccount, provider: porta }) => {
      const url = await startMetaOAuth(clientId, returnPathFor(), forceAccount, porta);
      window.location.href = url; // navega para o Facebook
    },
    onError: (e: unknown) => toast.error(sessionErrorMessage(e) ?? "Erro ao iniciar conexão: " + (e as Error).message),
  });

  // Reconectar a partir de reauth_required/error: só pode existir UMA conexão
  // viva por cliente (índice único no banco). Então desconectamos a atual ANTES
  // de iniciar o novo OAuth — senão o retorno da Meta falha ao gravar a conexão
  // (pending_connection_create_failed).
  const reconnect = useMutation<void, Error, boolean>({
    mutationFn: async (forceAccount: boolean) => {
      if (connectionId) await disconnectMeta(connectionId);
      const url = await startMetaOAuth(clientId, returnPathFor(), forceAccount, provider);
      window.location.href = url;
    },
    onError: (e: unknown) => toast.error(sessionErrorMessage(e) ?? "Erro ao reconectar: " + (e as Error).message),
  });

  // Uma conexão pendente ocupa o único slot permitido por cliente. Para
  // refazer o OAuth, primeiro a encerramos pela Edge Function (que valida a
  // permissão do usuário) e só então iniciamos uma autorização nova.
  const reconnectPending = useMutation<void, Error, boolean>({
    mutationFn: async (forceAccount: boolean) => {
      const idToDiscard = pendingConnectionId ?? (status === "pending" ? connectionId : null);
      if (idToDiscard) await disconnectMeta(idToDiscard);
      const url = await startMetaOAuth(clientId, returnPathFor(), forceAccount, provider);
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
          <AuthorLine name={authorName} provider={provider} />
          {canManage && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                <Unlink className="mr-1.5 h-3.5 w-3.5" /> Desconectar
              </Button>
              {/* Só existe UMA conexão viva por cliente, então refazer o OAuth
                  obriga a desconectar a atual ANTES de ir para o Facebook. Numa
                  conexão que está funcionando isso é destrutivo: se o login não
                  se completar, o cliente fica desconectado. Por isso confirma. */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" disabled={reconnect.isPending}>
                    {reconnect.isPending
                      ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      : <UserRoundCog className="mr-1.5 h-3.5 w-3.5" />}
                    Conectar como o cliente
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Trocar para a conta do cliente?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2 text-sm">
                        <p>
                          A conexão atual será <strong>desconectada primeiro</strong> — é a única
                          forma de refazer a autorização, porque cada cliente só pode ter uma
                          conexão viva.
                        </p>
                        <p>
                          Se o login no Facebook não for concluído, este cliente fica
                          desconectado até alguém conectar de novo. As publicações agendadas
                          não saem enquanto isso.
                        </p>
                        <p>
                          O Facebook vai pedir a senha de novo, mas costuma reautenticar
                          <strong> a mesma conta</strong> que já está logada. Para entrar com
                          outra, use uma <strong>janela anônima</strong> ou saia do Facebook
                          antes.
                        </p>
                        <p className="font-medium text-foreground">
                          Só continue com o login do cliente em mãos.
                        </p>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => reconnect.mutate(true)}>
                      Desconectar e trocar de conta
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
      )}

      {(status === "reauth_required" || status === "error") && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-amber-600">
            <AlertTriangle className="h-4 w-4" /> Reconexão necessária
          </div>
          <AuthorLine name={authorName} provider={provider} />
          {canManage && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={reconnect.isPending}
                onClick={() => reconnect.mutate(false)}
              >
                {reconnect.isPending
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  : <Link2 className="mr-1.5 h-3.5 w-3.5" />} Reconectar
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={reconnect.isPending}
                onClick={() => reconnect.mutate(true)}
                title="Refaz a conexão obrigando a escolher a conta do Facebook"
              >
                <UserRoundCog className="mr-1.5 h-3.5 w-3.5" /> Conectar como o cliente
              </Button>
            </div>
          )}
        </div>
      )}

      {status === "pending" && provider === "facebook" && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="text-muted-foreground">Conexão iniciada — falta escolher a página.</p>
          <AuthorLine name={authorName} provider={provider} />
          {canManage && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setPendingConnectionId(connectionId);
                  setSelectOpen(true);
                }}
              >
                Escolher página
              </Button>
              {/* Sem isto o estado pendente virava beco sem saída: dava para
                  escolher a página de quem autorizou, mas não para recomeçar
                  com a conta do cliente. Aqui a troca não é destrutiva — uma
                  conexão pendente ainda não publica nada. */}
              <Button
                variant="outline"
                size="sm"
                disabled={reconnectPending.isPending}
                onClick={() => reconnectPending.mutate(true)}
                title="Descarta esta conexão e recomeça pedindo o login"
              >
                {reconnectPending.isPending
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  : <UserRoundCog className="mr-1.5 h-3.5 w-3.5" />}
                Conectar como o cliente
              </Button>
            </div>
          )}
        </div>
      )}

      {status === "pending" && provider === "instagram" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-amber-600">
            <AlertTriangle className="h-4 w-4" /> Login do Instagram incompleto
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            A conta foi autorizada, mas a conexão não terminou. Refaça o login para concluir.
          </p>
          {canManage && (
            <Button
              className="mt-2"
              size="sm"
              disabled={reconnectPending.isPending}
              onClick={() => reconnectPending.mutate(true)}
            >
              {reconnectPending.isPending
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : <Instagram className="mr-1.5 h-3.5 w-3.5" />}
              Refazer login do Instagram
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
          <div className="space-y-2">
            {/* Duas portas, dois botões. Não é preferência: pelo Facebook a
                conta do Instagram precisa estar vinculada a uma Página, e só
                por ali dá para publicar TAMBÉM na Página. Pelo Instagram o
                cliente entra direto, sem Facebook nenhum. */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={connect.isPending}
                onClick={() => connect.mutate({ forceAccount: true, provider: "instagram" })}
                title="O cliente entra com a conta do Instagram dele. Não exige Facebook."
              >
                {connect.isPending
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  : <Instagram className="mr-1.5 h-3.5 w-3.5" />}
                Entrar com Instagram
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={connect.isPending}
                onClick={() => connect.mutate({ forceAccount: true, provider: "facebook" })}
                title="Exige a conta do Instagram vinculada a uma Página. Permite publicar também na Página."
              >
                <UserRoundCog className="mr-1.5 h-3.5 w-3.5" /> Entrar com Facebook
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Pelo <span className="font-medium text-foreground">Instagram</span> o cliente
              conecta sem precisar de Facebook — mas não publica na Página.
              Pelo <span className="font-medium text-foreground">Facebook</span> é preciso a
              conta vinculada a uma Página, e aí a Página também pode receber posts.
            </p>
          </div>
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
            <DialogTitle>Escolher Página e Instagram</DialogTitle>
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
                  onClick={() => reconnectPending.mutate(false)}
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
