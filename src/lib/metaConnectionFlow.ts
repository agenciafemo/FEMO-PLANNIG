import type { MetaProvider } from "@/lib/metaRpc";

/**
 * Somente o login via Facebook precisa transformar a conexao pendente em uma
 * selecao de Pagina. No login direto, a propria conta Instagram autorizada e
 * o canal final e deve ser ativada pelo callback.
 */
export function requiresFacebookPageSelection(
  status: string,
  provider: MetaProvider,
): boolean {
  return status === "pending" && provider === "facebook";
}
