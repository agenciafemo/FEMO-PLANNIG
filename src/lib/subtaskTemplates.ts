import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Cada tipo de peça vira subtarefas de ETAPA, cada etapa ligada a uma FUNÇÃO
// (por palavras-chave que casam com o nome da função da equipe). Assim:
// Reel -> Roteiro (roteirista) + Edição (editor); Post/Carrossel -> Arte
// (designer) + Legenda (roteirista); Story -> Arte; Blog -> Texto.
type Step = { label: string; kw: string[] };
export const STEP_TEMPLATES: Record<string, { piece: string; steps: Step[] }> = {
  reels: { piece: "Reel", steps: [
    { label: "Roteiro", kw: ["roteir", "copy", "legenda", "redac", "redat", "escrit"] },
    { label: "Edição de vídeo", kw: ["edi", "video", "corte", "montag"] },
  ] },
  carousel: { piece: "Carrossel", steps: [
    { label: "Arte", kw: ["design", "arte", "social m", "midia", "designer"] },
    { label: "Legenda", kw: ["roteir", "copy", "legenda", "redac", "redat", "escrit"] },
  ] },
  static: { piece: "Post", steps: [
    { label: "Arte", kw: ["design", "arte", "social m", "midia", "designer"] },
    { label: "Legenda", kw: ["roteir", "copy", "legenda", "redac", "redat", "escrit"] },
  ] },
  story: { piece: "Story", steps: [
    { label: "Arte", kw: ["design", "arte", "social m", "midia", "designer"] },
  ] },
  blog: { piece: "Blog", steps: [
    { label: "Texto", kw: ["roteir", "copy", "redac", "redat", "escrit", "blog", "redator"] },
  ] },
};

export type AssigneeResolver = (keywords: string[]) => string | null;

// Carrega as funções da org e devolve um resolvedor: dadas palavras-chave,
// retorna a pessoa (primeiro membro) da função que casa — ou null.
export async function loadFunctionAssignees(organizationId: string): Promise<AssigneeResolver> {
  const [tagsRes, memRes] = await Promise.all([
    (supabase as AnyClient).from("team_function_tags").select("id, name").eq("organization_id", organizationId),
    (supabase as AnyClient).from("team_member_functions").select("user_id, tag_id").eq("organization_id", organizationId),
  ]);
  const tags = (tagsRes.data ?? []) as { id: string; name: string }[];
  const mems = (memRes.data ?? []) as { user_id: string; tag_id: string }[];
  const firstMemberByTag = new Map<string, string>();
  for (const m of mems) if (!firstMemberByTag.has(m.tag_id)) firstMemberByTag.set(m.tag_id, m.user_id);

  return (keywords) => {
    for (const tag of tags) {
      const n = norm(tag.name);
      if (keywords.some((k) => n.includes(norm(k)))) {
        const u = firstMemberByTag.get(tag.id);
        if (u) return u;
      }
    }
    return null;
  };
}

export type PieceCounts = { static: number; reels: number; carousel: number; story: number; blog: number };

export function buildPlanningSubtasks(
  counts: PieceCounts,
  taskId: string,
  resolve: AssigneeResolver,
): Array<{ task_id: string; title: string; position: number; assignee_id: string | null }> {
  const order: Array<keyof PieceCounts> = ["reels", "carousel", "static", "story", "blog"];
  const rows: Array<{ task_id: string; title: string; position: number; assignee_id: string | null }> = [];
  let pos = 0;
  for (const type of order) {
    const tmpl = STEP_TEMPLATES[type];
    const count = counts[type];
    if (!tmpl || !count) continue;
    for (let i = 1; i <= count; i++) {
      for (const step of tmpl.steps) {
        rows.push({
          task_id: taskId,
          title: `${step.label} — ${tmpl.piece} ${i}`,
          position: pos++,
          assignee_id: resolve(step.kw),
        });
      }
    }
  }
  return rows;
}
