import { beforeEach, describe, expect, it, vi } from "vitest";

const { maybeSingle } = vi.hoisted(() => ({ maybeSingle: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) },
}));
import { EMPTY_CONTRACT, loadContract, planningContractCounts } from "./clientContract";

describe("contrato do cliente", () => {
  beforeEach(() => vi.clearAllMocks());
  it("falha de leitura não significa ausência de contrato", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: "42703" } });
    await expect(loadContract("cliente")).rejects.toThrow("Não foi possível carregar");
  });
  it("ausência real permite preenchimento manual", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await loadContract("cliente")).toBeNull();
    expect(Object.values(planningContractCounts(null))).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("completa contratos antigos com padrões", async () => {
    maybeSingle.mockResolvedValue({ data: { qty_static: 4 }, error: null });
    expect(await loadContract("cliente")).toEqual({ ...EMPTY_CONTRACT, qty_static: 4 });
  });
  it("LinkedIn desligado não gera peças e não apaga quantidade salva", () => {
    const contract = { ...EMPTY_CONTRACT, qty_linkedin: 3 };
    expect(planningContractCounts(contract).linkedin).toBe(0);
    expect(contract.qty_linkedin).toBe(3);
    expect(planningContractCounts({ ...contract, does_linkedin: true }).linkedin).toBe(3);
  });
  it("novo cliente sem contrato não herda quantidades do anterior", () => {
    expect(planningContractCounts({ ...EMPTY_CONTRACT, qty_static: 8 }).static).toBe(8);
    expect(planningContractCounts(null).static).toBe(0);
  });
});
