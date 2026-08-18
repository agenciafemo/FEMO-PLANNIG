-- ============================================================================
-- ECOSSISTEMA PLANEJAMENTO -> TAREFAS
--
-- Liga uma tarefa ao planejamento que a originou. Quando o social mídia cria
-- um planejamento (X reels, Y posts, Z textos), o app cria 1 tarefa-mãe com as
-- peças como subtarefas. planning_id permite navegar e evita duplicar a tarefa.
--
-- ADITIVO: só adiciona uma coluna nullable + índice. Não altera RLS, dados,
-- nem o comportamento existente das tarefas.
-- ============================================================================

BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS planning_id UUID
    REFERENCES public.plannings(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tasks.planning_id IS
  'Planejamento que originou a tarefa (ecossistema Planejamento -> Tarefas). NULL para tarefas avulsas.';

-- Uma tarefa-mãe por planejamento: evita duplicar se a criação rodar de novo.
CREATE UNIQUE INDEX IF NOT EXISTS tasks_planning_id_unique_idx
  ON public.tasks (planning_id)
  WHERE planning_id IS NOT NULL;

COMMIT;
