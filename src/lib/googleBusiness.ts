import { supabase } from "@/integrations/supabase/client";
import { edgeReasonCode, invokeEdge } from "@/lib/edgeInvoke";

export type GoogleBusinessStatus = {
  organization_id: string;
  client_id: string;
  can_manage: boolean;
  connection_status:
    | "not_connected"
    | "active"
    | "reauth_required"
    | "disconnected"
    | "error";
  google_account_email: string | null;
  google_location_name: string | null;
  location_title: string | null;
  store_code: string | null;
  place_id: string | null;
  selected_at: string | null;
  last_verified_at: string | null;
  last_error_code: string | null;
};

export type GoogleBusinessLocation = {
  name: string;
  title: string;
  storeCode: string | null;
  placeId: string | null;
  storefrontAddress: {
    addressLines?: string[];
    locality?: string;
    administrativeArea?: string;
    postalCode?: string;
  } | null;
};

export type GoogleBusinessDailyInsights = {
  date: string;
  search_impressions: number;
  maps_impressions: number;
  calls: number;
  directions: number;
  website_clicks: number;
};

export type GoogleBusinessInsights = {
  period: { from: string; to: string };
  location: {
    google_location_name: string;
    location_title: string;
    store_code: string | null;
    place_id: string | null;
  };
  insights: {
    totals: {
      search_impressions: number;
      maps_impressions: number;
      total_impressions: number;
      calls: number;
      directions: number;
      website_clicks: number;
      total_actions: number;
    };
    daily: GoogleBusinessDailyInsights[];
  };
};

export class GoogleBusinessFunctionError extends Error {
  constructor(public readonly reasonCode: string) {
    super(reasonCode);
    this.name = "GoogleBusinessFunctionError";
  }
}

/**
 * Por que a consulta de status falhou.
 *
 * A tela mostrava "a integração precisa da migration e das Edge Functions"
 * para QUALQUER falha aqui. Quando a migration estava aplicada e o problema
 * era outro, essa frase mandava quem investigava para o lugar errado — foi o
 * que aconteceu no primeiro teste real da integração.
 */
export type GoogleBusinessStatusFalha =
  /** A função não existe neste banco: migration não aplicada AQUI. */
  | "migration_ausente"
  /** A função existe, mas o papel atual não pode executá-la (GRANT). */
  | "sem_permissao"
  /** Sem sessão válida — nada a ver com a integração. */
  | "sessao_invalida"
  /** A função respondeu, mas sem nenhuma linha. */
  | "sem_resposta"
  | "desconhecida";

export class GoogleBusinessStatusError extends Error {
  constructor(
    public readonly falha: GoogleBusinessStatusFalha,
    /** Código cru do Postgres/PostgREST, para quem for diagnosticar. */
    public readonly codigoTecnico: string | null,
    mensagemOriginal: string,
  ) {
    super(mensagemOriginal);
    this.name = "GoogleBusinessStatusError";
  }
}

/**
 * Traduz o erro do PostgREST em causa.
 *
 * PGRST202 é "função não encontrada" — o sintoma de apontar para um banco sem
 * a migration, que é diferente de tê-la aplicada e esbarrar em permissão
 * (42501). Distinguir os dois é o que evita procurar migration que já existe.
 */
function classificarFalhaDeStatus(erro: unknown): GoogleBusinessStatusError {
  const e = (erro ?? {}) as { code?: string; message?: string; status?: number };
  const codigo = e.code ?? null;
  const mensagem = e.message ?? "Falha ao consultar o status do Google.";

  if (codigo === "PGRST202") {
    return new GoogleBusinessStatusError("migration_ausente", codigo, mensagem);
  }
  if (codigo === "42501") {
    return new GoogleBusinessStatusError("sem_permissao", codigo, mensagem);
  }
  if (e.status === 401 || codigo === "PGRST301") {
    return new GoogleBusinessStatusError("sessao_invalida", codigo, mensagem);
  }
  return new GoogleBusinessStatusError("desconhecida", codigo, mensagem);
}

/** Texto para a tela, por causa. */
export function googleBusinessStatusMessage(
  erro: unknown,
): { titulo: string; detalhe: string; codigo: string | null } {
  const e = erro instanceof GoogleBusinessStatusError
    ? erro
    : classificarFalhaDeStatus(erro);

  const porFalha: Record<GoogleBusinessStatusFalha, { titulo: string; detalhe: string }> = {
    migration_ausente: {
      titulo: "Integração não instalada neste ambiente",
      detalhe:
        "A migration do Perfil da Empresa não foi aplicada no banco que este site está usando. Em produção ela já existe — se você está em localhost, o .env aponta para o ambiente de teste.",
    },
    sem_permissao: {
      titulo: "Sem permissão para ler o status",
      detalhe:
        "A função existe, mas seu usuário não pode executá-la. Normalmente é o GRANT da função, que se perde quando ela é recriada.",
    },
    sessao_invalida: {
      titulo: "Sessão expirada",
      detalhe: "Entre novamente para ver a conexão do Google.",
    },
    sem_resposta: {
      titulo: "Status indisponível",
      detalhe:
        "A consulta respondeu sem dados para este cliente. Recarregue a página; se persistir, avise o suporte.",
    },
    desconhecida: {
      titulo: "Não foi possível ler o status do Google",
      detalhe: e.message,
    },
  };

  return { ...porFalha[e.falha], codigo: e.codigoTecnico };
}

async function invokeGoogleBusiness<T>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await invokeEdge<T>(functionName, { body });
  if (error) {
    throw new GoogleBusinessFunctionError(
      (await edgeReasonCode(error)) ?? error.message ??
        "google_business_request_failed",
    );
  }
  return data as T;
}

export async function getGoogleBusinessStatus(
  organizationId: string,
  clientId: string,
): Promise<GoogleBusinessStatus> {
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: GoogleBusinessStatus[] | null; error: Error | null }>)(
    "get_google_business_connection_status",
    { _organization_id: organizationId, _client_id: clientId },
  );
  if (error) throw classificarFalhaDeStatus(error);
  const status = data?.[0];
  if (!status) {
    throw new GoogleBusinessStatusError(
      "sem_resposta",
      null,
      "google_business_status_unavailable",
    );
  }
  return status;
}

export async function startGoogleBusinessOAuth(
  organizationId: string,
  redirectPath: string,
): Promise<string> {
  const data = await invokeGoogleBusiness<{ authorize_url: string }>(
    "google-business-oauth-start",
    { organization_id: organizationId, redirect_path: redirectPath },
  );
  return data.authorize_url;
}

export async function listGoogleBusinessLocations(
  organizationId: string,
  clientId: string,
): Promise<GoogleBusinessLocation[]> {
  const data = await invokeGoogleBusiness<{
    ok: true;
    locations: GoogleBusinessLocation[];
  }>("google-business-locations", {
    organization_id: organizationId,
    client_id: clientId,
    action: "list",
  });
  return data.locations;
}

export async function selectGoogleBusinessLocation(
  organizationId: string,
  clientId: string,
  location: GoogleBusinessLocation,
): Promise<void> {
  await invokeGoogleBusiness("google-business-locations", {
    organization_id: organizationId,
    client_id: clientId,
    action: "select",
    location,
  });
}

export async function getGoogleBusinessInsights(input: {
  organizationId: string;
  clientId: string;
  from: string;
  to: string;
}): Promise<GoogleBusinessInsights> {
  return invokeGoogleBusiness<GoogleBusinessInsights>(
    "google-business-insights",
    {
      organization_id: input.organizationId,
      client_id: input.clientId,
      start_date: input.from,
      end_date: input.to,
    },
  );
}

export function googleBusinessErrorMessage(reasonCode: string): string {
  const messages: Record<string, string> = {
    session_expired: "Sua sessão expirou. Entre novamente para continuar.",
    google_business_management_forbidden:
      "Somente ADM ou Head pode gerenciar a conexão do Google.",
    google_business_not_connected:
      "Conecte a conta Google da agência antes de escolher uma unidade.",
    google_business_oauth_denied_by_user:
      "A conexão foi cancelada na tela do Google.",
    google_business_refresh_token_missing:
      "O Google não forneceu acesso permanente. Reconecte e aceite as permissões.",
    google_business_permission_denied:
      "A conta Google não tem acesso ao Perfil da Empresa ou a API necessária não está ativada.",
    google_business_location_already_linked:
      "Esta unidade Google já está vinculada a outro cliente do Norteia.",
    google_business_location_not_selected:
      "Escolha a unidade Google deste cliente antes de buscar métricas.",
    google_business_location_not_found:
      "A unidade vinculada não foi encontrada na conta Google.",
    google_business_rate_limited:
      "O Google limitou as consultas por alguns instantes. Tente novamente em breve.",
  };
  return messages[reasonCode] ??
    "Não foi possível concluir a ação no Perfil da Empresa.";
}
