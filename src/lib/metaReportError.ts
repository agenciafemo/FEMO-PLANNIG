import { edgeDetail, edgeReasonCode } from "@/lib/edgeInvoke";

export async function metaReportError(error: unknown): Promise<Error> {
  const detail = await edgeDetail(error);
  if (detail) return new Error(detail);
  const code = await edgeReasonCode(error);
  const messages: Record<string, string> = {
    no_active_connection: "Este cliente não tem conexão Meta ativa. Conecte a conta no perfil do cliente.",
    no_instagram_account: "Não há uma conta profissional do Instagram vinculada a esta conexão.",
    connection_token_unavailable: "A autorização desta conexão não está disponível. Reconecte a conta do cliente.",
    client_sem_conta_de_anuncios: "Vincule a conta de anúncios deste cliente antes de puxar o tráfego pago.",
  };
  return new Error((code && messages[code]) || (error instanceof Error ? error.message : "Não foi possível consultar os dados da Meta."));
}
