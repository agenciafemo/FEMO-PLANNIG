import { describe, expect, it } from "vitest";
import { descreverMovimentacao, quandoFoi, type Movimentacao } from "./movimentacoes";

const base: Movimentacao = {
  id: "1",
  autor_id: "u1",
  autor_nome: "Fernanda",
  acao: "alterou",
  entidade: "Colaborador",
  registro_descricao: "João",
  registro_id: "r1",
  tabela: "colaboradores",
  criado_em: "2026-09-10T12:00:00Z",
};

describe("descreverMovimentacao", () => {
  it("monta a frase com o nome do registro", () => {
    expect(descreverMovimentacao(base)).toBe('Fernanda alterou o colaborador “João”');
  });

  it("omite o nome quando o registro não tem um, em vez de escrever (sem nome)", () => {
    const semNome = { ...base, entidade: "Folha de pagamento", registro_descricao: null };
    expect(descreverMovimentacao(semNome)).toBe("Fernanda alterou a folha de pagamento");
  });

  it("usa artigo feminino onde cabe", () => {
    const ficha = { ...base, entidade: "Ficha financeira", registro_descricao: null };
    expect(descreverMovimentacao(ficha)).toContain("alterou a ficha financeira");
  });

  it("não quebra quando o autor foi removido da equipe", () => {
    // autor_id vira nulo por ON DELETE SET NULL; a linha precisa continuar
    // legível, porque é justamente o histórico que se quer preservar.
    const semAutor = { ...base, autor_id: null, autor_nome: null };
    expect(descreverMovimentacao(semAutor)).toBe('Alguém alterou o colaborador “João”');
  });

  it("descreve criação e remoção com o mesmo formato", () => {
    expect(descreverMovimentacao({ ...base, acao: "criou" })).toContain("criou o colaborador");
    expect(descreverMovimentacao({ ...base, acao: "removeu" })).toContain("removeu o colaborador");
  });
});

describe("quandoFoi", () => {
  const agora = new Date("2026-09-10T12:00:00Z");

  it("mostra minutos e horas no mesmo dia", () => {
    expect(quandoFoi("2026-09-10T11:58:00Z", agora)).toBe("há 2 min");
    expect(quandoFoi("2026-09-10T09:00:00Z", agora)).toBe("há 3 h");
  });

  it("chama de agora o que acabou de acontecer", () => {
    expect(quandoFoi("2026-09-10T11:59:40Z", agora)).toBe("agora");
  });

  it("diz ontem em vez de 'há 30 h'", () => {
    expect(quandoFoi("2026-09-09T06:00:00Z", agora)).toBe("ontem");
  });

  it("cai para data quando já passou de ontem", () => {
    // Passado distante em horas não ajuda ninguém a se situar.
    expect(quandoFoi("2026-09-01T12:00:00Z", agora)).toMatch(/^\d{2}\/\d{2}$/);
  });
});
