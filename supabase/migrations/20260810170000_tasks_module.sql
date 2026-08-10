-- ============================================================================
-- MODULO DE TAREFAS
--
-- Migration preparada para revisao. Nao aplicar diretamente em producao.
-- Reutiliza o modelo multi-tenant existente:
--   - is_org_member: leitura para membros ativos;
--   - can_edit_org_content: escrita para owner/admin/manager/editor.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TASKS
-- ---------------------------------------------------------------------------
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'doing', 'review', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high')),
  assignee_id UUID NOT NULL REFERENCES auth.users(id),
  due_date DATE NOT NULL,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tasks IS
  'Tarefas operacionais da agencia, isoladas por organizacao e opcionalmente ligadas a um cliente.';
COMMENT ON COLUMN public.tasks.position IS
  'Ordem do card dentro da coluna de status no quadro.';

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE INDEX tasks_organization_status_position_idx
  ON public.tasks (organization_id, status, position);
CREATE INDEX tasks_organization_assignee_idx
  ON public.tasks (organization_id, assignee_id);
CREATE INDEX tasks_organization_client_idx
  ON public.tasks (organization_id, client_id)
  WHERE client_id IS NOT NULL;
CREATE INDEX tasks_organization_due_date_idx
  ON public.tasks (organization_id, due_date);

CREATE TRIGGER update_tasks_updated_at
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Impede que uma tarefa misture cliente/responsavel de outra organizacao.
-- organization_id e created_by sao imutaveis depois da criacao.
CREATE OR REPLACE FUNCTION public.validate_task_tenant_relations()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'A organizacao da tarefa nao pode ser alterada';
    END IF;

    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'O criador da tarefa nao pode ser alterado';
    END IF;
  END IF;

  IF NEW.client_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.client_id IS DISTINCT FROM OLD.client_id)
     AND NOT EXISTS (
       SELECT 1
       FROM public.clients c
       WHERE c.id = NEW.client_id
         AND c.organization_id = NEW.organization_id
     ) THEN
    RAISE EXCEPTION 'O cliente deve pertencer a mesma organizacao da tarefa';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = NEW.organization_id
        AND om.user_id = NEW.assignee_id
        AND om.status = 'active'
    ) THEN
      RAISE EXCEPTION 'O responsavel deve ser um membro ativo da organizacao';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_task_tenant_relations
BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.validate_task_tenant_relations();

-- Membros ativos enxergam o quadro completo da organizacao. O filtro
-- "minhas tarefas" e um filtro de interface, nao uma fronteira de seguranca.
CREATE POLICY "org_members_select_tasks"
ON public.tasks FOR SELECT TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "org_editors_insert_tasks"
ON public.tasks FOR INSERT TO authenticated
WITH CHECK (
  public.can_edit_org_content(organization_id)
  AND created_by = auth.uid()
);

CREATE POLICY "org_editors_update_tasks"
ON public.tasks FOR UPDATE TO authenticated
USING (public.can_edit_org_content(organization_id))
WITH CHECK (public.can_edit_org_content(organization_id));

CREATE POLICY "org_editors_delete_tasks"
ON public.tasks FOR DELETE TO authenticated
USING (public.can_edit_org_content(organization_id));

-- ---------------------------------------------------------------------------
-- TASK_SUBTASKS
-- organization_id e herdado de forma transitiva pela tarefa pai nas policies.
-- ---------------------------------------------------------------------------
CREATE TABLE public.task_subtasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  done BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0)
);

COMMENT ON TABLE public.task_subtasks IS
  'Subtarefas ordenadas; o isolamento multi-tenant e herdado da tarefa pai.';

ALTER TABLE public.task_subtasks ENABLE ROW LEVEL SECURITY;

CREATE INDEX task_subtasks_task_position_idx
  ON public.task_subtasks (task_id, position);

CREATE POLICY "org_members_select_task_subtasks"
ON public.task_subtasks FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_subtasks.task_id
      AND public.is_org_member(t.organization_id)
  )
);

CREATE POLICY "org_editors_insert_task_subtasks"
ON public.task_subtasks FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_subtasks.task_id
      AND public.can_edit_org_content(t.organization_id)
  )
);

CREATE POLICY "org_editors_update_task_subtasks"
ON public.task_subtasks FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_subtasks.task_id
      AND public.can_edit_org_content(t.organization_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_subtasks.task_id
      AND public.can_edit_org_content(t.organization_id)
  )
);

CREATE POLICY "org_editors_delete_task_subtasks"
ON public.task_subtasks FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_subtasks.task_id
      AND public.can_edit_org_content(t.organization_id)
  )
);

-- ---------------------------------------------------------------------------
-- TASK_TIME_ENTRIES
-- Um unico timer ativo por usuario em todo o sistema. O tempo final e calculado
-- no servidor; o frontend nunca define duration_seconds diretamente.
-- organization_id e herdado de forma transitiva pela tarefa pai nas policies.
-- ---------------------------------------------------------------------------
CREATE TABLE public.task_time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  CONSTRAINT task_time_entries_completion_consistency CHECK (
    (ended_at IS NULL AND duration_seconds IS NULL)
    OR (ended_at IS NOT NULL AND duration_seconds IS NOT NULL)
  ),
  CONSTRAINT task_time_entries_valid_range CHECK (
    ended_at IS NULL OR ended_at >= started_at
  )
);

COMMENT ON TABLE public.task_time_entries IS
  'Apontamentos de tempo por tarefa. Registros finalizados sao imutaveis; duration_seconds e calculado pelo banco.';

ALTER TABLE public.task_time_entries ENABLE ROW LEVEL SECURITY;

CREATE INDEX task_time_entries_task_started_idx
  ON public.task_time_entries (task_id, started_at DESC);
CREATE INDEX task_time_entries_user_started_idx
  ON public.task_time_entries (user_id, started_at DESC);
CREATE UNIQUE INDEX task_time_entries_one_running_per_user_idx
  ON public.task_time_entries (user_id)
  WHERE ended_at IS NULL;

CREATE OR REPLACE FUNCTION public.maintain_task_time_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Sempre usa o relogio do banco para impedir apontamento inflado pelo cliente.
    NEW.started_at := clock_timestamp();
    NEW.ended_at := NULL;
    NEW.duration_seconds := NULL;
    RETURN NEW;
  END IF;

  IF NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'Tarefa, usuario e inicio do apontamento nao podem ser alterados';
  END IF;

  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Um apontamento finalizado nao pode ser alterado';
  END IF;

  IF NEW.ended_at IS NULL THEN
    NEW.duration_seconds := NULL;
    RETURN NEW;
  END IF;

  NEW.ended_at := clock_timestamp();
  NEW.duration_seconds := GREATEST(
    0,
    floor(extract(epoch FROM (NEW.ended_at - OLD.started_at)))::INTEGER
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER maintain_task_time_entry
BEFORE INSERT OR UPDATE ON public.task_time_entries
FOR EACH ROW EXECUTE FUNCTION public.maintain_task_time_entry();

CREATE POLICY "org_members_select_task_time_entries"
ON public.task_time_entries FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_time_entries.task_id
      AND public.is_org_member(t.organization_id)
  )
);

CREATE POLICY "org_editors_insert_own_task_time_entries"
ON public.task_time_entries FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND ended_at IS NULL
  AND duration_seconds IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_time_entries.task_id
      AND public.can_edit_org_content(t.organization_id)
  )
);

CREATE POLICY "org_editors_stop_own_task_time_entries"
ON public.task_time_entries FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  AND ended_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_time_entries.task_id
      AND public.can_edit_org_content(t.organization_id)
  )
)
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = task_time_entries.task_id
      AND public.can_edit_org_content(t.organization_id)
  )
);

REVOKE ALL ON public.tasks FROM anon;
REVOKE ALL ON public.task_subtasks FROM anon;
REVOKE ALL ON public.task_time_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_subtasks TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.task_time_entries TO authenticated;

COMMIT;
