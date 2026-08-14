import { supabase } from "@/integrations/supabase/client";

export type ClientOption = { id: string; name: string; logo_url: string | null };
export type Formality = "casual" | "balanced" | "formal";
export type KnowledgeType =
  | "briefing"
  | "product_service"
  | "faq"
  | "regulation"
  | "reference"
  | "approved_example"
  | "rejected_example";
export type ClaimStatus = "approved" | "prohibited" | "review_required";
export type RuleSeverity = "info" | "warning" | "block";

export type ContentProfile = {
  id?: string;
  brand_summary: string;
  segment: string;
  specialties: string[];
  positioning: string;
  differentiators: string[];
  location_scope: string;
  products_services: string[];
  personas: string[];
  audience_pains: string[];
  audience_desires: string[];
  audience_objections: string[];
  audience_language: string;
  sensitive_topics: string[];
  voice_personality: string;
  formality: Formality;
  preferred_words: string[];
  forbidden_words: string[];
  emoji_limit: number;
  preferred_ctas: string[];
  forbidden_ctas: string[];
  mandatory_disclosures: string[];
  notes: string;
};

export type KnowledgeItem = {
  id: string;
  item_type: KnowledgeType;
  title: string;
  content: string;
  source_url: string | null;
  tags: string[];
  status: "active" | "archived";
  effective_from: string | null;
  effective_until: string | null;
  updated_at: string;
};

export type ContentClaim = {
  id: string;
  claim_text: string;
  status: ClaimStatus;
  source_title: string | null;
  source_url: string | null;
  usage_notes: string | null;
  effective_from: string | null;
  effective_until: string | null;
  updated_at: string;
};

export type ComplianceRule = {
  id: string;
  client_id: string | null;
  segment: string | null;
  title: string;
  rule_text: string;
  severity: RuleSeverity;
  channels: string[];
  source_title: string | null;
  source_url: string | null;
  version: number;
  effective_from: string | null;
  effective_until: string | null;
  exceptions: string | null;
  status: "active" | "archived";
  updated_at: string;
};

type QueryError = { message: string; code?: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };
interface QueryBuilder<T> extends PromiseLike<QueryResult<T>> {
  select(columns?: string): QueryBuilder<T>;
  eq(column: string, value: unknown): QueryBuilder<T>;
  or(filters: string): QueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): QueryBuilder<T>;
  insert(values: Record<string, unknown>): QueryBuilder<T>;
  upsert(values: Record<string, unknown>, options?: { onConflict?: string }): QueryBuilder<T>;
  update(values: Record<string, unknown>): QueryBuilder<T>;
  delete(): QueryBuilder<T>;
  maybeSingle(): PromiseLike<QueryResult<T>>;
}

export const contentDb = supabase as unknown as {
  from<T>(relation: string): QueryBuilder<T>;
};

export const EMPTY_PROFILE: ContentProfile = {
  brand_summary: "",
  segment: "",
  specialties: [],
  positioning: "",
  differentiators: [],
  location_scope: "",
  products_services: [],
  personas: [],
  audience_pains: [],
  audience_desires: [],
  audience_objections: [],
  audience_language: "",
  sensitive_topics: [],
  voice_personality: "",
  formality: "balanced",
  preferred_words: [],
  forbidden_words: [],
  emoji_limit: 2,
  preferred_ctas: [],
  forbidden_ctas: [],
  mandatory_disclosures: [],
  notes: "",
};

export function linesToArray(value: string): string[] {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

export function arrayToLines(value: string[] | null | undefined): string {
  return (value ?? []).join("\n");
}

export async function loadClients(organizationId: string): Promise<ClientOption[]> {
  const { data, error } = await contentDb.from<ClientOption[]>("clients")
    .select("id, name, logo_url")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function loadContentBase(organizationId: string, clientId: string) {
  const [profileResult, itemsResult, claimsResult, rulesResult] = await Promise.all([
    contentDb.from<ContentProfile>("client_content_profiles")
      .select("id, brand_summary, segment, specialties, positioning, differentiators, location_scope, products_services, personas, audience_pains, audience_desires, audience_objections, audience_language, sensitive_topics, voice_personality, formality, preferred_words, forbidden_words, emoji_limit, preferred_ctas, forbidden_ctas, mandatory_disclosures, notes")
      .eq("organization_id", organizationId).eq("client_id", clientId).maybeSingle(),
    contentDb.from<KnowledgeItem[]>("client_knowledge_items")
      .select("*").eq("organization_id", organizationId).eq("client_id", clientId)
      .order("updated_at", { ascending: false }),
    contentDb.from<ContentClaim[]>("client_content_claims")
      .select("*").eq("organization_id", organizationId).eq("client_id", clientId)
      .order("updated_at", { ascending: false }),
    contentDb.from<ComplianceRule[]>("client_compliance_rules")
      .select("*").eq("organization_id", organizationId)
      .or(`client_id.eq.${clientId},client_id.is.null`)
      .order("updated_at", { ascending: false }),
  ]);
  const error = profileResult.error ?? itemsResult.error ?? claimsResult.error ?? rulesResult.error;
  if (error) throw error;
  return {
    profile: profileResult.data ? { ...EMPTY_PROFILE, ...profileResult.data } : { ...EMPTY_PROFILE },
    items: itemsResult.data ?? [],
    claims: claimsResult.data ?? [],
    rules: rulesResult.data ?? [],
  };
}
