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
  if (error) throw error;
  const status = data?.[0];
  if (!status) throw new Error("google_business_status_unavailable");
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
