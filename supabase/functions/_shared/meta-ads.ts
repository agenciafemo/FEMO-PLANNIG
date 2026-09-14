// ============================================================================
// META ADS DA AGÊNCIA — conexão própria para ler tráfego pago.
//
// Antes, o relatório usava um token colado à mão no secret META_ADS_SYSTEM_TOKEN
// (token de usuário de 60 dias gerado no Graph API Explorer). Quando a Meta o
// invalidava — senha trocada, sessão encerrada, prazo — o relatório parava sem
// aviso e só quem tinha acesso ao Supabase conseguia consertar.
//
// Agora a agência conecta pela tela, o token vai para o Vault e a tela sabe o
// estado da conexão. É SEPARADA das conexões de publicação dos clientes
// (meta_connections): reconectar o Ads não toca em nenhum post programado.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";
import { requiredEnv } from "./supabase.ts";
import { metaConfig, metaOAuthStartConfig } from "./meta-client.ts";
import type { MetaApiErrorShape } from "./meta-types.ts";

export const META_ADS_REQUIRED_SCOPE = "ads_read";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: unknown, reasonCode: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!UUID.test(text)) throw new HttpError(400, reasonCode);
  return text;
}

/**
 * Escopos pedidos no consentimento. `ads_read` entra sempre: sem ele a conexão
 * nasce inútil e o erro só aparece ao puxar o primeiro relatório.
 * META_ADS_SCOPES permite acrescentar escopos sem deploy.
 */
export function parseMetaAdsScopes(raw?: string | null): string[] {
  const scopes = [
    ...new Set(
      (raw ?? "").split(",").map((scope) => scope.trim()).filter(Boolean),
    ),
  ];
  if (!scopes.includes(META_ADS_REQUIRED_SCOPE)) {
    scopes.unshift(META_ADS_REQUIRED_SCOPE);
  }
  return scopes;
}

/**
 * URI de retorno PRÓPRIA do Ads. Precisa estar cadastrada em "URIs de
 * redirecionamento do OAuth válidos" no app da Meta, senão o consentimento
 * falha com erro de URL bloqueada.
 */
export function metaAdsRedirectUri(): string {
  const configured = Deno.env.get("META_ADS_OAUTH_REDIRECT_URI")?.trim();
  if (configured) return configured;
  return new URL(
    "/functions/v1/meta-ads-oauth-callback",
    requiredEnv("SUPABASE_URL"),
  ).toString();
}

export function metaAdsStartConfig() {
  return {
    ...metaOAuthStartConfig(),
    redirectUri: metaAdsRedirectUri(),
    scopes: parseMetaAdsScopes(Deno.env.get("META_ADS_SCOPES")),
  };
}

export function metaAdsConfig() {
  return {
    ...metaConfig(),
    redirectUri: metaAdsRedirectUri(),
    scopes: parseMetaAdsScopes(Deno.env.get("META_ADS_SCOPES")),
  };
}

export function buildMetaAdsAuthorizeUrl(
  state: string,
  config: {
    appId: string;
    graphVersion: string;
    redirectUri: string;
    scopes: string[];
  },
  /** Perfil do cliente: pede a senha de novo em vez de seguir com a sessão. */
  forceAccount = false,
): string {
  const url = new URL(
    `https://www.facebook.com/${config.graphVersion}/dialog/oauth`,
  );
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(","));
  // Agência: se alguém recusou `ads_read` antes, a Meta não pergunta de novo
  // sem `rerequest` — e a reconexão "funciona" sem a permissão.
  // Cliente: `reauthenticate` pede a senha. Não troca sozinho o usuário logado
  // no navegador — por isso a tela orienta usar janela anônima.
  url.searchParams.set("auth_type", forceAccount ? "reauthenticate" : "rerequest");
  return url.toString();
}

/**
 * O que falta na permissão de anúncios, ou null se foi concedida.
 *
 * "declined" = a pessoa desmarcou na tela da Meta; conectar de novo resolve.
 * Ausente = a Meta nem ofereceu. Com acesso PADRÃO a `ads_read`, só perfis com
 * papel no app podem concedê-la — é o que acontece com o perfil de um cliente
 * até o app ter acesso avançado. São conclusões opostas para quem está na tela.
 */
export function adsPermissionProblem(
  permissions: Record<string, string>,
): string | null {
  const status = permissions[META_ADS_REQUIRED_SCOPE];
  if (status === "granted") return null;
  return status === "declined"
    ? "meta_ads_permission_declined"
    : "meta_ads_permission_unavailable";
}

/** `expires_in` em segundos -> instante ISO. Ausente ou inválido = null. */
export function tokenExpiresAt(
  expiresInSeconds: unknown,
  now = Date.now(),
): string | null {
  const seconds = Number(expiresInSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(now + seconds * 1000).toISOString();
}

/** A Meta recusou o token em si (vencido, revogado, senha trocada). */
export function isMetaAuthorizationFailure(
  payload: MetaApiErrorShape,
  status: number,
): boolean {
  const code = payload.error?.code;
  return code === 190 || code === 102 || status === 401;
}

/**
 * Membro ativo da organização. Com `managerOnly`, também precisa poder
 * gerenciar a conexão — a regra mora no banco (meta_ads_can_manage) para
 * tela e servidor não divergirem.
 */
export async function requireMetaAdsMember(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  managerOnly = false,
): Promise<void> {
  const { data, error } = await admin
    .from("organization_members")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, "membership_lookup_failed");
  if (!data || data.status !== "active") {
    throw new HttpError(403, "meta_ads_access_forbidden");
  }
  if (!managerOnly) return;

  const { data: canManage, error: rpcError } = await admin.rpc(
    "meta_ads_can_manage",
    { _organization_id: organizationId, _user_id: userId },
  );
  if (rpcError) throw new HttpError(500, "meta_ads_permission_lookup_failed");
  if (canManage !== true) {
    throw new HttpError(
      403,
      "meta_ads_management_forbidden",
      undefined,
      "Somente ADM, Head ou quem tem a função Tráfego Pago pode conectar o Meta Ads da agência.",
    );
  }
}
