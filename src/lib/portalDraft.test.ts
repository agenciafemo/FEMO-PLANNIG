import { describe, expect, it } from "vitest";
import { chaveRascunho, gravarRascunho, lerRascunho } from "./portalDraft";

function storageFalso() {
  const dados = new Map<string, string>();
  return {
    dados,
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    removeItem: (k: string) => void dados.delete(k),
  };
}

describe("rascunho do portal", () => {
  it("separa comentário e correção por post", () => {
    expect(chaveRascunho("comentario", "p1")).not.toBe(chaveRascunho("correcao", "p1"));
    expect(chaveRascunho("comentario", "p1")).not.toBe(chaveRascunho("comentario", "p2"));
  });

  it("guarda o texto e devolve ao voltar para o post", () => {
    const s = storageFalso();
    const chave = chaveRascunho("comentario", "p1");
    gravarRascunho(chave, "tirar o nome do Nicolas da touca", s);
    expect(lerRascunho(chave, s)).toBe("tirar o nome do Nicolas da touca");
  });

  it("texto em branco apaga, em vez de guardar vazio", () => {
    const s = storageFalso();
    const chave = chaveRascunho("correcao", "p1");
    gravarRascunho(chave, "algo", s);
    gravarRascunho(chave, "   ", s);
    expect(s.dados.has(chave)).toBe(false);
    expect(lerRascunho(chave, s)).toBe("");
  });

  it("storage que lança (modo privado) não quebra o campo", () => {
    const quebrado = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => { throw new Error("SecurityError"); },
    };
    expect(() => gravarRascunho("k", "texto", quebrado)).not.toThrow();
    expect(lerRascunho("k", quebrado)).toBe("");
  });

  it("sem storage nenhum devolve vazio", () => {
    expect(lerRascunho("k", null)).toBe("");
    expect(() => gravarRascunho("k", "x", null)).not.toThrow();
  });
});
