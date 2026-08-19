-- ============================================================================
-- SUBTAREFAS COM RESPONSÁVEL
--
-- Permite direcionar uma subtarefa a uma pessoa (ex.: "editar vídeo" -> Edu).
-- Aditivo: coluna nullable + índice + política para o responsável poder marcar
-- a própria subtarefa como concluída (mesmo sem ser editor da organização).
-- ============================================================================

BEGIN;

ALTER TABLE public.task_subtasks
  ADD COLUMN IF NOT EXISTS assignee_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.task_subtasks.assignee_id IS
  'Responsável pela subtarefa (opcional). NULL = segue o responsável da tarefa-mãe.';

CREATE INDEX IF NOT EXISTS task_subtasks_assignee_idx
  ON public.task_subtasks (assignee_id)
  WHERE assignee_id IS NOT NULL;

-- O responsável pode atualizar (marcar concluída) a própria subtarefa, mesmo
-- que não tenha permissão de edição geral. Soma-se às políticas existentes (OR).
DROP POLICY IF EXISTS "assignee_update_own_task_subtasks" ON public.task_subtasks;
CREATE POLICY "assignee_update_own_task_subtasks"
ON public.task_subtasks FOR UPDATE TO authenticated
USING (assignee_id = auth.uid())
WITH CHECK (assignee_id = auth.uid());

COMMIT;
