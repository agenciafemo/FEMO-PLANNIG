-- ============================================================================
-- LEMBRETES AUTOMÁTICOS DE EVENTOS DO CALENDÁRIO
--
-- Um robô diário (pg_cron) avisa a equipe, no sininho, dos eventos que estão
-- chegando: 1 dia antes ("é amanhã") e no dia ("é hoje"). Cada evento gera no
-- máximo uma notificação por offset por dia (dedup embutido).
--
-- Só banco: a notificação usa a tabela `notifications` que o sininho já lê.
-- Nenhuma edge function, nenhum deploy de frontend.
-- ============================================================================

BEGIN;

-- Função que insere as notificações dos eventos próximos. SECURITY DEFINER para
-- rodar no cron (dono da função) e inserir em notifications sem depender de RLS.
CREATE OR REPLACE FUNCTION public.notify_upcoming_calendar_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_title TEXT;
  v_body TEXT;
  v_when TEXT;
BEGIN
  FOR rec IN
    SELECT e.id,
           e.organization_id,
           e.title,
           e.event_date,
           c.name AS client_name,
           (e.event_date - CURRENT_DATE) AS days_ahead
    FROM public.calendar_events e
    LEFT JOIN public.clients c ON c.id = e.client_id
    WHERE e.event_date IN (CURRENT_DATE, CURRENT_DATE + 1)
  LOOP
    v_when := CASE WHEN rec.days_ahead = 0 THEN 'hoje' ELSE 'amanhã' END;
    v_title := '📅 ' || rec.title || ' é ' || v_when;
    v_body := to_char(rec.event_date, 'DD/MM/YYYY')
      || CASE WHEN rec.client_name IS NOT NULL THEN ' · ' || rec.client_name ELSE '' END;

    -- Não duplica a mesma notificação no mesmo dia.
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.organization_id = rec.organization_id
        AND n.type = 'calendar_event'
        AND n.title = v_title
        AND n.created_at::date = CURRENT_DATE
    ) THEN
      INSERT INTO public.notifications (organization_id, title, body, type, read)
      VALUES (rec.organization_id, v_title, v_body, 'calendar_event', false);
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.notify_upcoming_calendar_events() IS
  'Cria notificações no sininho para eventos do calendário de hoje e de amanhã (roda no pg_cron).';

COMMIT;

-- ---------------------------------------------------------------------------
-- AGENDAMENTO (pg_cron). Fora da transação acima de propósito.
-- Se o CREATE EXTENSION falhar por permissão, habilite "pg_cron" em
-- Database > Extensions no painel do Supabase e rode só os comandos abaixo.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Roda todo dia às 11:00 UTC = 08:00 no horário de Brasília.
-- cron.schedule pelo mesmo nome atualiza o job (não duplica).
SELECT cron.schedule(
  'notify-calendar-events',
  '0 11 * * *',
  $cron$ SELECT public.notify_upcoming_calendar_events(); $cron$
);
