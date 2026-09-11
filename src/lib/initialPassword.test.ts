import { describe, expect, it } from "vitest";

import { safePasswordReturnPath } from "./initialPassword";

describe("safePasswordReturnPath", () => {
  it("preserva uma rota interna válida", () => {
    expect(safePasswordReturnPath("/dashboard?origem=login")).toBe("/dashboard?origem=login");
  });

  it.each([
    undefined,
    null,
    "https://site-malicioso.test",
    "//site-malicioso.test",
    "/primeiro-acesso/senha",
  ])("volta para a seleção de agência quando o destino não é seguro: %s", (candidate) => {
    expect(safePasswordReturnPath(candidate)).toBe("/organizations/select");
  });
});
