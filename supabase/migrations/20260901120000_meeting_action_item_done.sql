-- ============================================================================
-- Concluir item de ação da ata sem precisar criar tarefa
-- ----------------------------------------------------------------------------
-- Hoje o único jeito de "fechar" um item de ação é criando uma tarefa: a UI
-- olha `task_id` para decidir entre o círculo vazio e o check verde. Boa parte
-- dos itens de uma reunião, porém, se resolve na mesma hora ou em dois minutos
-- — abrir tarefa para isso só polui o quadro de Tarefas.
--
-- Estas colunas dão um estado de conclusão próprio ao item, independente de
-- tarefa. As duas formas convivem: um item pode virar tarefa E ser concluído.
--
-- Não precisa de policy nova: meeting_action_items_write já é FOR ALL para quem
-- pode editar conteúdo da organização.
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.meeting_action_items
  ADD COLUMN IF NOT EXISTS done BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS done_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.meeting_action_items.done IS
  'Item resolvido, com ou sem tarefa criada. Independente de task_id.';
COMMENT ON COLUMN public.meeting_action_items.done_by IS
  'Quem marcou como concluído. ON DELETE SET NULL: perder o usuário não pode '
  'apagar o registro de que o item foi resolvido.';

COMMIT;
