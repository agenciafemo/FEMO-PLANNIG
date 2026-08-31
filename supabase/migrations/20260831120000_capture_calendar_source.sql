-- Calendário da Equipe como fonte oficial das captações.
-- Uma captação pertence a um cliente e a um planejamento e pode preencher
-- todos os Reels daquele planejamento em uma única operação.

BEGIN;

ALTER TABLE public.team_events
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'event',
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS planning_id UUID REFERENCES public.plannings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_default_capture BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.team_events
  DROP CONSTRAINT IF EXISTS team_events_event_type_check;
ALTER TABLE public.team_events
  ADD CONSTRAINT team_events_event_type_check
  CHECK (event_type IN ('event', 'meeting', 'capture'));

ALTER TABLE public.team_events
  DROP CONSTRAINT IF EXISTS team_events_capture_context_check;
ALTER TABLE public.team_events
  ADD CONSTRAINT team_events_capture_context_check
  CHECK (event_type <> 'capture' OR (client_id IS NOT NULL AND planning_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS team_events_capture_planning_idx
  ON public.team_events (organization_id, planning_id, starts_at)
  WHERE event_type = 'capture';

CREATE UNIQUE INDEX IF NOT EXISTS team_events_default_capture_planning_key
  ON public.team_events (organization_id, planning_id)
  WHERE event_type = 'capture' AND is_default_capture;

ALTER TABLE public.production_item_steps
  ADD COLUMN IF NOT EXISTS capture_event_id UUID REFERENCES public.team_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS schedule_source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE public.production_item_steps
  DROP CONSTRAINT IF EXISTS production_item_steps_schedule_source_check;
ALTER TABLE public.production_item_steps
  ADD CONSTRAINT production_item_steps_schedule_source_check
  CHECK (schedule_source IN ('calendar', 'manual'));

CREATE INDEX IF NOT EXISTS production_item_steps_capture_event_idx
  ON public.production_item_steps (capture_event_id)
  WHERE capture_event_id IS NOT NULL;

-- Cada post do planejamento representa exatamente uma peça no quadro. Este
-- índice também documenta no histórico a proteção já validada em produção.
CREATE UNIQUE INDEX IF NOT EXISTS production_items_post_id_unique
  ON public.production_items (post_id)
  WHERE post_id IS NOT NULL;

-- O gatilho antigo criava um evento para cada Reel. A partir daqui, a agenda
-- cria um evento de captura e este gatilho distribui a data nas etapas.
DROP TRIGGER IF EXISTS sync_captacao_calendar ON public.production_item_steps;

CREATE OR REPLACE FUNCTION public.sync_team_capture_to_production()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.event_type = 'capture' THEN
    -- Limpa os Reels que estavam vinculados ao contexto anterior. A etapa
    -- seguinte abaixo os reassocia ao novo cliente/planejamento.
    IF OLD.event_type IS DISTINCT FROM NEW.event_type
       OR OLD.planning_id IS DISTINCT FROM NEW.planning_id
       OR OLD.client_id IS DISTINCT FROM NEW.client_id THEN
      UPDATE public.production_item_steps
      SET scheduled_at = NULL, capture_event_id = NULL, schedule_source = 'manual'
      WHERE capture_event_id = OLD.id;
    END IF;
  END IF;

  IF NEW.event_type <> 'capture' THEN
    RETURN NEW;
  END IF;

  -- A checagem de organização evita associar acidentalmente dados de outro
  -- cliente/planejamento quando uma chamada direta ao Data API for feita.
  IF NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = NEW.client_id AND c.organization_id = NEW.organization_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.plannings p
    WHERE p.id = NEW.planning_id
      AND p.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'Cliente e planejamento da captação não pertencem à organização';
  END IF;

  UPDATE public.production_item_steps s
  SET scheduled_at = NEW.starts_at,
      capture_event_id = NEW.id,
      schedule_source = 'calendar'
  FROM public.production_items i
  WHERE s.item_id = i.id
    AND i.organization_id = NEW.organization_id
    AND i.client_id = NEW.client_id
    AND i.planning_id = NEW.planning_id
    AND i.content_type = 'reels'
    AND s.step_key = 'captacao'
    AND (s.scheduled_at IS DISTINCT FROM NEW.starts_at
      OR s.capture_event_id IS DISTINCT FROM NEW.id
      OR s.schedule_source IS DISTINCT FROM 'calendar');

  RETURN NEW;
END;
$$;

-- A limpeza precisa acontecer BEFORE DELETE. Se fosse AFTER DELETE, a ação
-- ON DELETE SET NULL da chave estrangeira poderia remover capture_event_id
-- antes de localizarmos as etapas, deixando uma data órfã no quadro.
CREATE OR REPLACE FUNCTION public.clear_deleted_team_capture_from_production()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.event_type = 'capture' THEN
    UPDATE public.production_item_steps s
    SET scheduled_at = NULL,
        capture_event_id = NULL,
        schedule_source = 'manual'
    WHERE s.step_key = 'captacao'
      AND s.capture_event_id = OLD.id;
  END IF;
  RETURN OLD;
END;
$$;

-- Se um Reel for criado depois da captação, ele também herda a sessão padrão
-- do planejamento. Isso mantém a integração funcionando sem uma ação manual.
CREATE OR REPLACE FUNCTION public.sync_new_captacao_step_from_calendar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.production_items;
  v_event public.team_events;
BEGIN
  IF NEW.step_key <> 'captacao' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_item FROM public.production_items WHERE id = NEW.item_id;
  IF v_item.id IS NULL OR v_item.client_id IS NULL OR v_item.planning_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_event
  FROM public.team_events
  WHERE organization_id = v_item.organization_id
    AND event_type = 'capture'
    AND client_id = v_item.client_id
    AND planning_id = v_item.planning_id
  ORDER BY is_default_capture DESC, starts_at DESC
  LIMIT 1;

  IF v_event.id IS NOT NULL THEN
    UPDATE public.production_item_steps
    SET scheduled_at = v_event.starts_at,
        capture_event_id = v_event.id,
        schedule_source = 'calendar'
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_team_capture_to_production ON public.team_events;
CREATE TRIGGER sync_team_capture_to_production
  AFTER INSERT OR UPDATE OF event_type, client_id, planning_id, starts_at
  ON public.team_events
  FOR EACH ROW EXECUTE FUNCTION public.sync_team_capture_to_production();

DROP TRIGGER IF EXISTS clear_deleted_team_capture_from_production ON public.team_events;
CREATE TRIGGER clear_deleted_team_capture_from_production
  BEFORE DELETE ON public.team_events
  FOR EACH ROW EXECUTE FUNCTION public.clear_deleted_team_capture_from_production();

DROP TRIGGER IF EXISTS sync_new_captacao_step_from_calendar ON public.production_item_steps;
CREATE TRIGGER sync_new_captacao_step_from_calendar
  AFTER INSERT OR UPDATE OF item_id, step_key ON public.production_item_steps
  FOR EACH ROW EXECUTE FUNCTION public.sync_new_captacao_step_from_calendar();

-- São funções internas de trigger, não endpoints RPC da Data API.
REVOKE ALL ON FUNCTION public.sync_team_capture_to_production() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_deleted_team_capture_from_production() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_new_captacao_step_from_calendar() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.team_events.event_type IS 'event, meeting ou capture';
COMMENT ON COLUMN public.team_events.planning_id IS 'Planejamento atendido por uma captação';
COMMENT ON COLUMN public.production_item_steps.capture_event_id IS 'Evento de captação que definiu scheduled_at';
COMMENT ON COLUMN public.production_item_steps.schedule_source IS 'calendar quando veio da Agenda da Equipe; manual para exceções';

COMMIT;
