import { supabase } from "@/integrations/supabase/client";
import { edgeReasonCode, invokeEdge } from "@/lib/edgeInvoke";

export type GoogleCalendarConnectionStatus = {
  organization_id: string;
  can_manage: boolean;
  connection_id: string | null;
  connection_status: "not_connected" | "active" | "reauth_required" | "disconnected" | "error";
  google_account_email: string | null;
  calendar_id: string | null;
  calendar_name: string | null;
  connected_at: string | null;
  last_verified_at: string | null;
  last_synced_at: string | null;
  last_error_code: string | null;
};

export type GoogleCalendarSyncResult = {
  ok: true;
  result:
    | "synced"
    | "skipped"
    | "missing"
    | "deleted"
    | "not_linked"
    | { synced: number; deleted: number; skipped: number; failed: number };
};

export class GoogleCalendarFunctionError extends Error {
  constructor(public readonly reasonCode: string) {
    super(reasonCode);
    this.name = "GoogleCalendarFunctionError";
  }
}

async function invokeGoogle<T>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await invokeEdge<T>(functionName, { body });
  if (error) {
    throw new GoogleCalendarFunctionError(
      (await edgeReasonCode(error)) ?? error.message ?? "google_calendar_request_failed",
    );
  }
  return data as T;
}

export async function getGoogleCalendarStatus(
  organizationId: string,
): Promise<GoogleCalendarConnectionStatus> {
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: GoogleCalendarConnectionStatus[] | null; error: Error | null }>)(
    "get_google_calendar_connection_status",
    { _organization_id: organizationId },
  );
  if (error) throw error;
  const status = data?.[0];
  if (!status) throw new Error("google_calendar_status_unavailable");
  return status;
}

export async function startGoogleCalendarOAuth(
  organizationId: string,
): Promise<string> {
  const data = await invokeGoogle<{ authorize_url: string }>(
    "google-calendar-oauth-start",
    { organization_id: organizationId, redirect_path: "/calendario" },
  );
  return data.authorize_url;
}

export async function syncGoogleCalendar(input: {
  organizationId: string;
  operation: "upsert" | "delete" | "reconcile";
  eventId?: string;
}): Promise<GoogleCalendarSyncResult> {
  return invokeGoogle<GoogleCalendarSyncResult>("google-calendar-sync", {
    organization_id: input.organizationId,
    operation: input.operation,
    ...(input.eventId ? { event_id: input.eventId } : {}),
  });
}

export async function disconnectGoogleCalendar(organizationId: string): Promise<void> {
  await invokeGoogle("google-calendar-disconnect", { organization_id: organizationId });
}

export function googleCalendarErrorMessage(reasonCode: string): string {
  const messages: Record<string, string> = {
    session_expired: "Sua sessão expirou. Entre novamente para continuar.",
    google_calendar_not_connected: "Conecte o Google Calendar antes de sincronizar.",
    google_reauthorization_required: "A autorização do Google expirou. Reconecte a conta.",
    google_calendar_forbidden: "A conta conectada não possui permissão para alterar esse calendário.",
    google_rate_limited: "O Google limitou as solicitações por alguns instantes. Tente novamente em breve.",
    google_oauth_denied_by_user: "A conexão foi cancelada na tela do Google.",
    google_refresh_token_missing: "O Google não forneceu acesso permanente. Reconecte e aceite as permissões.",
    google_calendar_management_forbidden: "Somente ADM ou Head pode gerenciar esta conexão.",
    google_calendar_sync_forbidden: "Você não possui permissão para sincronizar eventos.",
  };
  return messages[reasonCode] ?? "Não foi possível concluir a ação no Google Calendar.";
}
