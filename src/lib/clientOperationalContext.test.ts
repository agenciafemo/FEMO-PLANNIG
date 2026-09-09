import { describe, expect, it } from "vitest";
import { currentKnowledge, compareContractCounts } from "./clientOperationalContext";
import type { KnowledgeItem } from "./contentKnowledge";

describe("contexto operacional", () => {
  const item = { id: "1", title: "Briefing", content: "Contexto", status: "active", effective_from: null, effective_until: null } as KnowledgeItem;
  it("exclui briefing arquivado, futuro e vencido", () => {
    expect(currentKnowledge([item, { ...item, status: "archived" }, { ...item, effective_from: "2026-10-01" }, { ...item, effective_until: "2026-09-08" }], "2026-09-09")).toEqual([item]);
  });
  it("inclui as datas inicial e final de vigência", () => {
    expect(currentKnowledge([{ ...item, effective_from: "2026-09-09", effective_until: "2026-09-09" }], "2026-09-09")).toHaveLength(1);
  });
  it("compara extras e faltas sem modificar peças", () => {
    const pieces = [{ content_type: "linkedin" }, { content_type: "linkedin" }];
    expect(compareContractCounts({ linkedin: 1, reels: 2, blog: 0 }, pieces)).toEqual([
      { type: "linkedin", contracted: 1, planned: 2 }, { type: "reels", contracted: 2, planned: 0 },
    ]);
    expect(pieces).toHaveLength(2);
  });
});
