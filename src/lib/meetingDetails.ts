export interface MeetingDetailedTopic {
  titulo: string;
  contexto: string;
  pontos_chave: string[];
  participantes_citados: string[];
}

/** Pauta que pode nascer da reunião. `origem` cita o que foi dito que a
 *  motivou — é o que separa uma sugestão do cliente de uma sugestão genérica
 *  que serviria para qualquer um. */
export interface MeetingContentSuggestion {
  titulo: string;
  formato: string;
  angulo: string;
  origem: string;
}

export interface MeetingDetailedSummary {
  panorama: string;
  topicos: MeetingDetailedTopic[];
  divergencias: string[];
  questoes_em_aberto: string[];
  sugestoes_conteudo: MeetingContentSuggestion[];
  limitacoes: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSuggestion(value: unknown): value is MeetingContentSuggestion {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return typeof s.titulo === "string" && typeof s.formato === "string"
    && typeof s.angulo === "string" && typeof s.origem === "string";
}

function isTopic(value: unknown): value is MeetingDetailedTopic {
  if (!value || typeof value !== "object") return false;
  const topic = value as Record<string, unknown>;
  return typeof topic.titulo === "string"
    && typeof topic.contexto === "string"
    && isStringArray(topic.pontos_chave)
    && isStringArray(topic.participantes_citados);
}

/** Evita quebrar a página caso um registro antigo ou manual tenha JSON incompleto. */
export function parseMeetingDetailedSummary(value: unknown): MeetingDetailedSummary | null {
  if (!value || typeof value !== "object") return null;
  const details = value as Record<string, unknown>;
  if (
    typeof details.panorama !== "string"
    || !Array.isArray(details.topicos)
    || !details.topicos.every(isTopic)
    || !isStringArray(details.divergencias)
    || !isStringArray(details.questoes_em_aberto)
    || !isStringArray(details.limitacoes)
  ) return null;

  // Análises geradas antes das sugestões existirem não têm o campo. Tratar a
  // ausência como lista vazia mantém essas atas abrindo normalmente, em vez de
  // devolver null e sumir com a análise inteira da tela.
  const sugestoes = Array.isArray(details.sugestoes_conteudo)
    && details.sugestoes_conteudo.every(isSuggestion)
    ? details.sugestoes_conteudo
    : [];

  return {
    ...(details as unknown as MeetingDetailedSummary),
    sugestoes_conteudo: sugestoes as MeetingContentSuggestion[],
  };
}
