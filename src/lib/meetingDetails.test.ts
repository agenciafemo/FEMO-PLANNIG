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
  limitacoes: [],
};

describe("parseMeetingDetailedSummary", () => {
  it("aceita a estrutura completa gerada pela IA", () => {
    expect(parseMeetingDetailedSummary(validDetails)).toEqual(validDetails);
  });

  it("recusa objetos incompletos sem quebrar a tela", () => {
    expect(parseMeetingDetailedSummary({ panorama: "Sem tópicos" })).toBeNull();
    expect(parseMeetingDetailedSummary(null)).toBeNull();
  });
});
