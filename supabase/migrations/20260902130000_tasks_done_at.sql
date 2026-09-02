-- ============================================================================
-- QUANDO A TAREFA FOI CONCLUÍDA
--
-- A coluna "Concluído" acumula o mês inteiro e vira uma parede de cards. Para
-- mostrar só o que foi entregue recentemente é preciso saber QUANDO cada
-- tarefa foi concluída — e hoje não dá: `status = 'done'` é um estado sem
-- memória, e `updated_at` mente (editar o título de uma tarefa concluída em
-- setembro a faria parecer concluída hoje).
--
-- `done` duplica a informação de `status = 'done'` de propósito: é a fundação
-- da segunda metade do passo 4, quando as colunas deixam de ser estado e
-- passam a ser tipo de trabalho. A partir dali "concluída" não é mais um
-- lugar no quadro, e precisa de campo próprio.
--
-- O trigger mantém os dois em dia venha a escrita de onde vier — quadro,
-- diálogo de edição ou uma RPC futura. Regra na aplicação seria esquecida na
-- primeira tela nova.
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS done BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tasks.done IS
  'Tarefa entregue. Mantido em sincronia com status por trigger enquanto '
  '"Concluído" ainda for uma coluna do quadro.';
COMMENT ON COLUMN public.tasks.done_at IS
  'Quando foi concluída. NULL nas que nunca foram — e nas concluídas antes '
  'desta coluna existir, onde a data real é desconhecida.';

-- Retroativo: quem já está em "done" passa a ter done = true. `done_at` recebe
-- updated_at como melhor aproximação disponível; é impreciso, mas o campo
-- nasceria vazio para o histórico inteiro e nenhum recorte por período
-- funcionaria no primeiro mês.
UPDATE public.tasks
   SET done = true,
       done_at = COALESCE(done_at, updated_at)
 WHERE status = 'done'
   AND done = false;

CREATE OR REPLACE FUNCTION public.sync_task_done()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Entrou em 'done': marca e carimba a hora, sem sobrescrever um carimbo que
  -- já exista (reabrir e concluir de novo registra a conclusão mais recente,
  -- mas um UPDATE que não mexe no status não mexe na data).
  IF NEW.status = 'done' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'done') THEN
    NEW.done := true;
    NEW.done_at := COALESCE(NEW.done_at, now());
  -- Saiu de 'done': foi reaberta, então a data de conclusão deixa de valer.
  ELSIF NEW.status <> 'done' AND (TG_OP = 'INSERT' OR OLD.status = 'done') THEN
    NEW.done := false;
    NEW.done_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_sync_done ON public.tasks;
CREATE TRIGGER tasks_sync_done
  BEFORE INSERT OR UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_task_done();

-- O quadro pergunta "o que foi concluído nos últimos N dias" a cada abertura.
CREATE INDEX IF NOT EXISTS tasks_org_done_at_idx
  ON public.tasks (organization_id, done_at DESC)
  WHERE done = true;

COMMIT;
