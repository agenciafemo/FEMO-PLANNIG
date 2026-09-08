import { HttpError, metaReasonCode } from "./http.ts";
import type { MetaApiErrorShape } from "./meta-types.ts";

/** Tokens must stay on the API and app secret of the login that issued them. */
export function insightsRoute(provider: unknown) {
  if (provider !== "facebook" && provider !== "instagram") {
    throw new HttpError(
      409,
      "meta_provider_invalid",
      undefined,
      "Não foi possível identificar o tipo de conexão. Reconecte a conta do cliente.",
    );
  }
  const direct = provider === "instagram";
  return {
    host: direct ? "https://graph.instagram.com" : "https://graph.facebook.com",
    secretName: direct ? "META_INSTAGRAM_APP_SECRET" : "META_APP_SECRET",
    insightsPermission: direct
      ? "instagram_business_manage_insights"
      : "instagram_manage_insights",
    supportsFacebook: !direct,
  };
}

/** Never return raw upstream messages, which may contain request data. */
export function insightsFailure(
  payload: MetaApiErrorShape,
  status: number,
  permission: string,
): HttpError {
  const code = payload.error?.code;
  if (code === 190 || code === 102 || status === 401) {
    return new HttpError(
      409,
      "meta_reauthorization_required",
      status,
      "A Meta recusou a autorização desta conexão. Reconecte a conta do cliente e tente novamente.",
    );
  }
  if (status === 429 || [4, 17, 32, 613].includes(code ?? -1)) {
    return new HttpError(
      429,
      "meta_rate_limited",
      status,
      "A Meta limitou temporariamente as consultas. Aguarde e tente novamente.",
    );
  }
  if (code === 10 || code === 200 || status === 403) {
    return new HttpError(
      403,
      "meta_insights_permission_required",
      status,
      `A Meta não autorizou esta leitura. Confira a permissão ${permission}, o acesso ao ativo e reconecte a conta.`,
    );
  }
  return new HttpError(
    502,
    metaReasonCode(payload, status),
    status,
    "A Meta não disponibilizou estes dados. Confira o período e tente novamente.",
  );
}

export function requireReadableProfile(
  ok: boolean,
  payload: MetaApiErrorShape,
  status: number,
  permission: string,
): void {
  if (!ok || payload.error) throw insightsFailure(payload, status, permission);
}
