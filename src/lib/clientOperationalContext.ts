import type { KnowledgeItem } from "./contentKnowledge";

export function currentKnowledge(items: KnowledgeItem[], today: string) {
  return items.filter((item) => item.status === "active"
    && (!item.effective_from || item.effective_from.slice(0, 10) <= today)
    && (!item.effective_until || item.effective_until.slice(0, 10) >= today));
}

export function compareContractCounts(expected: Record<string, number>, pieces: Array<{ content_type: string | null }>) {
  return Object.entries(expected).map(([type, contracted]) => ({
    type, contracted, planned: pieces.filter((piece) => piece.content_type === type).length,
  })).filter((row) => row.contracted > 0 || row.planned > 0);
}
