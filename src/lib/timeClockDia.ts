/**
 * Regras do dia de ponto que não dependem de tela nem de banco.
 *
 * Ficam aqui porque o par "saída no meio do dia / retorno" mudou a conta das
 * horas: o dia deixou de ser duas janelas fixas (manhã e tarde) e virou uma
 * sequência de entradas e saídas que pode se repetir. Errar isso é errar hora
 * de gente, então o cálculo é testado.
 */

export type PunchKind =
  | "entrada"
  | "saida_almoco"
  | "volta_almoco"
  | "saida"
  | "saida_intervalo"
  | "volta_intervalo";

/** Batidas que colocam a pessoa dentro da jornada. */
export const KINDS_DENTRO: PunchKind[] = ["entrada", "volta_almoco", "volta_intervalo"];
/** Batidas que tiram a pessoa da jornada. */
export const KINDS_FORA: PunchKind[] = ["saida_almoco", "saida_intervalo", "saida"];

export type EstadoDoDia = {
  /** O que a pessoa bate agora no botão principal. null = jornada encerrada. */
  proximo: PunchKind | null;
  /** Está fora (almoço, saída do meio do dia ou já encerrou). */
  fora: boolean;
  /** Pode registrar uma saída no meio do dia agora. */
  podeSairNoMeio: boolean;
  encerrado: boolean;
};

/**
 * Espelha prepare_time_clock_punch no servidor. Se as duas regras divergirem,
 * o botão oferece uma batida que o banco recusa — foi exatamente o que
 * aconteceu quando o ajuste pendente não entrava na sequência.
 */
export function estadoDoDia(kinds: PunchKind[]): EstadoDoDia {
  const ultima = kinds.at(-1);
  const almocoFeito = kinds.includes("saida_almoco");

  if (!ultima) {
    return { proximo: "entrada", fora: true, podeSairNoMeio: false, encerrado: false };
  }
  if (ultima === "saida_almoco") {
    return { proximo: "volta_almoco", fora: true, podeSairNoMeio: false, encerrado: false };
  }
  if (ultima === "saida_intervalo") {
    return { proximo: "volta_intervalo", fora: true, podeSairNoMeio: false, encerrado: false };
  }
  if (ultima === "saida") {
    return { proximo: null, fora: true, podeSairNoMeio: false, encerrado: true };
  }
  return {
    proximo: almocoFeito ? "saida" : "saida_almoco",
    fora: false,
    podeSairNoMeio: true,
    encerrado: false,
  };
}

export type BatidaSimples = { kind: PunchKind; punched_at: string };

export type ContaDoDia<T extends BatidaSimples> = {
  /** Segundos efetivamente trabalhados (o tempo fora não entra). */
  totalSeconds: number;
  /** Quantos pares entrou→saiu foram fechados. */
  pares: number;
  /** Saídas no meio do dia já encerradas. */
  intervalos: Array<{ saida: T; volta: T; seconds: number }>;
  /** Saiu no meio do dia e ainda não voltou. */
  foraAgora: boolean;
};

/**
 * Soma todo par "entrou → saiu", em qualquer quantidade.
 *
 * Antes eram duas janelas fixas (entrada→saída almoço, volta→saída): quem
 * saísse no meio do dia teria o tempo fora contado como trabalhado.
 */
export function contarDia<T extends BatidaSimples>(batidas: T[]): ContaDoDia<T> {
  const ordenadas = [...batidas].sort(
    (a, b) => new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime(),
  );

  let totalSeconds = 0;
  let pares = 0;
  let abertoEm: T | null = null;
  let saidaIntervalo: T | null = null;
  const intervalos: ContaDoDia<T>["intervalos"] = [];

  for (const batida of ordenadas) {
    if (KINDS_DENTRO.includes(batida.kind)) {
      if (batida.kind === "volta_intervalo" && saidaIntervalo) {
        const fora = Math.floor(
          (new Date(batida.punched_at).getTime() - new Date(saidaIntervalo.punched_at).getTime()) / 1000,
        );
        intervalos.push({ saida: saidaIntervalo, volta: batida, seconds: Math.max(0, fora) });
        saidaIntervalo = null;
      }
      abertoEm ??= batida;
      continue;
    }

    if (KINDS_FORA.includes(batida.kind)) {
      if (batida.kind === "saida_intervalo") saidaIntervalo = batida;
      if (!abertoEm) continue;
      const duracao = Math.floor(
        (new Date(batida.punched_at).getTime() - new Date(abertoEm.punched_at).getTime()) / 1000,
      );
      abertoEm = null;
      if (duracao < 0) continue;
      totalSeconds += duracao;
      pares += 1;
    }
  }

  return { totalSeconds, pares, intervalos, foraAgora: saidaIntervalo !== null };
}

/**
 * Minutos de tolerância antes de marcar atraso ou saída antecipada.
 *
 * Sem isso, bater 08:31 já acendia "Atraso na entrada" — ninguém trabalha com
 * o relógio no segundo, e o selo virava ruído que a equipe aprendia a ignorar.
 * A conta das horas não muda: a tolerância é só sobre marcar ou não o dia.
 */
export const TOLERANCIA_MINUTOS = 5;

/** Comparação por minuto cheio: 08:35:59 ainda é 08:35, e não é atraso. */
function emMinutos(segundoDoDia: number): number {
  return Math.floor(segundoDoDia / 60);
}

export function atrasou(
  segundoDoDia: number,
  referenciaSegundos: number,
  toleranciaMinutos = TOLERANCIA_MINUTOS,
): boolean {
  return emMinutos(segundoDoDia) > emMinutos(referenciaSegundos) + toleranciaMinutos;
}

export function saiuAntes(
  segundoDoDia: number,
  referenciaSegundos: number,
  toleranciaMinutos = TOLERANCIA_MINUTOS,
): boolean {
  return emMinutos(segundoDoDia) < emMinutos(referenciaSegundos) - toleranciaMinutos;
}

/**
 * Teto de tolerância no dia inteiro. Espelha o art. 58 §1º da CLT: variações
 * de até 5 minutos por batida são desconsideradas, limitadas a 10 minutos no
 * dia. Passou de 5 numa batida, aquela batida conta inteira.
 */
export const TOLERANCIA_DIA_MINUTOS = 10;

/**
 * Horário esperado de cada batida e para que lado o desvio prejudica quem
 * trabalha: chegar depois da entrada tira hora; sair antes do fim também.
 */
export const REFERENCIAS: Array<{
  kind: PunchKind;
  segundo: number;
  prejudica: "depois" | "antes";
}> = [
  { kind: "entrada", segundo: 8 * 3600 + 30 * 60, prejudica: "depois" },
  { kind: "saida_almoco", segundo: 12 * 3600, prejudica: "antes" },
  { kind: "volta_almoco", segundo: 13 * 3600, prejudica: "depois" },
  { kind: "saida", segundo: 17 * 3600 + 30 * 60, prejudica: "antes" },
];

/**
 * Quantos segundos o dia ganha de volta pela tolerância.
 *
 * Só perdoa o que tira hora de quem trabalha (chegar um pouco depois, sair um
 * pouco antes) — os minutinhos a mais continuam contando como extra, como já
 * contavam. Sem isto, tolerar o atraso só no selo era meia solução: a pessoa
 * não via "Atraso", mas perdia os minutos no banco de horas do mesmo jeito.
 */
export function toleranciaDoDia(
  segundoPorBatida: Partial<Record<PunchKind, number>>,
  toleranciaMinutos = TOLERANCIA_MINUTOS,
  tetoMinutos = TOLERANCIA_DIA_MINUTOS,
): number {
  const limite = toleranciaMinutos * 60;
  let perdoado = 0;

  for (const referencia of REFERENCIAS) {
    const segundo = segundoPorBatida[referencia.kind];
    if (segundo === undefined) continue;

    const desvio = referencia.prejudica === "depois"
      ? segundo - referencia.segundo
      : referencia.segundo - segundo;

    // Desvio a favor de quem trabalha não é perdoado: já vira hora extra.
    if (desvio <= 0) continue;
    // Passou da tolerância: conta inteiro, nada é perdoado nesta batida.
    if (desvio > limite) continue;
    perdoado += desvio;
  }

  return Math.min(perdoado, tetoMinutos * 60);
}

/**
 * Janela esperada de cada batida, em segundos do dia.
 *
 * É mais larga que o horário de referência de propósito: serve para dizer "isto
 * é uma batida normal do dia", não para cobrar pontualidade (quem cobra é a
 * tolerância). Uma batida fora da sua janela é o que manda a data para revisão
 * de ADM/Head.
 */
export const JANELAS: Partial<Record<PunchKind, { de: number; ate: number }>> = {
  entrada: { de: 6 * 3600, ate: 10 * 3600 },
  saida_almoco: { de: 11 * 3600, ate: 14 * 3600 + 30 * 60 },
  volta_almoco: { de: 11 * 3600 + 30 * 60, ate: 15 * 3600 },
  saida: { de: 17 * 3600, ate: 21 * 3600 },
};

/**
 * O que a batida significa, decidido pelo horário — não pela ordem.
 *
 * Com um botão só, bater às 09:00 para ir ao médico não pode virar "saída para
 * o almoço" só porque foi a primeira saída do dia. Quem está dentro e sai na
 * janela do almoço vai para o almoço; a partir das 17h encerra o dia; em
 * qualquer outro horário é saída no meio do dia, e o retorno é esperado.
 */
export function classificarBatida(
  estado: EstadoDoDia,
  segundoDoDia: number,
  almocoFeito: boolean,
): PunchKind {
  // Fora: o próximo passo já é único (entrada, volta do almoço ou retorno).
  if (estado.proximo && estado.proximo !== "saida_almoco" && estado.proximo !== "saida") {
    return estado.proximo;
  }

  const almoco = JANELAS.saida_almoco!;
  if (!almocoFeito && segundoDoDia >= almoco.de && segundoDoDia <= almoco.ate) {
    return "saida_almoco";
  }
  if (segundoDoDia >= JANELAS.saida!.de) return "saida";
  return "saida_intervalo";
}

/**
 * Primeira batida do dia depois da janela da entrada: o horário sozinho não
 * diz se a pessoa está chegando tarde ou se esqueceu a entrada e está saindo
 * para o almoço. Em 16/09 a saída das 12:00 virou entrada e estragou o dia
 * inteiro — então, a partir das 10h sem entrada, a tela pergunta.
 */
export function perguntarPelaEntrada(estado: EstadoDoDia, segundoDoDia: number): boolean {
  return estado.proximo === "entrada" && segundoDoDia > JANELAS.entrada!.ate;
}

/**
 * O que a batida de agora vira quando a pessoa diz que esqueceu a entrada.
 * A entrada informada vai como pedido de ajuste e já entra na sequência do
 * servidor, então a batida é classificada como se a pessoa estivesse dentro.
 */
export function batidaAposEntradaEsquecida(segundoDoDia: number): PunchKind {
  return classificarBatida(estadoDoDia(["entrada"]), segundoDoDia, false);
}

/**
 * Batidas que existem uma vez por dia. O ajuste aprovado de um desses tipos
 * CORRIGE o horário que já está lá; saída no meio do dia e retorno se repetem
 * e sempre acrescentam. Espelha prepare_time_clock_adjustment_request.
 */
export const KINDS_UMA_VEZ_POR_DIA: PunchKind[] = ["entrada", "saida_almoco", "volta_almoco", "saida"];

export function ajusteCorrigeBatida(kind: PunchKind): boolean {
  return KINDS_UMA_VEZ_POR_DIA.includes(kind);
}

/**
 * A batida foge da jornada? É isto que manda o dia para revisão.
 *
 * Sair no meio do dia e voltar sempre contam como fora da jornada: são a
 * exceção, e quem decide o que fazer com as horas é ADM/Head.
 */
export function foraDaJanela(kind: PunchKind, segundoDoDia: number): boolean {
  const janela = JANELAS[kind];
  if (!janela) return true;
  return segundoDoDia < janela.de || segundoDoDia > janela.ate;
}

/**
 * Ao pedir um horário "Outro", a pessoa não deve escolher entre "saída no meio
 * do dia" e "retorno" — ela só sabe que esteve fora. O sistema descobre pela
 * posição do horário na sequência do dia: se naquele instante ela estava
 * trabalhando, o que falta é a saída; se estava fora, é o retorno.
 */
export function direcaoNoHorario(
  batidasDoDia: Array<{ kind: PunchKind; segundo: number }>,
  segundoDoDia: number,
): "saida_intervalo" | "volta_intervalo" {
  const anteriores = batidasDoDia
    .filter((batida) => batida.segundo <= segundoDoDia)
    .sort((a, b) => a.segundo - b.segundo);

  const ultima = anteriores.at(-1);
  if (!ultima) return "volta_intervalo"; // antes da entrada do dia: estava fora
  return KINDS_DENTRO.includes(ultima.kind) ? "saida_intervalo" : "volta_intervalo";
}

/** Todas as datas de um mês "yyyy-MM", em ordem crescente. */
export function diasDoMes(monthKey: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return [];
  const [ano, mes] = monthKey.split("-").map(Number);
  // Dia 0 do mês seguinte = último dia deste mês.
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return Array.from(
    { length: ultimo },
    (_, indice) => `${monthKey}-${String(indice + 1).padStart(2, "0")}`,
  );
}
