import type { AssigneeResolver } from "@/lib/subtaskTemplates";

// Etapas de produção e como cada peça flui. As palavras-chave casam com o nome
// da FUNÇÃO da equipe (quem faz a etapa).
export type Stage = "copy" | "design" | "roteiro" | "edicao" | "texto" | "revisao" | "pronto";

// copy/design = Giu (designer/social); roteiro/texto = Nanda (roteirista);
// edicao = Edu (editor); revisao/pronto sem responsável automático.
export const STAGE_META: Record<Stage, { label: string; column: string; kw: string[] }> = {
  copy:    { label: "Copy",    column: "escrita",  kw: ["designer", "design", "social", "midia", "arte"] },
  design:  { label: "Design",  column: "producao", kw: ["designer", "design", "social", "midia", "arte"] },
  roteiro: { label: "Roteiro", column: "escrita",  kw: ["roteir", "redac", "redat", "escrit", "copy"] },
  texto:   { label: "Texto",   column: "escrita",  kw: ["roteir", "redac", "redat", "escrit", "texto", "blog"] },
  edicao:  { label: "Edição",  column: "producao", kw: ["editor", "edi", "video", "corte"] },
  revisao: { label: "Revisão", column: "revisao",  kw: ["head", "gestor", "adm", "diretor"] },
  pronto:  { label: "Pronto",  column: "pronto",   kw: [] },
};

export const PIPELINES: Record<string, Stage[]> = {
  carousel: ["copy", "design", "revisao", "pronto"],
  static:   ["copy", "design", "revisao", "pronto"],
  story:    ["design", "revisao", "pronto"],
  reels:    ["roteiro", "edicao", "revisao", "pronto"],
  blog:     ["texto", "revisao", "pronto"],
};

export const PIECE_LABEL: Record<string, string> = {
  carousel: "Carrossel", static: "Post", story: "Story", reels: "Reel", blog: "Blog",
};

export const COLUMNS: { key: string; label: string }[] = [
  { key: "escrita", label: "Escrita (Copy/Roteiro)" },
  { key: "producao", label: "Produção (Design/Edição)" },
  { key: "revisao", label: "Revisão" },
  { key: "pronto", label: "Pronto" },
];

export function firstStage(contentType: string): Stage {
  return PIPELINES[contentType]?.[0] ?? "revisao";
}

export function nextStage(contentType: string, stage: Stage): Stage | null {
  const p = PIPELINES[contentType] ?? [];
  const i = p.indexOf(stage);
  return i >= 0 && i < p.length - 1 ? p[i + 1] : null;
}

export type PieceCounts = { static: number; reels: number; carousel: number; story: number; blog: number };

// Cria os itens de produção de um planejamento (1 por peça, na 1ª etapa, já
// atribuído). Notas (ex.: datas do mês) vão só pras peças de escrita textual
// (reels/roteiro e blog/texto), que é onde a sugestão ajuda.
export function buildProductionItems(
  counts: PieceCounts,
  base: { organization_id: string; planning_id: string; client_id: string; created_by: string },
  resolve: AssigneeResolver,
  writingNotes: string | null,
): Array<Record<string, unknown>> {
  const order: Array<keyof PieceCounts> = ["reels", "carousel", "static", "story", "blog"];
  const rows: Array<Record<string, unknown>> = [];
  let pos = 0;
  for (const ct of order) {
    const count = counts[ct];
    if (!count) continue;
    const stage = firstStage(ct);
    for (let i = 1; i <= count; i++) {
      rows.push({
        ...base,
        content_type: ct,
        piece_number: i,
        stage,
        assignee_id: resolve(STAGE_META[stage].kw),
        notes: (ct === "reels" || ct === "blog") ? writingNotes : null,
        position: pos++,
      });
    }
  }
  return rows;
}
