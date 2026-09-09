import { describe, expect, it } from "vitest";
import { avaliarSenha, MINIMO_DE_CARACTERES } from "./senha";

describe("avaliarSenha", () => {
  const boa = "planalto-92";

  it("aceita uma senha razoável", () => {
    expect(avaliarSenha(boa, boa, "fernanda@femo.com.br")).toEqual({ ok: true, erro: "" });
  });

  it("recusa curta demais", () => {
    const r = avaliarSenha("abc12", "abc12");
    expect(r.ok).toBe(false);
    expect(r.erro).toContain(String(MINIMO_DE_CARACTERES));
  });

  it("recusa só números", () => {
    expect(avaliarSenha("12345678", "12345678").ok).toBe(false);
  });

  it("recusa repetição, que passa no comprimento sem proteger nada", () => {
    expect(avaliarSenha("aaaaaaaa", "aaaaaaaa").ok).toBe(false);
  });

  it("recusa espaço nas pontas — quase sempre é engano de colar", () => {
    // Sem isto, a pessoa salva " senha123" e depois não consegue entrar,
    // sem nunca descobrir por quê.
    const r = avaliarSenha(" senha123", " senha123");
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("espaço");
  });

  it("recusa senha que contém o usuário do e-mail", () => {
    expect(avaliarSenha("fernanda2026", "fernanda2026", "fernanda@femo.com.br").ok).toBe(false);
  });

  it("não confunde e-mail curto com pedaço da senha", () => {
    // Um e-mail como "eu@femo.com.br" não pode reprovar toda senha com "eu".
    expect(avaliarSenha("euclidiano-77", "euclidiano-77", "eu@femo.com.br").ok).toBe(true);
  });

  it("recusa quando a confirmação não bate", () => {
    const r = avaliarSenha(boa, "planalto-93");
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("iguais");
  });

  it("funciona sem e-mail informado", () => {
    expect(avaliarSenha(boa, boa, null).ok).toBe(true);
  });
});
