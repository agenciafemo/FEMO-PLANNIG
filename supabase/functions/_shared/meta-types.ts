export type MetaAdminRole = "owner" | "admin" | "manager";

export interface AuthenticatedMetaActor {
  userId: string;
  email: string | null;
  accessToken: string;
}

export interface MetaConnectionRecord {
  id: string;
  organization_id: string;
  client_id: string;
  status: "pending" | "active" | "reauth_required" | "disconnected" | "error";
  connected_by: string;
  provider: "facebook" | "instagram";
}

export interface ConsumedOAuthState {
  oauth_state_id: string;
  organization_id: string;
  client_id: string;
  requested_by: string;
  requested_scopes: string[];
  redirect_path: string;
  /** Porta usada na autorização. Ausente em states antigos = facebook. */
  provider?: "facebook" | "instagram";
}

export interface MetaTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

export interface MetaInstagramAccount {
  id: string;
  name?: string;
  username?: string;
  account_type?: string;
}

export interface MetaPage {
  id: string;
  name: string;
  tasks?: string[];
  instagram_business_account?: MetaInstagramAccount;
}

export interface DiscoveredMetaPage {
  id: string;
  name: string;
  tasks: string[];
  instagram: MetaInstagramAccount | null;
}

export type SanitizedMetaPage = Omit<DiscoveredMetaPage, "tasks">;

/**
 * Página em modo diagnóstico: inclui páginas SEM Instagram e deriva sinais a
 * partir das tasks — sem nunca devolver as tasks brutas nem qualquer token.
 * missing_reason é um rótulo de conveniência; instagram_present e
 * has_required_page_access carregam a informação real, sem perda.
 */
export interface DiagnosticMetaPage {
  id: string;
  name: string;
  instagram: MetaInstagramAccount | null;
  instagram_present: boolean;
  has_required_page_access: boolean;
  missing_reason:
    | "page_available"
    | "instagram_not_linked_or_not_visible"
    | "page_missing_required_task"
    | "unknown";
}

/** Resultado cru de um lookup direto de Página — status HTTP, nunca a mensagem. */
export interface DirectPageLookupResult {
  ok: boolean;
  status: number | null;
  page: MetaPage | null;
}

/**
 * Diagnóstico de UMA página-alvo. Combina /me/accounts, lookup direto e
 * permissões, sempre sanitizado: nenhum token, nenhuma task bruta, nenhuma
 * mensagem da Meta. Os booleanos carregam a informação; missing_reason é rótulo.
 */
export interface TargetPageDiagnostic {
  id_matches: boolean;
  direct_lookup_ok: boolean;
  direct_lookup_status: number | null;
  direct_lookup_name: string | null;
  instagram_present: boolean;
  instagram_name: string | null;
  has_required_page_access: boolean | null;
  missing_reason:
    | "page_available"
    | "page_not_in_me_accounts"
    | "direct_lookup_permission_denied"
    | "instagram_not_linked_or_not_visible"
    | "page_missing_required_task"
    | "required_permission_declined"
    | "unknown";
}

export interface MetaApiErrorShape {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}
