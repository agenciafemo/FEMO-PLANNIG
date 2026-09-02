import { describe, expect, it } from "vitest";

import { parseMeetingDetailedSummary } from "./meetingDetails";

const validDetails = {
  panorama: "A equipe discutiu o lançamento e os riscos do cronograma.",
  topicos: [{
    titulo: "Cronograma",
    contexto: "Foram comparadas duas datas e nenhuma foi confirmada.",
    pontos_chave: ["A primeira data conflita com outro evento."],
    participantes_citados: ["Agência FEMo"],
  }],
  divergencias: [],
  questoes_em_aberto: ["Qual data será escolhida?"],
  sugestoes_conteudo: [{
    titulo: "Como escolher a data certa para lançar",
    formato: "carrossel",
    angulo: "Os critérios que a equipe usou para comparar as duas datas.",
    origem: "A comparação entre as duas datas de lançamento.",
  }],
  limitacoes: [],
};

describe("parseMeetingDetailedSummary", () => {
  it("aceita a estrutura completa gerada pela IA", () => {
    expect(parseMeetingDetailedSummary(validDetails)).toEqual(validDetails);
  });

  // Análises geradas antes das sugestões existirem não têm o campo. Elas
  // precisam continuar abrindo: devolver null aqui sumiria com a análise
  // inteira da tela por causa de um campo que ninguém pediu na época.
  it("aceita análise antiga, sem o campo de sugestões", () => {
    const { sugestoes_conteudo: _ignorado, ...semSugestoes } = validDetails;
    expect(parseMeetingDetailedSummary(semSugestoes)).toEqual({
      ...semSugestoes,
      sugestoes_conteudo: [],
    });
  });

  // Sugestão malformada não deve derrubar o resto: perder as pautas é bem
  // menos grave que perder o panorama e os tópicos.
  it("descarta sugestões malformadas sem perder a análise", () => {
    const resultado = parseMeetingDetailedSummary({
      ...validDetails,
      sugestoes_conteudo: [{ titulo: "Só o título" }],
    });
    expect(resultado?.panorama).toBe(validDetails.panorama);
    expect(resultado?.sugestoes_conteudo).toEqual([]);
  });

  it("recusa objetos incompletos sem quebrar a tela", () => {
    expect(parseMeetingDetailedSummary({ panorama: "Sem tópicos" })).toBeNull();
    expect(parseMeetingDetailedSummary(null)).toBeNull();
  });
});
