import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export const organizationRoleLabels = {
  owner: "Proprietário", admin: "Administrador", manager: "Líder", editor: "Colaborador", viewer: "Leitura",
};
export const canReviewOrganizationAccess = (role: string | null) => ["owner", "admin", "manager"].includes(role ?? "");
const status = z.enum(["pending", "approved", "rejected"]);
const directorySchema = z.array(z.object({ id: z.string(), name: z.string(), slug: z.string(), request_status: status.nullable() }));
const requestsSchema = z.array(z.object({ id: z.string(), organization_id: z.string(), organization_name: z.string(), status, created_at: z.string() }));
const queueSchema = z.object({ accepts_join_requests: z.boolean(), requests: z.array(z.object({ id: z.string(), user_id: z.string(), email: z.string(), created_at: z.string() })) });
// Narrow adapter for additive RPCs until deployed schema types are regenerated.
const client = supabase as unknown as { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
async function rpc(name: string, args?: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
export async function searchOrganizations(search: string, offset = 0) {
  return directorySchema.parse(await rpc("search_joinable_organizations", { _search: search.trim(), _offset: offset }));
}
export async function myOrganizationRequests() {
  return requestsSchema.parse(await rpc("my_organization_join_requests"));
}
export async function requestOrganizationAccess(organizationId: string) {
  return z.string().parse(await rpc("request_organization_access", { _organization_id: organizationId }));
}
export async function organizationReviewQueue(organizationId: string) {
  return queueSchema.parse(await rpc("organization_access_review_queue", { _organization_id: organizationId }));
}
export async function reviewOrganizationRequest(requestId: string, approve: boolean) {
  await rpc("review_organization_access", { _request_id: requestId, _approve: approve });
}
export async function setOrganizationDiscovery(organizationId: string, enabled: boolean) {
  await rpc("set_organization_discovery", { _organization_id: organizationId, _enabled: enabled });
}
