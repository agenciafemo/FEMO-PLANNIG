-- ============================================================================
-- CALENDÁRIO DA EQUIPE (estilo Google)
--
-- Calendário próprio da equipe (separado dos clientes): eventos e reuniões com
-- participantes. Ao adicionar alguém, entra como "accepted" (aceite automático)
-- para as notificações funcionarem; a pessoa pode "sair" (response='declined').
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.team_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  description TEXT,
  location TEXT,
  meeting_link TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  all_day BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.team_events IS 'Eventos e reuniões do calendário da equipe.';

CREATE INDEX IF NOT EXISTS team_events_org_start_idx
  ON public.team_events (organization_id, starts_at);

DROP TRIGGER IF EXISTS update_team_events_updated_at ON public.team_events;
CREATE TRIGGER update_team_events_updated_at
BEFORE UPDATE ON public.team_events
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.team_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_events_select ON public.team_events;
CREATE POLICY team_events_select ON public.team_events FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

-- Qualquer membro editor pode criar/editar eventos da equipe.
DROP POLICY IF EXISTS team_events_write ON public.team_events;
CREATE POLICY team_events_write ON public.team_events FOR ALL TO authenticated
  USING (public.can_edit_org_content(organization_id, auth.uid()))
  WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- PARTICIPANTES (organization_id denormalizado para RLS simples)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_event_attendees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.team_events(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  response TEXT NOT NULL DEFAULT 'accepted'
    CHECK (response IN ('accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT team_event_attendees_unique UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS team_event_attendees_event_idx
  ON public.team_event_attendees (event_id);
CREATE INDEX IF NOT EXISTS team_event_attendees_user_idx
  ON public.team_event_attendees (organization_id, user_id);

ALTER TABLE public.team_event_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_event_attendees_select ON public.team_event_attendees;
CREATE POLICY team_event_attendees_select ON public.team_event_attendees FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

-- Adicionar participantes: editor da org (quem cria o evento) OU a própria pessoa.
DROP POLICY IF EXISTS team_event_attendees_insert ON public.team_event_attendees;
CREATE POLICY team_event_attendees_insert ON public.team_event_attendees FOR INSERT TO authenticated
  WITH CHECK (
    public.can_edit_org_content(organization_id, auth.uid())
    OR user_id = auth.uid()
  );

-- Mudar resposta (sair/aceitar): a própria pessoa OU um editor.
DROP POLICY IF EXISTS team_event_attendees_update ON public.team_event_attendees;
CREATE POLICY team_event_attendees_update ON public.team_event_attendees FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.can_edit_org_content(organization_id, auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.can_edit_org_content(organization_id, auth.uid()));

DROP POLICY IF EXISTS team_event_attendees_delete ON public.team_event_attendees;
CREATE POLICY team_event_attendees_delete ON public.team_event_attendees FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.can_edit_org_content(organization_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_event_attendees TO authenticated;

COMMIT;
