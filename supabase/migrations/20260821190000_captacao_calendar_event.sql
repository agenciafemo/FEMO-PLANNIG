-- ============================================================================
-- Captação → evento no Calendário da Equipe.
--
-- Ao marcar a data/hora da captação de um reel no quadro de produção, nasce
-- automaticamente um evento na agenda da equipe, com o responsável já
-- confirmado como participante. Mudou a data, o evento muda junto; apagou a
-- data, o evento some.
--
-- Assim ninguém precisa lançar a gravação em dois lugares — e a captação
-- entra nos lembretes de 1 dia / 1 hora / 30 minutos antes.
-- Idempotente.
-- ============================================================================

ALTER TABLE public.team_events
  ADD COLUMN IF NOT EXISTS production_step_id UUID
    REFERENCES public.production_item_steps(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS team_events_production_step_key
  ON public.team_events (production_step_id)
  WHERE production_step_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_captacao_to_calendar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item     public.production_items;
  v_cliente  TEXT;
  v_titulo   TEXT;
  v_event_id UUID;
  v_autor    UUID;
BEGIN
  IF NEW.step_key <> 'captacao' THEN
    RETURN NEW;
  END IF;

  -- Data apagada: o evento deixa de existir.
  IF NEW.scheduled_at IS NULL THEN
    DELETE FROM public.team_events WHERE production_step_id = NEW.id;
    RETURN NEW;
  END IF;

  SELECT * INTO v_item FROM public.production_items WHERE id = NEW.item_id;
  IF v_item.id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_cliente FROM public.clients WHERE id = v_item.client_id;

  v_titulo := '🎬 Captação'
              || COALESCE(' · ' || v_cliente, '')
              || COALESCE(' · ' || v_item.title, ' · Reel ' || v_item.piece_number::TEXT);

  v_autor := COALESCE(NEW.assignee_id, v_item.created_by);

  SELECT id INTO v_event_id FROM public.team_events WHERE production_step_id = NEW.id;

  IF v_event_id IS NULL THEN
    INSERT INTO public.team_events
      (organization_id, created_by, title, description, starts_at, ends_at, all_day, production_step_id)
    VALUES
      (v_item.organization_id, v_autor, v_titulo,
       'Gravação criada a partir do Quadro de Produção.',
       NEW.scheduled_at, NEW.scheduled_at + interval '1 hour', false, NEW.id)
    RETURNING id INTO v_event_id;
  ELSE
    UPDATE public.team_events
    SET title = v_titulo,
        starts_at = NEW.scheduled_at,
        ends_at = NEW.scheduled_at + interval '1 hour'
    WHERE id = v_event_id;
  END IF;

  -- Responsável pela captação entra confirmado.
  IF NEW.assignee_id IS NOT NULL THEN
    INSERT INTO public.team_event_attendees (event_id, organization_id, user_id, response)
    VALUES (v_event_id, v_item.organization_id, NEW.assignee_id, 'accepted')
    ON CONFLICT (event_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_captacao_calendar ON public.production_item_steps;
CREATE TRIGGER sync_captacao_calendar
  AFTER INSERT OR UPDATE OF scheduled_at, assignee_id ON public.production_item_steps
  FOR EACH ROW EXECUTE FUNCTION public.sync_captacao_to_calendar();

-- Cria os eventos das captações que já têm data marcada hoje.
UPDATE public.production_item_steps
SET scheduled_at = scheduled_at
WHERE step_key = 'captacao' AND scheduled_at IS NOT NULL;
