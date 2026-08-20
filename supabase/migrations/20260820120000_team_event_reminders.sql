-- ============================================================================
-- Lembretes automáticos de eventos da equipe (1 dia, 1 hora e 30 min antes)
-- ----------------------------------------------------------------------------
-- Regras:
--   • Notifica APENAS os participantes CONFIRMADos (response = 'accepted') —
--     ou seja, quem foi marcado no evento. A notificação carrega user_id, e o
--     sininho já filtra por user_id, então o som toca só para essas pessoas.
--   • Cada participante recebe no máximo 1 lembrete de cada tipo por evento
--     (tabela de dedup team_event_reminders_sent).
--   • Um robô (pg_cron) roda a cada 5 min e dispara os lembretes que "venceram".
-- Idempotente: pode rodar mais de uma vez.
-- ============================================================================

-- 1) Dedup: (evento, pessoa, tipo) só notifica uma vez ------------------------
create table if not exists public.team_event_reminders_sent (
  event_id   uuid not null references public.team_events(id) on delete cascade,
  user_id    uuid not null,
  kind       text not null,               -- '1d' | '1h' | '30m'
  sent_at    timestamptz not null default now(),
  primary key (event_id, user_id, kind)
);
alter table public.team_event_reminders_sent enable row level security;
-- Sem policies: só a função SECURITY DEFINER (abaixo) escreve nela.

-- 2) Função que cria os lembretes devidos ------------------------------------
create or replace function public.notify_team_event_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with kinds as (
    select * from (values
      ('1d',  interval '1 day',      'amanhã'),
      ('1h',  interval '1 hour',     'em 1 hora'),
      ('30m', interval '30 minutes', 'em 30 minutos')
    ) as k(kind, off, label)
  ),
  -- Eventos futuros cujo início entra na faixa [now()+off-6min, now()+off].
  -- Janela de 6 min > cadência de 5 min do cron garante que cada marco é
  -- pego ao menos uma vez; a dedup evita repetir.
  due as (
    select e.id as event_id, e.organization_id, e.title, e.starts_at,
           a.user_id, k.kind, k.label
    from public.team_events e
    join public.team_event_attendees a
      on a.event_id = e.id and a.response = 'accepted'
    join kinds k on true
    where e.starts_at >  now()
      and e.starts_at <= now() + k.off
      and e.starts_at >  now() + k.off - interval '6 minutes'
  ),
  ins as (
    insert into public.team_event_reminders_sent (event_id, user_id, kind)
    select event_id, user_id, kind from due
    on conflict do nothing
    returning event_id, user_id, kind
  )
  insert into public.notifications (organization_id, user_id, type, title, body, read)
  select d.organization_id, d.user_id, 'team_event_reminder',
         '⏰ ' || d.title,
         'Começa ' || d.label || ' · '
           || to_char(d.starts_at at time zone 'America/Sao_Paulo', 'DD/MM às HH24:MI'),
         false
  from ins i
  join due d
    on d.event_id = i.event_id and d.user_id = i.user_id and d.kind = i.kind;
end;
$$;

-- 3) Agenda o robô a cada 5 minutos (recria se já existir) --------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'team_event_reminders') then
    perform cron.unschedule('team_event_reminders');
  end if;
  perform cron.schedule(
    'team_event_reminders',
    '*/5 * * * *',
    $cron$select public.notify_team_event_reminders();$cron$
  );
end $$;
