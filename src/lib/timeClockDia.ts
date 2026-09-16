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
