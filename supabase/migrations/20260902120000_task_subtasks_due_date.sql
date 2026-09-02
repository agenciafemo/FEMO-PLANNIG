-- ============================================================================
-- SUBTAREFAS COM DATA DE ENTREGA
--
-- Passo 3 do plano de Projetos e Tarefas. Hoje a subtarefa sabe QUEM entrega,
-- mas não QUANDO: o único prazo é o da tarefa-mãe. Numa peça com arte, legenda
-- e edição, cada etapa tem seu próprio vencimento, e o prazo da mãe é sempre o
-- da última — o que esconde o atraso das primeiras até ser tarde.
--
-- `done_at` guarda quando a subtarefa foi concluída. Sem isso não dá para
-- responder "o que a equipe entregou esta semana" — `done` é só um booleano
-- sem memória.
--
-- Aditivo e retrocompatível: colunas nullable, sem default que altere linha
-- existente. Nenhuma policy nova — as de task_subtasks já cobrem UPDATE, e o
-- responsável já pode atualizar a própria subtarefa.
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.task_subtasks
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;

COMMENT ON COLUMN public.task_subtasks.due_date IS
  'Prazo da etapa (opcional). NULL = segue o prazo da tarefa-mãe.';
COMMENT ON COLUMN public.task_subtasks.done_at IS
  'Quando foi concluída. Preenchido ao marcar, limpo ao desmarcar.';

-- Só as subtarefas com prazo entram no índice: a maioria não tem, e um índice
-- parcial evita carregar o que nunca será consultado por data.
CREATE INDEX IF NOT EXISTS task_subtasks_due_date_idx
  ON public.task_subtasks (due_date)
  WHERE due_date IS NOT NULL AND done = false;

-- Retroativo: subtarefa já concluída não tem quando. Deixar NULL seria mentir
-- por omissão nos relatórios futuros, então fica explícito que a data é
-- desconhecida — e não que ela foi concluída "em lugar nenhum".
COMMENT ON TABLE public.task_subtasks IS
  'Etapas de uma tarefa. done_at é NULL nas subtarefas concluídas antes desta '
  'coluna existir: ausência de data ali significa "desconhecido", não "hoje".';

COMMIT;
