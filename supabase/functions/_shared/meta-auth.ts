import type { SupabaseClient } from "@supabase/supabase-js";
import { createUserClient } from "./supabase.ts";
import { HttpError } from "./http.ts";
import type {
  AuthenticatedMetaActor,
  MetaConnectionRecord,
} from "./meta-types.ts";

const META_ADMIN_ROLES = new Set(["owner", "admin", "manager"]);

// Exceção cirúrgica: quem tem a função de trabalho "Tráfego Pago" pode
// gerenciar as conexões Meta (conectar/reconectar/desconectar), mesmo sem ser
// admin/manager. Não concede nenhum outro acesso. Espelha a regra SQL de
// meta_can_manage_connection.
async function userManagesTraffic(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const { data: fns } = await admin
    .from("team_member_functions")
    .select("tag_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  const tagIds = (fns ?? []).map((f: { tag_id: string }) => f.tag_id);
  if (tagIds.length === 0) return false;
  const { data: tags } = await admin
    .from("team_function_tags")
    .select("name")
    .eq("organization_id", organizationId)
    .in("id", tagIds);
  return (tags ?? []).some((t: { name: string | null }) =>
    /tr[aá]fego/i.test(t.name ?? "")
  );
}

export function generateOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new HttpError(401, "authentication_required");
  return match[1];
}

export async function requireAuthenticatedActor(
  request: Request,
): Promise<AuthenticatedMetaActor> {
  const accessToken = bearerToken(request);
  const userClient = createUserClient(accessToken);
  const { data, error } = await userClient.auth.getUser(accessToken);
  if (error || !data.user) throw new HttpError(401, "invalid_user_session");
  return { userId: data.user.id, email: data.user.email ?? null, accessToken };
}

export async function requireClientManager(
  admin: SupabaseClient,
  clientId: string,
  userId: string,
): Promise<{ organizationId: string }> {
  const { data: client, error: clientError } = await admin
    .from("clients")
    .select("id, organization_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientError) throw new HttpError(500, "client_lookup_failed");
  if (!client) throw new HttpError(404, "client_not_found");

  const { data: member, error: memberError } = await admin
    .from("organization_members")
    .select("role, status")
    .eq("organization_id", client.organization_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (memberError) throw new HttpError(500, "membership_lookup_failed");
  if (!member || member.status !== "active") {
    throw new HttpError(403, "meta_management_forbidden");
  }
  const allowed = META_ADMIN_ROLES.has(member.role) ||
    await userManagesTraffic(admin, client.organization_id, userId);
  if (!allowed) {
    throw new HttpError(403, "meta_management_forbidden");
  }
  return { organizationId: client.organization_id };
}

export async function requireConnectionManager(
  admin: SupabaseClient,
  connectionId: string,
  userId: string,
  allowedStatuses?: MetaConnectionRecord["status"][],
): Promise<MetaConnectionRecord> {
  const { data, error } = await admin
    .from("meta_connections")
    .select("id, organization_id, client_id, status, connected_by")
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw new HttpError(500, "connection_lookup_failed");
  if (!data) throw new HttpError(404, "meta_connection_not_found");
  await requireClientManager(admin, data.client_id, userId);
  if (allowedStatuses && !allowedStatuses.includes(data.status)) {
    throw new HttpError(409, "meta_connection_state_invalid");
  }
  return data as MetaConnectionRecord;
}
