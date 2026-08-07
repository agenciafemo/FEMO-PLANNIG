import { sha256Hex } from "../_shared/meta-auth.ts";
import {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  getMetaUserId,
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
  | "create_pending_connection"
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
): Promise<void> {
  try {
    await recordAudit(createAdminClient(), {
      clientId: consumed.client_id,
      connectionId: null,
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
    const metaUserId = await runCallbackStep(
      requestId,
      "lookup_meta_account",
      "meta_account_lookup_failed",
      () => getMetaUserId(longLivedToken.access_token, config),
    );
    const tokenExpiresAt = longLivedToken.expires_in
      ? new Date(Date.now() + longLivedToken.expires_in * 1000).toISOString()
      : null;
    const connectionId = await runCallbackStep(
      requestId,
      "create_pending_connection",
      "pending_connection_create_failed",
      () =>
        createPendingConnection(admin, {
          oauthStateId: consumed!.oauth_state_id,
          metaUserId,
          accessToken: longLivedToken.access_token,
          tokenExpiresAt,
          scopes: consumed!.requested_scopes,
          requestId,
        }),
    );

    return callbackRedirect(
      consumed.redirect_path,
      {
        meta_status: "pending",
        client_id: consumed.client_id,
        connection_id: connectionId,
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
      await recordFailureAudit(consumed, requestId, "failure", reasonCode);
    }
    return callbackRedirect(
      consumed?.redirect_path ?? "/clients",
      {
        meta_status: "error",
        reason_code: reasonCode,
      },
      returnOrigin,
      requestId,
    );
  }
});
