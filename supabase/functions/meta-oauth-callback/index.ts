import { sha256Hex } from "../_shared/meta-auth.ts";
import {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  exchangeInstagramCode,
  exchangeInstagramLongLivedToken,
  getInstagramAccount,
  getMetaUser,
  instagramOAuthConfig,
  metaConfig,
} from "../_shared/meta-client.ts";
import {
  HttpError,
  methodNotAllowed,
  safeLog,
  safeRequestId,
} from "../_shared/http.ts";
import { createAdminClient, requiredEnv } from "../_shared/supabase.ts";
import {
  consumeOAuthState,
  createPendingConnection,
  finalizeInstagramConnection,
  recordAudit,
} from "../_shared/meta-vault.ts";
import type { ConsumedOAuthState } from "../_shared/meta-types.ts";

const FUNCTION_NAME = "meta-oauth-callback";

type CallbackStep =
  | "validate_state"
  | "consume_state"
  | "provider_authorization"
  | "validate_code"
  | "load_meta_config"
  | "exchange_short_lived_token"
  | "exchange_long_lived_token"
  | "lookup_meta_account"
  | "load_instagram_config"
  | "exchange_instagram_code"
  | "exchange_instagram_long_lived_token"
  | "lookup_instagram_account"
  | "create_pending_connection"
  | "finalize_instagram_connection"
  | "record_audit"
  | "build_redirect";

function logCallbackFailure(
  requestId: string,
  step: CallbackStep,
  reasonCode: string,
  error?: unknown,
): void {
  safeLog("meta_oauth_callback_failure", {
    function_name: FUNCTION_NAME,
    request_id: requestId,
    step,
    reason_code: reasonCode,
    ...(error instanceof HttpError
      ? { status: error.upstreamStatus ?? error.status }
      : {}),
  });
}

async function runCallbackStep<T>(
  requestId: string,
  step: CallbackStep,
  reasonCode: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logCallbackFailure(requestId, step, reasonCode, error);
    throw new HttpError(
      error instanceof HttpError ? error.status : 500,
      reasonCode,
    );
  }
}

function redirectUrl(
  path: string,
  params: Record<string, string>,
  returnOrigin: string,
): URL {
  const target = new URL(
    path.startsWith("/") && !path.startsWith("//") ? path : "/clients",
    returnOrigin,
  );
  if (target.origin !== returnOrigin) {
    throw new HttpError(400, "callback_redirect_invalid");
  }
  Object.entries(params).forEach(([key, value]) =>
    target.searchParams.set(key, value)
  );
  return target;
}

function callbackRedirect(
  path: string,
  params: Record<string, string>,
  returnOrigin: string,
  requestId: string,
): Response {
  try {
    return Response.redirect(redirectUrl(path, params, returnOrigin), 303);
  } catch (error) {
    logCallbackFailure(
      requestId,
      "build_redirect",
      "unexpected_callback_error",
      error,
    );
    return Response.redirect(
      redirectUrl("/clients", {
        meta_status: "error",
        reason_code: "unexpected_callback_error",
      }, returnOrigin),
      303,
    );
  }
}

async function recordFailureAudit(
  consumed: ConsumedOAuthState,
  requestId: string,
  result: "denied" | "failure",
  reasonCode: string,
  connectionId: string | null = null,
): Promise<void> {
  try {
    await recordAudit(createAdminClient(), {
      clientId: consumed.client_id,
      connectionId,
      actorUserId: consumed.requested_by,
      action: "oauth_failed",
      result,
      reasonCode,
      requestId,
    });
  } catch (error) {
    logCallbackFailure(
      requestId,
      "record_audit",
      "oauth_audit_failed",
      error,
    );
  }
}

Deno.serve(async (request) => {
  if (request.method !== "GET") return methodNotAllowed({}, ["GET"]);

  const returnOrigin = new URL(requiredEnv("META_APP_RETURN_ORIGIN")).origin;
  const requestId = safeRequestId(request);
  const query = new URL(request.url).searchParams;
  const rawState = query.get("state");
  let consumed: ConsumedOAuthState | null = null;
  let createdConnectionId: string | null = null;

  try {
    if (!rawState || rawState.length < 32 || rawState.length > 256) {
      logCallbackFailure(
        requestId,
        "validate_state",
        "oauth_state_missing",
      );
      throw new HttpError(400, "oauth_state_missing");
    }
    const admin = createAdminClient();
    consumed = await runCallbackStep(
      requestId,
      "consume_state",
      "oauth_state_invalid_or_expired",
      async () => {
        const state = await consumeOAuthState(admin, await sha256Hex(rawState));
        if (!state) {
          throw new HttpError(400, "oauth_state_invalid_or_expired");
        }
        return state;
      },
    );

    const providerError = query.get("error");
    if (providerError) {
      const reasonCode = "oauth_denied_by_user";
      logCallbackFailure(
        requestId,
        "provider_authorization",
        reasonCode,
      );
      await recordFailureAudit(consumed, requestId, "denied", reasonCode);
      return callbackRedirect(
        consumed.redirect_path,
        {
          meta_status: "error",
          reason_code: reasonCode,
          client_id: consumed.client_id,
          provider: consumed.provider ?? "facebook",
        },
        returnOrigin,
        requestId,
      );
    }

    const code = query.get("code");
    if (!code) {
      logCallbackFailure(
        requestId,
        "validate_code",
        "authorization_code_missing",
      );
      throw new HttpError(400, "authorization_code_missing");
    }
    // A porta veio no state, que atravessou o redirecionamento. As duas trocam
    // o codigo por token em endpoints e com credenciais diferentes.
    const viaInstagram = consumed!.provider === "instagram";

    let accessToken: string;
    let tokenExpiresAt: string | null;
    let metaUserId: string;
    let metaUserName: string | null;
    let instagramAccount:
      | Awaited<ReturnType<typeof getInstagramAccount>>
      | null = null;

    if (viaInstagram) {
      const igConfig = await runCallbackStep(
        requestId,
        "load_instagram_config",
        "instagram_config_missing",
        () => instagramOAuthConfig(),
      );
      const short = await runCallbackStep(
        requestId,
        "exchange_instagram_code",
        "token_exchange_failed",
        () => exchangeInstagramCode(code, igConfig),
      );
      const long = await runCallbackStep(
        requestId,
        "exchange_instagram_long_lived_token",
        "long_lived_token_exchange_failed",
        () => exchangeInstagramLongLivedToken(short.accessToken, igConfig),
      );
      const conta = await runCallbackStep(
        requestId,
        "lookup_instagram_account",
        "meta_account_lookup_failed",
        () => getInstagramAccount(long.accessToken),
      );
      accessToken = long.accessToken;
      // Diferente do token de Pagina, este VENCE — e por isso e renovavel.
      tokenExpiresAt = new Date(Date.now() + long.expiresInSeconds * 1000)
        .toISOString();
      metaUserId = conta.id;
      metaUserName = conta.username ? "@" + conta.username : conta.name;
      instagramAccount = conta;
    } else {
      const config = await runCallbackStep(
        requestId,
        "load_meta_config",
        "meta_config_missing",
        () => metaConfig(),
      );
      const shortLivedToken = await runCallbackStep(
        requestId,
        "exchange_short_lived_token",
        "token_exchange_failed",
        () => exchangeCodeForShortLivedToken(code, config),
      );
      const longLivedToken = await runCallbackStep(
        requestId,
        "exchange_long_lived_token",
        "long_lived_token_exchange_failed",
        () => exchangeForLongLivedToken(shortLivedToken.access_token, config),
      );
      const metaUser = await runCallbackStep(
        requestId,
        "lookup_meta_account",
        "meta_account_lookup_failed",
        () => getMetaUser(longLivedToken.access_token, config),
      );
      accessToken = longLivedToken.access_token;
      tokenExpiresAt = longLivedToken.expires_in
        ? new Date(Date.now() + longLivedToken.expires_in * 1000).toISOString()
        : null;
      metaUserId = metaUser.id;
      metaUserName = metaUser.name;
    }

    const connectionId = await runCallbackStep(
      requestId,
      "create_pending_connection",
      "pending_connection_create_failed",
      () =>
        createPendingConnection(admin, {
          oauthStateId: consumed!.oauth_state_id,
          metaUserId,
          metaUserName,
          accessToken,
          tokenExpiresAt,
          scopes: consumed!.requested_scopes,
          requestId,
          provider: viaInstagram ? "instagram" : "facebook",
        }),
    );
    createdConnectionId = connectionId;

    // O login direto ja identifica uma unica conta do Instagram. Nao existe
    // Pagina do Facebook para escolher, portanto a conexao e ativada aqui no
    // callback. O fluxo Facebook permanece pendente ate a escolha da Pagina.
    if (viaInstagram) {
      const account = instagramAccount!;
      await runCallbackStep(
        requestId,
        "finalize_instagram_connection",
        "instagram_connection_finalize_failed",
        () =>
          finalizeInstagramConnection(admin, {
            connectionId,
            actorUserId: consumed!.requested_by,
            instagramId: account.id,
            instagramName: account.name ?? account.username ?? account.id,
            instagramUsername: account.username,
            instagramAccountType: null,
            requestId,
          }),
      );

      return callbackRedirect(
        consumed.redirect_path,
        {
          meta_status: "connected",
          client_id: consumed.client_id,
          connection_id: connectionId,
          provider: "instagram",
        },
        returnOrigin,
        requestId,
      );
    }

    return callbackRedirect(
      consumed.redirect_path,
      {
        meta_status: "pending",
        client_id: consumed.client_id,
        connection_id: connectionId,
        provider: "facebook",
      },
      returnOrigin,
      requestId,
    );
  } catch (error) {
    const reasonCode = error instanceof HttpError
      ? error.reasonCode
      : "unexpected_callback_error";
    if (!(error instanceof HttpError)) {
      logCallbackFailure(
        requestId,
        "build_redirect",
        reasonCode,
        error,
      );
    }
    if (consumed) {
      await recordFailureAudit(
        consumed,
        requestId,
        "failure",
        reasonCode,
        createdConnectionId,
      );
    }
    const errorParams: Record<string, string> = {
      meta_status: "error",
      reason_code: reasonCode,
    };
    if (consumed) {
      errorParams.client_id = consumed.client_id;
      errorParams.provider = consumed.provider ?? "facebook";
    }
    return callbackRedirect(
      consumed?.redirect_path ?? "/clients",
      errorParams,
      returnOrigin,
      requestId,
    );
  }
});
