-- ============================================================================
-- Liga a peca de producao a tarefa que ela virou no Kanban.
--
-- POR QUE:
-- O quadro de Producao e o Kanban de Tarefas sao dois mundos hoje. A peca tem
-- etapas em production_item_steps; a tarefa tem subtarefas em task_subtasks.
-- Nada ligava os dois, entao mandar a mesma peca para o Kanban duas vezes
-- criaria duas tarefas iguais — em silencio, sem ninguem perceber.
--
-- Guardar o vinculo resolve isso e ainda permite a tela dizer "ja esta no
-- Kanban" com um link, em vez de reoferecer o botao.
--
-- ON DELETE SET NULL: se a tarefa for apagada no Kanban, a peca continua viva
-- no quadro de producao e pode ser enviada de novo. Levar a peca junto seria
-- destrutivo e nao e o que se espera de apagar uma tarefa.
-- ============================================================================

BEGIN;

ALTER TABLE public.production_items
  ADD COLUMN IF NOT EXISTS task_id UUID
    REFERENCES public.tasks(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.production_items.task_id IS
  'Tarefa do Kanban gerada a partir desta peca. NULL = ainda nao foi enviada.';

-- Parcial: so as pecas ja enviadas entram no indice, que e a minoria.
CREATE INDEX IF NOT EXISTS production_items_task_idx
  ON public.production_items (task_id)
  WHERE task_id IS NOT NULL;

COMMIT;
