import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

// Contrato de conteúdo: quantidade padrão de cada tipo de peça do cliente.
export type PaidPlatform = "meta" | "google" | "outra";

export type ContentContract = {
  qty_static: number;
  qty_reels: number;
  qty_carousel: number;
  qty_story: number;
  qty_blog: number;
  qty_linkedin: number;
  /** Separado da quantidade: "faz sob demanda" nao e "nao faz". */
  does_linkedin: boolean;
  does_paid_traffic: boolean;
  paid_platforms: PaidPlatform[];
  /** Nome da plataforma quando `paid_platforms` inclui "outra". */
  paid_platforms_other: string | null;
  /** 1 (menor) a 5 (maior). 3 e o meio, e o padrao. */
  priority: number;
  notes: string | null;
};

export const PRIORIDADE_PADRAO = 3;

/** Rotulo de cada passo da barra de importancia. */
export const PRIORIDADE_LABELS: Record<number, string> = {
  1: "Muito baixa",
  2: "Baixa",
  3: "Normal",
  4: "Alta",
  5: "Muito alta",
};

export const PLATAFORMAS_PAGAS: Array<{ id: PaidPlatform; label: string }> = [
  { id: "meta", label: "Meta (Instagram e Facebook)" },
  { id: "google", label: "Google Ads" },
  { id: "outra", label: "Outra" },
];

export const EMPTY_CONTRACT: ContentContract = {
  qty_static: 0, qty_reels: 0, qty_carousel: 0, qty_story: 0, qty_blog: 0,
  qty_linkedin: 0, does_linkedin: false, does_paid_traffic: false,
  paid_platforms: [], paid_platforms_other: null,
  priority: PRIORIDADE_PADRAO, notes: null,
};

export async function loadContract(clientId: string): Promise<ContentContract | null> {
  const { data } = await (supabase as AnyClient)
    .from("client_content_contract")
    .select(
      "qty_static, qty_reels, qty_carousel, qty_story, qty_blog, qty_linkedin, " +
        "does_linkedin, does_paid_traffic, paid_platforms, paid_platforms_other, " +
        "priority, notes",
    )
    .eq("client_id", clientId)
    .maybeSingle();
  if (!data) return null;
  // Contrato gravado ANTES desta migration nao tem os campos novos. Sem os
  // padroes aqui, `qty_linkedin` chegaria `undefined` no planejamento e o
  // contador ficaria vazio em vez de zero.
  return { ...EMPTY_CONTRACT, ...(data as Partial<ContentContract>) };
}

export async function saveContract(input: {
  clientId: string;
  organizationId: string;
  userId: string;
  contract: ContentContract;
}): Promise<void> {
  const { error } = await (supabase as AnyClient)
    .from("client_content_contract")
    .upsert(
      {
        client_id: input.clientId,
        organization_id: input.organizationId,
        ...input.contract,
        updated_by: input.userId,
      },
      { onConflict: "client_id" },
    );
  if (error) throw new Error(error.message);
}

// Completude do contexto (para a barra de % na ficha do cliente). Conta sinais
// preenchidos do perfil de conteúdo + se há itens de conhecimento (briefing).
export type ContextCompleteness = {
  percent: number;
  filled: number;
  total: number;
  hasProfile: boolean;
  knowledgeCount: number;
  missing: string[];
};

export async function loadContextCompleteness(clientId: string): Promise<ContextCompleteness> {
  const [profileRes, knowledgeRes] = await Promise.all([
    (supabase as AnyClient)
      .from("client_content_profiles")
      .select("brand_summary, segment, positioning, specialties, products_services, personas, audience_pains, differentiators, voice_personality")
      .eq("client_id", clientId)
      .maybeSingle(),
    (supabase as AnyClient)
      .from("client_knowledge_items")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId),
  ]);

  const p = (profileRes.data ?? {}) as Record<string, unknown>;
  const knowledgeCount = (knowledgeRes.count as number | null) ?? 0;

  const txt = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  const arr = (v: unknown) => Array.isArray(v) && v.length > 0;

  const signals: Array<[string, boolean]> = [
    ["Resumo da marca", txt(p.brand_summary)],
    ["Segmento", txt(p.segment)],
    ["Posicionamento", txt(p.positioning)],
    ["Especialidades", arr(p.specialties)],
    ["Produtos/serviços", arr(p.products_services)],
    ["Personas", arr(p.personas)],
    ["Dores do público", arr(p.audience_pains)],
    ["Diferenciais", arr(p.differentiators)],
    ["Voz da marca", txt(p.voice_personality)],
    ["Briefing/itens de conhecimento", knowledgeCount > 0],
  ];

  const filled = signals.filter(([, ok]) => ok).length;
  const total = signals.length;
  return {
    percent: Math.round((filled / total) * 100),
    filled,
    total,
    hasProfile: Boolean(profileRes.data),
    knowledgeCount,
    missing: signals.filter(([, ok]) => !ok).map(([label]) => label),
  };
}
