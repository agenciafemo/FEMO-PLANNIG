export interface ScriptLaudaSource {
  id: string;
  title: string | null;
  spoken_text: string | null;
  references_notes: string | null;
  editing_instructions: string | null;
  position: number | null;
  /** Lauda em blocos. Ausente/vazio = roteiro em texto corrido. */
  scenes?: unknown;
}

export function orderScriptsForLauda<T extends ScriptLaudaSource>(
  scripts: readonly T[],
): T[] {
  return scripts
    .map((script, index) => ({ script, index }))
    .sort((a, b) => {
      const positionA = a.script.position ?? Number.MAX_SAFE_INTEGER;
      const positionB = b.script.position ?? Number.MAX_SAFE_INTEGER;
      return positionA - positionB || a.index - b.index;
    })
    .map(({ script }) => script);
}

export function buildTeleprompterText(
  scripts: readonly ScriptLaudaSource[],
): string {
  return orderScriptsForLauda(scripts)
    .map((script) => script.spoken_text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

export async function copyScriptSpokenText(
  scripts: readonly ScriptLaudaSource[],
): Promise<void> {
  const text = buildTeleprompterText(scripts);
  if (!text) throw new Error("spoken_text_empty");
  if (!navigator.clipboard?.writeText) {
    throw new Error("clipboard_unavailable");
  }
  await navigator.clipboard.writeText(text);
}
