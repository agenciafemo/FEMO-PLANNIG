import { supabase } from "@/integrations/supabase/client";

// A tabela é nova e o types.ts gerado ainda não a conhece — mesmo padrão de
// cast já usado em src/lib/meetings.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type Voto = 1 | -1;

export interface FeedbackDaAta {
  id: string;
  user_id: string;
  rating: Voto;
  note: string | null;
  created_at: string;
}

export async function listarFeedback(meetingId: string): Promise<FeedbackDaAta[]> {
  const { data, error } = await (supabase as AnyClient)
    .from("meeting_summary_feedback")
    .select("id, user_id, rating, note, created_at")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as FeedbackDaAta[];
}

export async function registrarFeedback(input: {
  meetingId: string;
  organizationId: string;
  userId: string;
  rating: Voto;
  note: string | null;
  /** O texto que estava na tela. Sem ele, o voto diz que alguém reprovou, não
   *  o quê — e é justamente isso que alimenta as próximas gerações. */
  summarySnapshot: string | null;
}): Promise<void> {
  const { data, error } = await (supabase as AnyClient)
    .from("meeting_summary_feedback")
    .insert({
      meeting_id: input.meetingId,
      organization_id: input.organizationId,
      user_id: input.userId,
      rating: input.rating,
      note: input.note?.trim() || null,
      summary_snapshot: input.summarySnapshot,
    })
    .select("id");
  if (error) throw new Error(error.message);
  // Zero linhas com sucesso = RLS barrou. Neste projeto isso não vem como
  // erro, e já produziu toast de sucesso sobre gravação que não aconteceu.
  if (!data || data.length === 0) {
    throw new Error("Não foi possível registrar sua avaliação.");
  }
}

export async function removerFeedback(id: string): Promise<void> {
  const { data, error } = await (supabase as AnyClient)
    .from("meeting_summary_feedback")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("Não foi possível remover sua avaliação.");
  }
}

interface AtaParaCopiar {
  title: string;
  occurred_at: string;
  summary: string | null;
  decisions: string[];
  actionItems: string[];
}

/**
 * A ata em texto simples, pronta para colar no WhatsApp ou no e-mail.
 *
 * Texto puro, não Markdown: o destino mais comum é o WhatsApp, onde `##` e `-`
 * aparecem crus e sujam a mensagem. Traço e quebra de linha funcionam em
 * qualquer lugar.
 */
export function formatarAtaParaCopiar(ata: AtaParaCopiar): string {
  const partes: string[] = [];
  const data = new Date(ata.occurred_at).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  partes.push(ata.title, data, "");

  if (ata.summary?.trim()) {
    partes.push("RESUMO", ata.summary.trim(), "");
  }
  if (ata.decisions.length > 0) {
    partes.push("DECISÕES");
    for (const d of ata.decisions) partes.push(`— ${d}`);
    partes.push("");
  }
  if (ata.actionItems.length > 0) {
    partes.push("ITENS DE AÇÃO");
    for (const item of ata.actionItems) partes.push(`— ${item}`);
    partes.push("");
  }

  return partes.join("\n").trimEnd();
}

/**
 * Copia para a área de transferência.
 *
 * O `navigator.clipboard` só existe em contexto seguro e pode ser negado pelo
 * navegador; sem o fallback, o botão falharia em silêncio em alguns celulares.
 */
export async function copiarTexto(texto: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const deuCerto = document.execCommand("copy");
    document.body.removeChild(area);
    if (!deuCerto) throw new Error("O navegador bloqueou a cópia.");
  }
}
