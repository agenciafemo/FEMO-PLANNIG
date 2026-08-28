import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";
import { createUserClient } from "./supabase.ts";

const MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
const EDITOR_ROLES = new Set(["owner", "admin", "manager", "editor"]);

export type GoogleCalendarActor = {
  userId: string;
  email: string | null;
};

function bearerToken(request: Request): string {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new HttpError(401, "authentication_required");
  return match[1];
}

export async function requireGoogleCalendarActor(
  request: Request,
): Promise<GoogleCalendarActor> {
  const token = bearerToken(request);
  const userClient = createUserClient(token);
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "invalid_user_session");
  return { userId: data.user.id, email: data.user.email ?? null };
}

export async function requireGoogleCalendarMembership(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  permission: "member" | "editor" | "manager",
): Promise<void> {
  const { data, error } = await admin
    .from("organization_members")
    .select("role, status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, "membership_lookup_failed");
  if (!data || data.status !== "active") {
    throw new HttpError(403, "google_calendar_access_forbidden");
  }
  if (permission === "manager" && !MANAGER_ROLES.has(data.role)) {
    throw new HttpError(403, "google_calendar_management_forbidden");
  }
  if (permission === "editor" && !EDITOR_ROLES.has(data.role)) {
    throw new HttpError(403, "google_calendar_sync_forbidden");
  }
}
