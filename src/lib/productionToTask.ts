import { supabase } from "@/integrations/supabase/client";
import { PIECE_LABEL } from "@/lib/productionPipeline";

// A tabela production_items ganhou task_id numa migration nova, e o types.ts
// gerado ainda não a conhece — mesmo padrão de cast já usado em Producao.tsx.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/** Etapa da peça, como ela vem do quadro de produção. */
export interface EtapaDaPeca {
  label: string;
  position: number;
  done: boolean;
}

export interface EnviarParaKanbanInput {
  itemId: string;
  organizationId: string;
  clientId: string | null;
  /** Vira o título da tarefa-mãe. Ex.: "Reels 1". */
  titulo: string;
  etapas: EtapaDaPeca[];
  assigneeId: string;
  dueDate: string;
  createdBy: string;
}

/**
 * Nome que a peça leva para o Kanban.
 *
 * Vivia dentro de Producao.tsx. Subiu para cá quando a tela de Tarefas passou a
 * puxar peças também: duas telas montando o mesmo título por conta própria é
 * como se chega em "Reel 1" num lugar e "Reels 1" no outro.
 */
export function tituloDaPeca(peca: {
  title: string | null;
  content_type: string;
  piece_number: number;
}): string {
  return peca.title?.trim()
    ? peca.title.trim()
    : `${PIECE_LABEL[peca.content_type] ?? peca.content_type} ${peca.piece_number}`;
}

/** A peça já foi enviada antes — a tela deve levar à tarefa em vez de criar outra. */
export class PecaJaNoKanbanError extends Error {
  constructor(public readonly taskId: string) {
    super("Esta peça já está no Kanban.");
    this.name = "PecaJaNoKanbanError";
  }
}

/**
 * Manda uma peça do quadro de Produção para o Kanban: cria a tarefa-mãe e uma
 * subtarefa por etapa da peça (roteiro, captação, edição, aprovação...).
 *
 * As duas listas continuam existindo em paralelo por desenho: o quadro de
 * produção é da equipe que executa, o Kanban é de quem acompanha. O vínculo
 * `task_id` serve para não criar tarefa repetida, não para sincronizar as duas.
 */
export async function enviarPecaParaKanban(
  input: EnviarParaKanbanInput,
): Promise<string> {
  const db = supabase as AnyClient;

  // Relê do banco em vez de confiar na tela: entre carregar o quadro e clicar,
  // outra pessoa pode ter enviado a mesma peça.
  const atual = await db
    .from("production_items")
    .select("task_id")
    .eq("id", input.itemId)
    .maybeSingle();
  if (atual.error) throw new Error(atual.error.message);
  if (atual.data?.task_id) throw new PecaJaNoKanbanError(atual.data.task_id);

  const { data: task, error: taskError } = await db
    .from("tasks")
    .insert({
      organization_id: input.organizationId,
      client_id: input.clientId,
      title: input.titulo,
      status: "todo",
      priority: "medium",
      assignee_id: input.assigneeId,
      due_date: input.dueDate,
      tags: ["producao"],
      created_by: input.createdBy,
    })
    .select("id")
    .maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task?.id) throw new Error("Não foi possível criar a tarefa.");

  // Cada etapa vira uma subtarefa, preservando a ordem e o que já foi feito —
  // uma peça enviada no meio do caminho chega ao Kanban com o avanço real.
  const subtarefas = [...input.etapas]
    .sort((a, b) => a.position - b.position)
    .map((etapa, index) => ({
      task_id: task.id,
      title: etapa.label,
      done: etapa.done,
      position: index,
    }));

  if (subtarefas.length > 0) {
    const { error: subError } = await db.from("task_subtasks").insert(subtarefas);
    // A tarefa sem as subtarefas seria pior que nada: some o motivo de existir,
    // e a peça ficaria marcada como enviada. Desfaz e deixa tentar de novo.
    if (subError) {
      await db.from("tasks").delete().eq("id", task.id);
      throw new Error(subError.message);
    }
  }

  // Só agora marca a peça. Se este UPDATE falhar, a tarefa existe e a peça
  // continua "não enviada" — o pior caso é uma tarefa duplicada num próximo
  // clique, não conteúdo perdido.
  //
  // O .select() não é decoração: UPDATE barrado por RLS devolve zero linhas
  // SEM erro neste projeto, e isso já causou perda silenciosa antes.
  const { data: marcada, error: linkError } = await db
    .from("production_items")
    .update({ task_id: task.id })
    .eq("id", input.itemId)
    .select("id");
  if (linkError) throw new Error(linkError.message);
  if (!marcada || marcada.length === 0) {
    throw new Error(
      "A tarefa foi criada, mas não consegui marcar a peça como enviada. " +
        "Confira suas permissões antes de enviar de novo.",
    );
  }

  return task.id as string;
}
