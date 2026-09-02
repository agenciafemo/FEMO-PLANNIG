export interface MeetingDetailedTopic {
  titulo: string;
  contexto: string;
  pontos_chave: string[];
  participantes_citados: string[];
}

export interface MeetingDetailedSummary {
  panorama: string;
  topicos: MeetingDetailedTopic[];
  divergencias: string[];
  questoes_em_aberto: string[];
  limitacoes: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
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

  return details as unknown as MeetingDetailedSummary;
}
