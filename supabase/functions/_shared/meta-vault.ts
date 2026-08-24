import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, safeLog } from "./http.ts";
import type { ConsumedOAuthState } from "./meta-types.ts";

const FUNCTION_NAME = "meta-oauth-callback";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizedPostgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = String(error.code ?? "").toUpperCase();
  return /^[A-Z0-9_]{3,20}$/.test(code) ? code : undefined;
}

function rpcFailure(reason: string): never {
  throw new HttpError(500, reason);
}

function connectionIdFromRpcData(data: unknown, depth = 0): string | null {
  if (typeof data === "string") {
    return UUID_PATTERN.test(data) ? data : null;
  }
  if (depth > 1) return null;
  if (Array.isArray(data)) {
    return data.length === 1
      ? connectionIdFromRpcData(data[0], depth + 1)
      : null;
  }
  if (!data || typeof data !== "object") return null;

  const record = data as Record<string, unknown>;
  for (
    const key of [
      "connection_id",
      "id",
      "meta_server_create_pending_connection",
    ]
  ) {
    if (key in record) {
      return connectionIdFromRpcData(record[key], depth + 1);
    }
  }
  return null;
}

export async function createOAuthState(
  admin: SupabaseClient,
  input: {
    clientId: string;
    requestedBy: string;
    stateHash: string;
    scopes: string[];
    redirectPath: string;
    expiresAt: string;
    requestId: string;
  },
): Promise<string> {
  const { data, error } = await admin.rpc("meta_server_create_oauth_state", {
    _client_id: input.clientId,
    _requested_by: input.requestedBy,
    _state_hash: input.stateHash,
    _requested_scopes: input.scopes,
    _redirect_path: input.redirectPath,
    _expires_at: input.expiresAt,
    _request_id: input.requestId,
  });
  if (error || typeof data !== "string") {
    rpcFailure("oauth_state_create_failed");
  }
  return data;
}

export async function consumeOAuthState(
  admin: SupabaseClient,
  stateHash: string,
): Promise<ConsumedOAuthState | null> {
  const { data, error } = await admin.rpc("meta_server_consume_oauth_state", {
    _state_hash: stateHash,
  });
  if (error) rpcFailure("oauth_state_consume_failed");
  return Array.isArray(data) && data.length === 1
    ? data[0] as ConsumedOAuthState
    : null;
}

export async function createPendingConnection(
  admin: SupabaseClient,
  input: {
    oauthStateId: string;
    metaUserId: string;
    metaUserName?: string | null;
    accessToken: string;
    tokenExpiresAt: string | null;
    scopes: string[];
    requestId: string;
  },
): Promise<string> {
  const { data, error } = await admin.rpc(
    "meta_server_create_pending_connection",
    {
      _oauth_state_id: input.oauthStateId,
      _meta_user_id: input.metaUserId,
      _access_token: input.accessToken,
      _token_expires_at: input.tokenExpiresAt,
      _granted_scopes: input.scopes,
      _request_id: input.requestId,
      _meta_user_name: input.metaUserName ?? null,
    },
  );
  const connectionId = connectionIdFromRpcData(data);
  if (error || !connectionId) {
    const postgresErrorCode = sanitizedPostgresErrorCode(error);
    safeLog("meta_rpc_failure", {
      function_name: FUNCTION_NAME,
      request_id: input.requestId,
      rpc_name: "meta_server_create_pending_connection",
      reason_code: "pending_connection_create_failed",
      ...(postgresErrorCode ? { postgres_error_code: postgresErrorCode } : {}),
    });
    rpcFailure("pending_connection_create_failed");
  }
  return connectionId;
}

export async function getConnectionToken(
  admin: SupabaseClient,
  connectionId: string,
): Promise<string> {
  const { data, error } = await admin.rpc("meta_server_get_connection_token", {
    _connection_id: connectionId,
  });
  if (error || typeof data !== "string" || !data) {
    rpcFailure("connection_token_unavailable");
  }
  return data;
}

export async function replaceConnectionToken(admin: SupabaseClient, input: {
  connectionId: string;
  actorUserId: string;
  accessToken: string;
  tokenExpiresAt: string | null;
  requestId: string;
}): Promise<void> {
  const { error } = await admin.rpc("meta_server_replace_connection_token", {
    _connection_id: input.connectionId,
    _actor_user_id: input.actorUserId,
    _access_token: input.accessToken,
    _token_expires_at: input.tokenExpiresAt,
    _request_id: input.requestId,
  });
  if (error) rpcFailure("connection_token_replace_failed");
}

export async function removeConnectionToken(admin: SupabaseClient, input: {
  connectionId: string;
  actorUserId: string;
  reasonCode: string;
  requestId: string;
}): Promise<void> {
  const { error } = await admin.rpc("meta_server_remove_connection_token", {
    _connection_id: input.connectionId,
    _actor_user_id: input.actorUserId,
    _reason_code: input.reasonCode,
    _request_id: input.requestId,
  });
  if (error) rpcFailure("connection_token_remove_failed");
}

export async function finalizeConnection(admin: SupabaseClient, input: {
  connectionId: string;
  actorUserId: string;
  facebookPageId: string;
  facebookPageName: string;
  pageTasks: string[];
  instagramId: string | null;
  instagramName: string | null;
  instagramUsername: string | null;
  instagramAccountType: string | null;
  requestId: string;
}): Promise<void> {
  const { error } = await admin.rpc("meta_server_finalize_connection", {
    _connection_id: input.connectionId,
    _actor_user_id: input.actorUserId,
    _facebook_page_id: input.facebookPageId,
    _facebook_page_name: input.facebookPageName,
    _page_tasks: input.pageTasks,
    _instagram_account_id: input.instagramId,
    _instagram_display_name: input.instagramName,
    _instagram_username: input.instagramUsername,
    _instagram_account_type: input.instagramAccountType,
    _request_id: input.requestId,
  });
  if (error) rpcFailure("connection_finalize_failed");
}

export async function disconnectConnection(admin: SupabaseClient, input: {
  connectionId: string;
  actorUserId: string;
  reasonCode: string;
  requestId: string;
}): Promise<void> {
  const { error } = await admin.rpc("meta_server_disconnect_connection", {
    _connection_id: input.connectionId,
    _actor_user_id: input.actorUserId,
    _reason_code: input.reasonCode,
    _request_id: input.requestId,
  });
  if (error) rpcFailure("connection_disconnect_failed");
}

export async function recordAudit(admin: SupabaseClient, input: {
  clientId: string;
  connectionId: string | null;
  actorUserId: string | null;
  action: string;
  result: string;
  reasonCode: string | null;
  requestId: string;
}): Promise<void> {
  const { error } = await admin.rpc("meta_server_record_audit", {
    _client_id: input.clientId,
    _connection_id: input.connectionId,
    _actor_user_id: input.actorUserId,
    _action: input.action,
    _result: input.result,
    _reason_code: input.reasonCode,
    _request_id: input.requestId,
  });
  if (error) rpcFailure("meta_audit_write_failed");
}
