import { supabase } from "@/integrations/supabase/client";

/**
 * Quem assume uma etapa quando a organizacao NAO configurou responsavel fixo
 * para a funcao. Recebe as palavras-chave da funcao e devolve a pessoa.
 *
 * Vivia num modulo separado, ao lado de um segundo modelo de "etapas por tipo
 * de peca" que ninguem mais chamava. Trazido para ca porque e aqui que moram
 * ROLE_KW e assigneeForRole, os unicos lugares que consomem isso — e para que
 * exista uma fonte de verdade so sobre etapas e responsaveis.
 */
export type AssigneeResolver = (keywords: string[]) => string | null;

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
  // Trabalho que não vem de um planejamento. Nasce enxuta — a equipe acrescenta
  // as etapas que aquela tarefa precisar.
  extra: [
    S("concluir", "Concluir", "check", null),
  ],
};

// Etapas acrescentadas pela equipe têm a chave começando em 'custom_' — é o que
// permite removê-las sem tocar nas etapas do modelo.
export const CUSTOM_PREFIX = "custom_";
export const isCustomStep = (key: string) => key.startsWith(CUSTOM_PREFIX);
// O sufixo aleatório evita colisão quando duas etapas são criadas no mesmo
// milissegundo (a chave é única por peça e por modelo).
export const newCustomKey = () =>
  `${CUSTOM_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const STEP_KIND_LABELS: Record<StepKind, string> = {
  check: "Tarefa simples (feito / não feito)",
  data: "Com data marcada (ex.: captação)",
  gate: "Aprovação (aprovado / reprovado)",
  acao: "Ação (executa algo)",
};

// Modelos salvos pela organização. Um tipo ausente aqui cai no modelo do código.
export type PipelineMap = Record<string, StepDef[]>;

export function stepsFor(contentType: string, pipelines?: PipelineMap | null): StepDef[] {
  return pipelines?.[contentType] ?? PIPELINES[contentType] ?? PIPELINES.static;
}

export function stepDef(contentType: string, key: string, pipelines?: PipelineMap | null): StepDef | null {
  return stepsFor(contentType, pipelines).find((s) => s.key === key) ?? null;
}

export const EDITABLE_PIECE_TYPES = ["reels", "carousel", "static", "story", "blog"] as const;

export async function loadPipelines(organizationId: string): Promise<PipelineMap> {
  const { data } = await (supabase as AnyClient)
    .from("production_step_templates")
    .select("content_type, step_key, label, kind, position, role")
    .eq("organization_id", organizationId)
    .order("position");

  const out: PipelineMap = {};
  for (const row of (data ?? []) as Array<{
    content_type: string; step_key: string; label: string; kind: StepKind;
    position: number; role: RoleKey | null;
  }>) {
    (out[row.content_type] ??= []).push(S(row.step_key, row.label, row.kind, row.role));
  }
  return out;
}

// Substitui o modelo daquele tipo por inteiro (apaga o que saiu, grava o resto).
export async function savePipeline(
  organizationId: string,
  userId: string,
  contentType: string,
  steps: StepDef[],
): Promise<void> {
  const client = supabase as AnyClient;
  const keys = steps.map((s) => s.key);

  const del = client.from("production_step_templates").delete()
    .eq("organization_id", organizationId).eq("content_type", contentType);
  const { error: delError } = await (keys.length
    ? del.not("step_key", "in", `(${keys.map((k) => `"${k}"`).join(",")})`)
    : del);
  if (delError) throw new Error(delError.message);

  if (!steps.length) return;
  const { error } = await client.from("production_step_templates").upsert(
    steps.map((s, index) => ({
      organization_id: organizationId,
      content_type: contentType,
      step_key: s.key,
      label: s.label,
      kind: s.kind,
      position: index,
      role: s.role,
      updated_by: userId,
    })),
    { onConflict: "organization_id,content_type,step_key" },
  );
  if (error) throw new Error(error.message);
}

// Volta o tipo ao modelo padrão do código (some da tabela → fallback).
export async function resetPipeline(organizationId: string, contentType: string): Promise<void> {
  const { error } = await (supabase as AnyClient)
    .from("production_step_templates").delete()
    .eq("organization_id", organizationId).eq("content_type", contentType);
  if (error) throw new Error(error.message);
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
export function stepsToReopen(
  contentType: string, stepKey: string, codes: string[], pipelines?: PipelineMap | null,
): string[] {
  const valid = new Set(stepsFor(contentType, pipelines).map((s) => s.key));
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

const norm = (valor: string) => valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Carrega as funcoes da equipe e devolve um resolvedor: dadas as palavras-chave
 * de uma funcao, entrega a primeira pessoa daquela funcao.
 *
 * E o plano B de assigneeForRole: so entra em acao quando a organizacao nao
 * apontou um responsavel fixo em production_role_assignees. O casamento por
 * nome e fragil de proposito — vale como palpite, nao como regra.
 */
export async function loadFunctionAssignees(organizationId: string): Promise<AssigneeResolver> {
  const [tagsRes, memRes] = await Promise.all([
    (supabase as AnyClient).from("team_function_tags").select("id, name").eq("organization_id", organizationId),
    (supabase as AnyClient).from("team_member_functions").select("user_id, tag_id").eq("organization_id", organizationId),
  ]);
  const tags = (tagsRes.data ?? []) as { id: string; name: string }[];
  const mems = (memRes.data ?? []) as { user_id: string; tag_id: string }[];
  const firstMemberByTag = new Map<string, string>();
  for (const m of mems) if (!firstMemberByTag.has(m.tag_id)) firstMemberByTag.set(m.tag_id, m.user_id);

  // A ORDEM das palavras-chave importa: a primeira que casar vence. E o que faz
  // "roteir" (Roteirista) ganhar de "social" (Social Midia) quando as duas existem.
  return (keywords) => {
    for (const k of keywords) {
      const nk = norm(k);
      const tag = tags.find((t) => norm(t.name).includes(nk));
      if (tag) {
        const u = firstMemberByTag.get(tag.id);
        if (u) return u;
      }
    }
    return null;
  };
}
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
  extra: "Tarefa extra",
};

export type PieceCounts = { static: number; reels: number; carousel: number; story: number; blog: number };

// Uma linha por peça. As etapas vêm depois (precisam do id da peça).
export function buildProductionItems(
  counts: PieceCounts,
  // `mes_referencia` entra pelo base e flui pelo spread abaixo: a peça de um
  // planejamento nasce com o mês dele, sem precisar deduzir depois.
  base: {
    organization_id: string;
    planning_id: string;
    client_id: string;
    created_by: string;
    mes_referencia?: string;
  },
  _roleMap: RoleMap,
  _resolve: AssigneeResolver | null,
  writingNotes: string | null,
  pipelines?: PipelineMap | null,
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
        stage: stepsFor(ct, pipelines)[0]?.key ?? "copy", // compatibilidade com a coluna antiga
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
  pipelines?: PipelineMap | null,
): Array<Record<string, unknown>> {
  return stepsFor(item.content_type, pipelines).map((step, index) => ({
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
