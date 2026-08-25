-- ============================================================================
-- MODULO DE REUNIOES — transcricao + ata por IA + itens de acao
--
-- Reutiliza o modelo multi-tenant existente:
--   - is_org_member: leitura para membros ativos da organizacao;
--   - can_edit_org_content: escrita para owner/admin/manager/editor.
-- meeting_action_items e meeting_participants nao tem organization_id
-- proprio: RLS herdada via EXISTS na tabela meetings (mesmo padrao de
-- task_subtasks -> tasks).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  team_event_id UUID REFERENCES public.team_events(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'bot')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'recording', 'transcribing', 'summarizing', 'ready', 'failed')),
  failure_reason TEXT,
  meeting_link TEXT,
  audio_storage_path TEXT,
  vexa_bot_id TEXT,
  transcript_raw JSONB,
  transcript_text TEXT,
  summary TEXT,
  decisions TEXT[] NOT NULL DEFAULT '{}',
  duration_seconds INTEGER,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meetings_org_idx ON public.meetings (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS meetings_client_idx ON public.meetings (organization_id, client_id);

DROP TRIGGER IF EXISTS meetings_set_updated_at ON public.meetings;
CREATE TRIGGER meetings_set_updated_at
  BEFORE UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.meeting_action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  suggested_assignee_id UUID REFERENCES auth.users(id),
  suggested_due_date DATE,
  source_timestamp_ms INTEGER,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meeting_action_items_meeting_idx ON public.meeting_action_items (meeting_id);

CREATE TABLE IF NOT EXISTS public.meeting_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meeting_participants_meeting_idx ON public.meeting_participants (meeting_id);

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meetings_select ON public.meetings;
CREATE POLICY meetings_select ON public.meetings FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS meetings_write ON public.meetings;
CREATE POLICY meetings_write ON public.meetings FOR ALL TO authenticated
  USING (public.can_edit_org_content(organization_id, auth.uid()))
  WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));

DROP POLICY IF EXISTS meeting_action_items_select ON public.meeting_action_items;
CREATE POLICY meeting_action_items_select ON public.meeting_action_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = meeting_action_items.meeting_id
      AND public.is_org_member(m.organization_id, auth.uid())
  ));

DROP POLICY IF EXISTS meeting_action_items_write ON public.meeting_action_items;
CREATE POLICY meeting_action_items_write ON public.meeting_action_items FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = meeting_action_items.meeting_id
      AND public.can_edit_org_content(m.organization_id, auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = meeting_action_items.meeting_id
      AND public.can_edit_org_content(m.organization_id, auth.uid())
  ));

DROP POLICY IF EXISTS meeting_participants_select ON public.meeting_participants;
CREATE POLICY meeting_participants_select ON public.meeting_participants FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = meeting_participants.meeting_id
      AND public.is_org_member(m.organization_id, auth.uid())
  ));

DROP POLICY IF EXISTS meeting_participants_write ON public.meeting_participants;
CREATE POLICY meeting_participants_write ON public.meeting_participants FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = meeting_participants.meeting_id
      AND public.can_edit_org_content(m.organization_id, auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = meeting_participants.meeting_id
      AND public.can_edit_org_content(m.organization_id, auth.uid())
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_action_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_participants TO authenticated;
REVOKE ALL ON public.meetings FROM anon;
REVOKE ALL ON public.meeting_action_items FROM anon;
REVOKE ALL ON public.meeting_participants FROM anon;

-- ---------------------------------------------------------------------------
-- STORAGE: bucket privado de gravacoes de reuniao.
-- Caminho esperado: {organization_id}/{meeting_id}/{arquivo}.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('meeting-recordings', 'meeting-recordings', false)
ON CONFLICT (id) DO NOTHING;

-- storage_first_segment_uuid (definida em 20260703120200_multitenant_rls.sql)
-- faz o mesmo cast protegido por EXCEPTION WHEN others THEN RETURN NULL — um
-- cast cru ((storage.foldername(name))[1])::uuid lançaria exceção (não NULL)
-- para qualquer objeto cujo primeiro segmento não seja um UUID válido,
-- derrubando a política inteira em vez de só negar acesso àquele objeto.
DROP POLICY IF EXISTS meeting_recordings_insert ON storage.objects;
CREATE POLICY meeting_recordings_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'meeting-recordings'
    AND public.can_edit_org_content(public.storage_first_segment_uuid(name))
  );

DROP POLICY IF EXISTS meeting_recordings_select ON storage.objects;
CREATE POLICY meeting_recordings_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'meeting-recordings'
    AND public.is_org_member(public.storage_first_segment_uuid(name))
  );

DROP POLICY IF EXISTS meeting_recordings_delete ON storage.objects;
CREATE POLICY meeting_recordings_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'meeting-recordings'
    AND public.can_edit_org_content(public.storage_first_segment_uuid(name))
  );

COMMIT;
