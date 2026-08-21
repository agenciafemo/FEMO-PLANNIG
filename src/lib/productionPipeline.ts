import type { AssigneeResolver } from "@/lib/subtaskTemplates";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

// ============================================================================
// Modelo de produção: CHECKLIST, não kanban linear.
//
// Cada peça (1 reel, 1 carrossel...) nasce com TODAS as suas etapas criadas.
// A equipe vai marcando o que conclui, em qualquer ordem — porque o trabalho é
// paralelo de verdade (a capa/legenda pode ficar pronta antes do vídeo sair da
// edição). O modelo antigo tinha UMA etapa por peça e não conseguia representar
// isso.
//
// São 4 tipos de etapa:
//   check → feito/não feito            (Copy, Design, Edição, Legenda)
//   data  → feito + data/hora marcada  (Captação)
//   gate  → aprovado/reprovado + motivo(Aprovação do roteiro / do cliente)
//   acao  → executa algo e então marca (Enviar para o planejamento)
// ============================================================================

export type StepKind = "check" | "data" | "gate" | "acao";
export type RoleKey = "design" | "writing" | "editing" | "review";

export type StepDef = {
  key: string;
  label: string;
  kind: StepKind;
  role: RoleKey | null; // quem é o responsável natural pela etapa
};

const S = (key: string, label: string, kind: StepKind, role: RoleKey | null): StepDef =>
  ({ key, label, kind, role });

// Etapas de cada tipo de conteúdo, na ordem em que aparecem na peça.
export const PIPELINES: Record<string, StepDef[]> = {
  reels: [
    S("roteiro", "Roteiro", "check", "writing"),
    S("aprov_roteiro", "Aprovação do roteiro", "gate", "review"),
    S("captacao", "Captação", "data", "editing"),
    S("edicao", "Edição", "check", "editing"),
    S("legenda_capa", "Legenda e capa", "check", "design"),
    S("enviar_planejamento", "Enviar para o planejamento", "acao", "design"),
    S("revisao", "Revisão", "check", "review"),
    S("aprov_cliente", "Aprovação do cliente", "gate", "review"),
  ],
  carousel: [
    S("copy", "Copy", "check", "design"),
    S("design", "Design", "check", "design"),
    S("legenda", "Legenda", "check", "design"),
    S("enviar_planejamento", "Enviar para o planejamento", "acao", "design"),
    S("revisao", "Revisão", "check", "review"),
    S("aprov_cliente", "Aprovação do cliente", "gate", "review"),
  ],
  static: [
    S("copy", "Copy", "check", "design"),
    S("design", "Design", "check", "design"),
    S("legenda", "Legenda", "check", "design"),
    S("enviar_planejamento", "Enviar para o planejamento", "acao", "design"),
    S("revisao", "Revisão", "check", "review"),
    S("aprov_cliente", "Aprovação do cliente", "gate", "review"),
  ],
  story: [
    S("design", "Arte do story", "check", "design"),
    S("enviar_planejamento", "Enviar para o planejamento", "acao", "design"),
    S("revisao", "Revisão", "check", "review"),
    S("aprov_cliente", "Aprovação do cliente", "gate", "review"),
  ],
  blog: [
    S("texto", "Texto", "check", "writing"),
    S("revisao", "Revisão", "check", "review"),
    S("enviar_planejamento", "Enviar para o planejamento", "acao", "design"),
    S("aprov_cliente", "Aprovação do cliente", "gate", "review"),
  ],
};

export function stepsFor(contentType: string): StepDef[] {
  return PIPELINES[contentType] ?? PIPELINES.static;
}

export function stepDef(contentType: string, key: string): StepDef | null {
  return stepsFor(contentType).find((s) => s.key === key) ?? null;
}

// ---------------------------------------------------------------------------
// Motivos de reprovação. Incluem causas que NÃO são erro da equipe (estratégia,
// pedido do cliente) — sem isso os números ficam injustos e ninguém marca certo.
// ---------------------------------------------------------------------------
export type ReasonDef = { code: string; label: string; reopen: string[] };

export const REJECTION_REASONS: Record<string, ReasonDef[]> = {
  aprov_roteiro: [
    { code: "pauta", label: "Pauta / tema", reopen: ["roteiro"] },
    { code: "abordagem", label: "Abordagem", reopen: ["roteiro"] },
    { code: "texto", label: "Texto / escrita", reopen: ["roteiro"] },
    { code: "estrategia", label: "Mudança de estratégia", reopen: ["roteiro"] },
  ],
  aprov_cliente: [
    { code: "design", label: "Design", reopen: ["design", "legenda_capa"] },
    { code: "edicao", label: "Edição", reopen: ["edicao"] },
    { code: "legenda", label: "Erro de legenda", reopen: ["legenda", "legenda_capa"] },
    { code: "portugues", label: "Erro de português", reopen: ["copy", "legenda", "legenda_capa", "texto"] },
    { code: "estrategia", label: "Mudança de estratégia", reopen: ["copy", "roteiro"] },
    { code: "pedido_cliente", label: "Pedido do cliente", reopen: [] },
  ],
};

export function reasonsFor(stepKey: string): ReasonDef[] {
  return REJECTION_REASONS[stepKey] ?? [];
}

// Quais etapas devem ser REABERTAS quando o gate é reprovado por esses motivos.
// Só reabre etapas que existem naquele tipo de conteúdo.
export function stepsToReopen(contentType: string, stepKey: string, codes: string[]): string[] {
  const valid = new Set(stepsFor(contentType).map((s) => s.key));
  const out = new Set<string>();
  for (const code of codes) {
    const def = reasonsFor(stepKey).find((r) => r.code === code);
    for (const k of def?.reopen ?? []) if (valid.has(k)) out.add(k);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Responsáveis por função (mapa explícito salvo por organização).
// ---------------------------------------------------------------------------
export type RoleMap = Record<RoleKey, string | null>;
export const EMPTY_ROLE_MAP: RoleMap = { design: null, writing: null, editing: null, review: null };

export const ROLE_LABELS: Record<RoleKey, string> = {
  design: "Design / Copy / Legenda (social mídia)",
  writing: "Roteiro / Texto",
  editing: "Captação e edição de vídeo",
  review: "Revisão e aprovações",
};

const ROLE_KW: Record<RoleKey, string[]> = {
  design: ["designer", "design", "social", "midia", "arte"],
  writing: ["roteir", "redac", "redat", "escrit", "copy"],
  editing: ["editor", "edi", "video", "corte"],
  review: ["head", "gestor", "adm", "diretor"],
};

export async function loadRoleMap(organizationId: string): Promise<RoleMap> {
  const { data } = await (supabase as AnyClient)
    .from("production_role_assignees")
    .select("design_user_id, writing_user_id, editing_user_id, review_user_id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return {
    design: data?.design_user_id ?? null,
    writing: data?.writing_user_id ?? null,
    editing: data?.editing_user_id ?? null,
    review: data?.review_user_id ?? null,
  };
}

export async function saveRoleMap(organizationId: string, userId: string, map: RoleMap): Promise<void> {
  const { error } = await (supabase as AnyClient)
    .from("production_role_assignees")
    .upsert({
      organization_id: organizationId,
      design_user_id: map.design,
      writing_user_id: map.writing,
      editing_user_id: map.editing,
      review_user_id: map.review,
      updated_by: userId,
    }, { onConflict: "organization_id" });
  if (error) throw new Error(error.message);
}

export function assigneeForRole(
  role: RoleKey | null,
  roleMap: RoleMap,
  resolve: AssigneeResolver | null,
): string | null {
  if (!role) return null;
  if (roleMap[role]) return roleMap[role];
  return resolve ? resolve(ROLE_KW[role]) : null;
}

// ---------------------------------------------------------------------------
// Criação das peças e das etapas
// ---------------------------------------------------------------------------
export const PIECE_LABEL: Record<string, string> = {
  carousel: "Carrossel", static: "Post", story: "Story", reels: "Reel", blog: "Blog",
};

export type PieceCounts = { static: number; reels: number; carousel: number; story: number; blog: number };

// Uma linha por peça. As etapas vêm depois (precisam do id da peça).
export function buildProductionItems(
  counts: PieceCounts,
  base: { organization_id: string; planning_id: string; client_id: string; created_by: string },
  _roleMap: RoleMap,
  _resolve: AssigneeResolver | null,
  writingNotes: string | null,
): Array<Record<string, unknown>> {
  const order: Array<keyof PieceCounts> = ["reels", "carousel", "static", "story", "blog"];
  const rows: Array<Record<string, unknown>> = [];
  let pos = 0;
  for (const ct of order) {
    const count = counts[ct];
    if (!count) continue;
    for (let i = 1; i <= count; i++) {
      rows.push({
        ...base,
        content_type: ct,
        piece_number: i,
        stage: stepsFor(ct)[0]?.key ?? "copy", // compatibilidade com a coluna antiga
        assignee_id: null,
        notes: (ct === "reels" || ct === "blog") ? writingNotes : null,
        position: pos++,
      });
    }
  }
  return rows;
}

// Etapas de uma peça já criada (precisa do id).
export function buildStepRows(
  item: { id: string; organization_id: string; content_type: string },
  roleMap: RoleMap,
  resolve: AssigneeResolver | null,
): Array<Record<string, unknown>> {
  return stepsFor(item.content_type).map((step, index) => ({
    organization_id: item.organization_id,
    item_id: item.id,
    step_key: step.key,
    label: step.label,
    kind: step.kind,
    position: index,
    done: false,
    assignee_id: assigneeForRole(step.role, roleMap, resolve),
  }));
}

// Progresso de uma peça (para a barra e para o dashboard).
export function pieceProgress(steps: { done: boolean }[]): { done: number; total: number; pct: number } {
  const total = steps.length;
  const done = steps.filter((s) => s.done).length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}
