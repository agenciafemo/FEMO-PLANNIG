import { describe, expect, it } from "vitest";

import { hasActiveDateRange, isDayWithinRange } from "./dateRange";

describe("dateRange", () => {
  it("não restringe resultados quando o período está vazio", () => {
    expect(hasActiveDateRange("", "")).toBe(false);
    expect(isDayWithinRange(null, "", "")).toBe(true);
  });

  it("inclui as datas inicial e final", () => {
    expect(isDayWithinRange("2026-08-01", "2026-08-01", "2026-08-31")).toBe(true);
    expect(isDayWithinRange("2026-08-31", "2026-08-01", "2026-08-31")).toBe(true);
  });

  it("aceita intervalos abertos em apenas uma extremidade", () => {
    expect(isDayWithinRange("2026-08-15", "2026-08-10", "")).toBe(true);
    expect(isDayWithinRange("2026-08-09", "2026-08-10", "")).toBe(false);
    expect(isDayWithinRange("2026-08-15", "", "2026-08-20")).toBe(true);
    expect(isDayWithinRange("2026-08-21", "", "2026-08-20")).toBe(false);
  });

  it("oculta itens sem data quando existe um período ativo", () => {
    expect(isDayWithinRange(null, "2026-08-01", "2026-08-31")).toBe(false);
  });
});
