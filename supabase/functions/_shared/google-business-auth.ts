import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";
import { createUserClient } from "./supabase.ts";

const MANAGER_ROLES = new Set(["owner", "admin", "manager"]);

export type GoogleBusinessActor = {
  userId: string;
  email: string | null;
};

export async function requireGoogleBusinessActor(
  request: Request,
): Promise<GoogleBusinessActor> {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new HttpError(401, "authentication_required");

  const client = createUserClient(match[1]);
  const { data, error } = await client.auth.getUser(match[1]);
  if (error || !data.user) throw new HttpError(401, "invalid_user_session");
  return { userId: data.user.id, email: data.user.email ?? null };
}

export async function requireGoogleBusinessMembership(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  managerOnly = false,
): Promise<void> {
  const { data, error } = await admin
    .from("organization_members")
    .select("role, status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, "membership_lookup_failed");
  if (!data || data.status !== "active") {
    throw new HttpError(403, "google_business_access_forbidden");
  }
  if (managerOnly && !MANAGER_ROLES.has(data.role)) {
    throw new HttpError(403, "google_business_management_forbidden");
  }
}
