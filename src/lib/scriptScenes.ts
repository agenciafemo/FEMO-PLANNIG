// ============================================================================
// Lauda em blocos (cenas): a fala de um trecho e o que a edição faz NAQUELE
// trecho, lado a lado. O alinhamento é estrutural — não depende de a pessoa
// manter dois textos corridos do mesmo tamanho.
//
// O tempo de cada cena é ESTIMADO pela contagem de palavras. Narração em
// português corre perto de 150 palavras por minuto, ou 2,5 palavras por
// segundo. Não há IA envolvida: é aritmética, roda offline e é previsível.
// ============================================================================

export type Scene = {
  id: string;
  speech: string;
  editing: string;
  /** Ajuste manual em segundos. `null` = usa a estimativa pela fala. */
  seconds: number | null;
};

/** Palavras por segundo numa narração falada em português. */
export const WORDS_PER_SECOND = 2.5;

export const newSceneId = () =>
  `sc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const emptyScene = (): Scene => ({
  id: newSceneId(),
  speech: "",
  editing: "",
  seconds: null,
});

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Quanto tempo essa fala deve levar, em segundos. */
export function estimateSeconds(speech: string): number {
  const words = countWords(speech);
  if (words === 0) return 0;
  return Math.max(1, Math.round(words / WORDS_PER_SECOND));
}

/** Duração da cena: o ajuste manual quando existe, senão a estimativa. */
export function sceneSeconds(scene: Scene): number {
  if (scene.seconds != null && scene.seconds > 0) return scene.seconds;
  return estimateSeconds(scene.speech);
}

export function totalSeconds(scenes: readonly Scene[]): number {
  return scenes.reduce((sum, scene) => sum + sceneSeconds(scene), 0);
}

/** 95 → "1:35". Sempre com dois dígitos nos segundos. */
export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/**
 * Lê a coluna `scenes` (jsonb) de forma tolerante: qualquer coisa fora do
 * formato esperado vira lista vazia, e o roteiro cai no modo texto corrido.
 */
export function parseScenes(value: unknown): Scene[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const seconds = item.seconds;
    return [{
      id: typeof item.id === "string" && item.id ? item.id : newSceneId(),
      speech: typeof item.speech === "string" ? item.speech : "",
      editing: typeof item.editing === "string" ? item.editing : "",
      seconds: typeof seconds === "number" && seconds > 0 ? Math.round(seconds) : null,
    }];
  });
}

/** O que vai para o banco. Cena totalmente vazia não é gravada. */
export function serializeScenes(scenes: readonly Scene[]): Scene[] | null {
  const kept = scenes.filter((s) => s.speech.trim() || s.editing.trim());
  return kept.length ? kept.map((s) => ({
    id: s.id,
    speech: s.speech.trim(),
    editing: s.editing.trim(),
    seconds: s.seconds,
  })) : null;
}

/**
 * Transforma um roteiro em texto corrido numa lista de cenas, quebrando por
 * parágrafo. É como um roteiro antigo vira lauda em blocos sem ninguém
 * recortar na mão — e sem IA: a quebra é onde a pessoa já deu enter.
 */
export function splitIntoScenes(spokenText: string): Scene[] {
  const blocks = spokenText
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) return [];
  return blocks.map((speech) => ({ ...emptyScene(), speech }));
}

/** Só as falas, na ordem — é o que vai para o teleprompter. */
export function scenesSpokenText(scenes: readonly Scene[]): string {
  return scenes.map((s) => s.speech.trim()).filter(Boolean).join("\n\n");
}
