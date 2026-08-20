// ============================================================================
// metaRpc.ts — Camada de dados da conexão Meta (Instagram) por cliente.
//
// Contrato de segurança:
//   - Leitura de status SÓ pela RPC sanitizada get_client_meta_connection_status
//     (GRANT a authenticated). NUNCA SELECT direto em meta_connections nem em
//     vault.secrets — o token nunca chega ao frontend.
//   - As mutações passam por Edge Functions server-only (meta-oauth-start,
//     meta-connection-complete, meta-disconnect), que fazem o próprio check de
//     JWT e usam service_role. Nenhum token/App Secret trafega aqui.
//
// types.ts ainda não conhece o schema do Meta (migration aplicada fora do
// fluxo normal). Usamos o mesmo dispatch cast `(supabase.rpc as any)` já
// adotado em vaultRpc.ts / publicRpc.ts.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Tipos (espelham os contratos das migrations/funções)
// ---------------------------------------------------------------------------

/** Uma linha por canal de get_client_meta_connection_status. Sem token/secret id. */
export interface MetaConnectionStatusRow {
  client_id: string;
  organization_id: string;
  can_manage: boolean;
  connection_id: string | null;
  connection_status: string; // not_connected | pending | active | reauth_required | error | disconnected
  connected_at: string | null;
  disconnected_at: string | null;
  last_verified_at: string | null;
  token_expires_at: string | null;
  granted_scopes: string[] | null;
  last_error_code: string | null;
  channel_id: string | null;
  channel_type: string | null; // facebook_page | instagram
  external_account_id: string | null;
  display_name: string | null;
  username: string | null;
  account_type: string | null;
  channel_status: string | null;
}

/** Página descoberta pela meta-connection-complete (sem page_id). */
export interface MetaDiscoveredPage {
  id: string;
  name: string;
  instagram: { id: string; name?: string; username?: string } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export class MetaFunctionError extends Error {
  constructor(public readonly reasonCode: string) {
    super(reasonCode);
    this.name = "MetaFunctionError";
  }
}

/**
 * Invoca uma Edge Function e, em erro HTTP, tenta extrair o `reason_code`
 * sanitizado do corpo (as funções devolvem { ok:false, reason_code }).
 */
/**
 * Garante um access_token válido antes de chamar a Edge Function. Abas
 * abertas há muito tempo podem carregar um token expirado; aqui renovamos
 * proativamente (e passamos o token novo no header), evitando o 401
 * `invalid_user_session`. Se não houver como renovar, sinaliza sessão
 * expirada para a UI orientar o novo login.
 */
async function freshAccessToken(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  const token = session?.access_token;
  const expiresAtMs = (session?.expires_at ?? 0) * 1000;
  // Renova se não há token ou se falta menos de 60s para expirar.
  if (!token || expiresAtMs < Date.now() + 60_000) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    const newToken = refreshed.session?.access_token;
    if (newToken) return newToken;
    // Não conseguiu renovar: NÃO envia um token expirado (daria 401 no
    // servidor). Sinaliza sessão expirada para a UI pedir novo login.
    throw new MetaFunctionError("session_expired");
  }
  return token;
}

async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const accessToken = await freshAccessToken();
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error) {
    let reason: string | undefined;
    try {
      const ctx = (error as { context?: unknown }).context;
      if (ctx && typeof (ctx as { json?: unknown }).json === "function") {
        const response = ctx as Response;
        const payload = await (typeof response.clone === "function" ? response.clone() : response).json();
        if (typeof payload?.reason_code === "string") reason = payload.reason_code;
      }
    } catch {
      /* mantém a mensagem genérica abaixo */
    }
    throw new MetaFunctionError(reason ?? error.message ?? "meta_request_failed");
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Status da conexão Meta do cliente. 0 linhas = sem acesso/sem membro. */
export async function getClientMetaStatus(clientId: string): Promise<MetaConnectionStatusRow[]> {
  const { data, error } = await (supabase.rpc as any)("get_client_meta_connection_status", {
    _client_id: clientId,
  });
  if (error) throw error;
  return (data ?? []) as MetaConnectionStatusRow[];
}

/** Inicia o OAuth: devolve a URL de autorização do Facebook para redirecionar. */
export async function startMetaOAuth(clientId: string, redirectPath: string): Promise<string> {
  const r = await invokeFn<{ authorize_url: string }>("meta-oauth-start", {
    client_id: clientId,
    redirect_path: redirectPath,
  });
  return r.authorize_url;
}

/** Lista as páginas descobertas de uma conexão pendente (sem finalizar). */
export async function listMetaPages(connectionId: string): Promise<MetaDiscoveredPage[]> {
  const r = await invokeFn<{ status: string; pages: MetaDiscoveredPage[] }>("meta-connection-complete", {
    connection_id: connectionId,
  });
  return r.pages ?? [];
}

/** Finaliza a conexão selecionando uma página do Facebook. */
export async function finalizeMetaConnection(connectionId: string, pageId: string): Promise<void> {
  await invokeFn("meta-connection-complete", { connection_id: connectionId, page_id: pageId });
}

/** Desconecta a conexão Meta do cliente. */
export async function disconnectMeta(connectionId: string): Promise<void> {
  await invokeFn("meta-disconnect", { connection_id: connectionId });
}
