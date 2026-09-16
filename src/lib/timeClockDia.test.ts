import { describe, expect, it } from "vitest";
import { contarDia, diasDoMes, estadoDoDia, type PunchKind } from "./timeClockDia";

const em = (hora: string) => `2026-09-16T${hora}:00-03:00`;

function dia(...pares: Array<[PunchKind, string]>) {
  return pares.map(([kind, hora]) => ({ kind, punched_at: em(hora) }));
}

describe("estado do dia", () => {
  it("começa pedindo a entrada", () => {
    expect(estadoDoDia([]).proximo).toBe("entrada");
    expect(estadoDoDia([]).podeSairNoMeio).toBe(false);
  });

  it("quem está trabalhando pode sair no meio do dia", () => {
    const estado = estadoDoDia(["entrada"]);
    expect(estado.podeSairNoMeio).toBe(true);
    expect(estado.proximo).toBe("saida_almoco");
  });

  it("quem saiu no meio do dia só volta", () => {
    const estado = estadoDoDia(["entrada", "saida_intervalo"]);
    expect(estado.proximo).toBe("volta_intervalo");
    expect(estado.podeSairNoMeio).toBe(false);
    expect(estado.fora).toBe(true);
  });

  it("depois do almoço o botão principal vira a saída, e ainda dá para sair no meio", () => {
    const estado = estadoDoDia(["entrada", "saida_almoco", "volta_almoco"]);
    expect(estado.proximo).toBe("saida");
    expect(estado.podeSairNoMeio).toBe(true);
  });

  it("a saída no meio do dia se repete quantas vezes precisar", () => {
    const estado = estadoDoDia([
      "entrada", "saida_intervalo", "volta_intervalo", "saida_intervalo", "volta_intervalo",
    ]);
    expect(estado.proximo).toBe("saida_almoco");
    expect(estado.podeSairNoMeio).toBe(true);
  });

  it("encerrada a jornada, não oferece mais batida", () => {
    const estado = estadoDoDia(["entrada", "saida_almoco", "volta_almoco", "saida"]);
    expect(estado.proximo).toBeNull();
    expect(estado.encerrado).toBe(true);
  });
});

describe("conta do dia", () => {
  it("dia normal de 8h", () => {
    const { totalSeconds, pares } = contarDia(
      dia(["entrada", "08:30"], ["saida_almoco", "12:00"], ["volta_almoco", "13:00"], ["saida", "17:30"]),
    );
    expect(totalSeconds).toBe(8 * 3600);
    expect(pares).toBe(2);
  });

  it("o tempo no médico não conta como trabalhado", () => {
    // Caso real: sai às 10h, volta às 11h. Sem isso a hora fora entraria como
    // trabalhada, porque antes só existiam as duas janelas fixas.
    const conta = contarDia(
      dia(
        ["entrada", "08:30"],
        ["saida_intervalo", "10:00"],
        ["volta_intervalo", "11:00"],
        ["saida_almoco", "12:00"],
        ["volta_almoco", "13:00"],
        ["saida", "17:30"],
      ),
    );
    expect(conta.totalSeconds).toBe(7 * 3600);
    expect(conta.intervalos).toHaveLength(1);
    expect(conta.intervalos[0].seconds).toBe(3600);
    expect(conta.foraAgora).toBe(false);
  });

  it("duas saídas no mesmo dia somam certo", () => {
    const conta = contarDia(
      dia(
        ["entrada", "08:30"],
        ["saida_intervalo", "09:00"], ["volta_intervalo", "09:30"],
        ["saida_intervalo", "15:00"], ["volta_intervalo", "16:00"],
        ["saida", "17:30"],
      ),
    );
    // 9h de janela, menos 30min e 1h fora.
    expect(conta.totalSeconds).toBe(7.5 * 3600);
    expect(conta.intervalos).toHaveLength(2);
  });

  it("saiu e ainda não voltou: o tempo aberto não é contado", () => {
    const conta = contarDia(dia(["entrada", "08:30"], ["saida_intervalo", "10:00"]));
    expect(conta.totalSeconds).toBe(1.5 * 3600);
    expect(conta.foraAgora).toBe(true);
    expect(conta.intervalos).toHaveLength(0);
  });

  it("dia em andamento (só entrada) ainda não soma nada", () => {
    expect(contarDia(dia(["entrada", "08:30"])).totalSeconds).toBe(0);
  });

  it("não quebra com batidas fora de ordem de chegada", () => {
    const conta = contarDia(
      dia(["saida", "17:30"], ["entrada", "08:30"], ["volta_almoco", "13:00"], ["saida_almoco", "12:00"]),
    );
    expect(conta.totalSeconds).toBe(8 * 3600);
  });
});

describe("dias do mês", () => {
  it("setembro tem 30 dias, todos em sequência", () => {
    const dias = diasDoMes("2026-09");
    expect(dias).toHaveLength(30);
    expect(dias[0]).toBe("2026-09-01");
    expect(dias.at(-1)).toBe("2026-09-30");
  });

  it("fevereiro bissexto tem 29", () => {
    expect(diasDoMes("2028-02")).toHaveLength(29);
  });

  it("mês inválido não gera lista", () => {
    expect(diasDoMes("2026-9")).toEqual([]);
  });
});
