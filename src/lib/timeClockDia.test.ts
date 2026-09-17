import { describe, expect, it } from "vitest";
import {
  atrasou,
  classificarBatida,
  contarDia,
  diasDoMes,
  estadoDoDia,
  foraDaJanela,
  saiuAntes,
  toleranciaDoDia,
  type PunchKind,
} from "./timeClockDia";

const hora = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s;

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

describe("tolerância de 5 minutos", () => {
  const ENTRADA = hora(8, 30);

  it("no horário não é atraso", () => {
    expect(atrasou(hora(8, 30), ENTRADA)).toBe(false);
  });

  it("até 08:35 está dentro da tolerância", () => {
    expect(atrasou(hora(8, 31), ENTRADA)).toBe(false);
    expect(atrasou(hora(8, 35), ENTRADA)).toBe(false);
    // O segundo não conta: 08:35:59 ainda é 08:35.
    expect(atrasou(hora(8, 35, 59), ENTRADA)).toBe(false);
  });

  it("08:36 é atraso", () => {
    expect(atrasou(hora(8, 36), ENTRADA)).toBe(true);
  });

  it("chegar antes nunca é atraso", () => {
    expect(atrasou(hora(8, 10), ENTRADA)).toBe(false);
  });

  it("a mesma tolerância vale para sair antes", () => {
    const SAIDA = hora(17, 30);
    expect(saiuAntes(hora(17, 30), SAIDA)).toBe(false);
    expect(saiuAntes(hora(17, 25), SAIDA)).toBe(false);
    expect(saiuAntes(hora(17, 24), SAIDA)).toBe(true);
    expect(saiuAntes(hora(18, 0), SAIDA)).toBe(false);
  });
});

describe("tolerância nas horas", () => {
  const noPonto = {
    entrada: hora(8, 30),
    saida_almoco: hora(12, 0),
    volta_almoco: hora(13, 0),
    saida: hora(17, 30),
  };

  it("dia certinho não perdoa nada", () => {
    expect(toleranciaDoDia(noPonto)).toBe(0);
  });

  it("entrou 08:34: os 4 minutos voltam para o banco de horas", () => {
    expect(toleranciaDoDia({ ...noPonto, entrada: hora(8, 34) })).toBe(4 * 60);
  });

  it("entrou 08:36: passou da tolerância, os 6 minutos contam inteiros", () => {
    // É a regra da CLT: ultrapassado o limite, conta tudo — não só o excedente.
    expect(toleranciaDoDia({ ...noPonto, entrada: hora(8, 36) })).toBe(0);
  });

  it("sair antes também é perdoado até 5 minutos", () => {
    expect(toleranciaDoDia({ ...noPonto, saida: hora(17, 27) })).toBe(3 * 60);
  });

  it("chegar cedo não é perdoado: continua valendo como extra", () => {
    expect(toleranciaDoDia({ ...noPonto, entrada: hora(8, 20) })).toBe(0);
  });

  it("vários desvios pequenos somam, mas o dia tem teto de 10 minutos", () => {
    const perdoado = toleranciaDoDia({
      entrada: hora(8, 34),
      saida_almoco: hora(11, 56),
      volta_almoco: hora(13, 4),
      saida: hora(17, 26),
    });
    expect(perdoado).toBe(10 * 60);
  });

  it("dia sem batidas não perdoa nada", () => {
    expect(toleranciaDoDia({})).toBe(0);
  });
});

describe("um botão só: o horário diz o que é a batida", () => {
  const dentro = estadoDoDia(["entrada"]);
  const depoisDoAlmoco = estadoDoDia(["entrada", "saida_almoco", "volta_almoco"]);

  it("primeira batida do dia é entrada, a qualquer hora", () => {
    expect(classificarBatida(estadoDoDia([]), hora(7, 10), false)).toBe("entrada");
    expect(classificarBatida(estadoDoDia([]), hora(11, 0), false)).toBe("entrada");
  });

  it("sair 09:00 é saída no meio do dia, não almoço", () => {
    // O caso que motivou o botão único: às 08:47 a tela oferecia "saída para
    // o almoço" só porque era a próxima etapa da jornada.
    expect(classificarBatida(dentro, hora(9, 0), false)).toBe("saida_intervalo");
  });

  it("sair 12:00 é almoço", () => {
    expect(classificarBatida(dentro, hora(12, 0), false)).toBe("saida_almoco");
  });

  it("almoço só uma vez: a segunda saída na mesma janela é meio do dia", () => {
    expect(classificarBatida(depoisDoAlmoco, hora(14, 0), true)).toBe("saida_intervalo");
  });

  it("a partir das 17h encerra o dia", () => {
    expect(classificarBatida(depoisDoAlmoco, hora(17, 30), true)).toBe("saida");
    expect(classificarBatida(depoisDoAlmoco, hora(17, 0), true)).toBe("saida");
  });

  it("sair 16h não encerra o dia: espera o retorno", () => {
    expect(classificarBatida(depoisDoAlmoco, hora(16, 0), true)).toBe("saida_intervalo");
  });

  it("quem está fora só volta — o horário não muda isso", () => {
    expect(classificarBatida(estadoDoDia(["entrada", "saida_almoco"]), hora(13, 0), true))
      .toBe("volta_almoco");
    expect(classificarBatida(estadoDoDia(["entrada", "saida_intervalo"]), hora(9, 40), false))
      .toBe("volta_intervalo");
  });
});

describe("o que manda o dia para revisão", () => {
  it("jornada normal não vai para revisão", () => {
    expect(foraDaJanela("entrada", hora(8, 30))).toBe(false);
    expect(foraDaJanela("saida_almoco", hora(12, 0))).toBe(false);
    expect(foraDaJanela("volta_almoco", hora(13, 0))).toBe(false);
    expect(foraDaJanela("saida", hora(17, 30))).toBe(false);
  });

  it("atraso de minutos não é 'fora do horário'", () => {
    // Senão quase todo dia cairia na fila da ADM. Quem cobra minutos é a
    // tolerância, não a revisão.
    expect(foraDaJanela("entrada", hora(8, 36))).toBe(false);
    expect(foraDaJanela("saida", hora(17, 24))).toBe(false);
  });

  it("entrar 05:30 ou 10:30 vai para revisão", () => {
    expect(foraDaJanela("entrada", hora(5, 30))).toBe(true);
    expect(foraDaJanela("entrada", hora(10, 30))).toBe(true);
  });

  it("sair 22h vai para revisão", () => {
    expect(foraDaJanela("saida", hora(22, 0))).toBe(true);
  });

  it("saída no meio do dia sempre vai para revisão", () => {
    expect(foraDaJanela("saida_intervalo", hora(9, 0))).toBe(true);
    expect(foraDaJanela("volta_intervalo", hora(11, 0))).toBe(true);
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
