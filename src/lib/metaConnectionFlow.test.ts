import { describe, expect, it } from "vitest";
import { requiresFacebookPageSelection } from "./metaConnectionFlow";

describe("requiresFacebookPageSelection", () => {
  it("mantem a escolha de pagina no login via Facebook/agencia", () => {
    expect(requiresFacebookPageSelection("pending", "facebook")).toBe(true);
  });

  it("nao abre o seletor no login direto do Instagram", () => {
    expect(requiresFacebookPageSelection("pending", "instagram")).toBe(false);
  });

  it("nao abre o seletor para conexoes ja ativas", () => {
    expect(requiresFacebookPageSelection("active", "facebook")).toBe(false);
  });
});
