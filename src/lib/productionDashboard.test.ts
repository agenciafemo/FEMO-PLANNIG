import { describe, expect, it } from "vitest";
import { summarizeProduction, type ProductionMetricRow } from "./productionDashboard";

const piece = (steps: ProductionMetricRow["production_item_steps"], overrides: Partial<ProductionMetricRow> = {}): ProductionMetricRow => ({
  id: "p", client_id: "c", content_type: "linkedin", post_id: "post", assignee_id: null, production_item_steps: steps, ...overrides,
});
const step = (done: boolean, done_at: string | null = null, assignee_id: string | null = null) => ({ done, done_at, assignee_id });
const summary = (rows: ProductionMetricRow[], members: Set<string> | null = null) => summarizeProduction(rows, "2026-09-01", "2026-09-10", members);

describe("indicadores de produção", () => {
  it("inclui LinkedIn, separando etapas parciais e peças sem etapas", () => {
    expect(summary([piece([step(true), step(false)]), piece([])])).toMatchObject({ total: 2, open: 2, doing: 1, todo: 1, withoutSteps: 1 });
  });
  it("usa a última conclusão das etapas, não a atualização da peça", () => {
    expect(summary([piece([step(true, "2026-08-25T12:00:00Z"), step(true, "2026-09-02T12:00:00Z")])])).toMatchObject({ done: 1, completedInPeriod: 1 });
  });
  it("exclui entregas antigas e futuras do período", () => {
    expect(summary([piece([step(true, "2026-08-31T12:00:00Z")]), piece([step(true, "2026-09-11T12:00:00Z")])]).completedInPeriod).toBe(0);
  });
  it("não inventa datas de conclusão", () => {
    expect(summary([piece([step(true)])])).toMatchObject({ done: 1, completedInPeriod: 0, unknownCompletionDate: 1 });
  });
  it("considera a função de qualquer responsável da etapa", () => {
    expect(summary([piece([step(false, null, "designer")]), piece([step(false, null, "writer")])], new Set(["designer"])).total).toBe(1);
  });
  it("não trata tarefa extra avulsa como vínculo quebrado", () => {
    expect(summary([piece([], { post_id: null }), piece([], { content_type: "extra", post_id: null })]).unlinked).toBe(1);
  });
  it("respeita o limite de dia em São Paulo", () => {
    expect(summary([piece([step(true, "2026-09-01T02:59:59Z")]), piece([step(true, "2026-09-01T03:00:00Z")])]).completedInPeriod).toBe(1);
  });
});
