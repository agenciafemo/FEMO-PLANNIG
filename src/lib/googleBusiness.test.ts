import { describe, expect, it } from "vitest";
import {
  GoogleBusinessStatusError,
  googleBusinessStatusMessage,
} from "./googleBusiness";

describe("googleBusinessStatusMessage", () => {
  it("PGRST202 aponta o ambiente, não a migration que já existe", () => {
    // Este é o caso que motivou a mudança: a função não existir no banco que o
    // site está usando NÃO significa que a migration não foi escrita — em
    // produção ela existe. Dizer "falta migration" mandou uma investigação
    // inteira para o lugar errado.
    const { titulo, detalhe, codigo } = googleBusinessStatusMessage({
      code: "PGRST202",
      message: "Could not find the function public.get_google_business_connection_status",
    });
    expect(titulo).toContain("ambiente");
    expect(detalhe).toMatch(/produção/);
    expect(codigo).toBe("PGRST202");
  });

  it("42501 fala de permissão, não de instalação", () => {
    const { titulo, detalhe } = googleBusinessStatusMessage({
      code: "42501",
      message: "permission denied for function get_google_business_connection_status",
    });
    expect(titulo).toContain("permissão");
    // O GRANT some quando a função é recriada — já derrubou o OAuth da Meta.
    expect(detalhe).toContain("GRANT");
  });

  it("401 é sessão, e não menciona a integração", () => {
    const { titulo, detalhe } = googleBusinessStatusMessage({ status: 401 });
    expect(titulo).toContain("Sessão");
    expect(detalhe).not.toMatch(/migration|Edge Function/i);
  });

  it("resposta vazia não vira 'falta migration'", () => {
    const erro = new GoogleBusinessStatusError(
      "sem_resposta",
      null,
      "google_business_status_unavailable",
    );
    const { titulo, codigo } = googleBusinessStatusMessage(erro);
    expect(titulo).toBe("Status indisponível");
    expect(codigo).toBeNull();
  });

  it("erro desconhecido mostra a mensagem original, em vez de inventar causa", () => {
    const { detalhe } = googleBusinessStatusMessage({
      code: "08006",
      message: "connection failure",
    });
    expect(detalhe).toBe("connection failure");
  });

  it("não quebra com erro sem forma nenhuma", () => {
    // O erro chega de bibliotecas diferentes; assumir formato aqui trocaria uma
    // tela de aviso por uma tela branca.
    expect(() => googleBusinessStatusMessage(undefined)).not.toThrow();
    expect(googleBusinessStatusMessage(undefined).codigo).toBeNull();
  });
});
