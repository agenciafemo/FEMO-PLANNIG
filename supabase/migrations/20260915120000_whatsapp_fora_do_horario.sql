-- ============================================================================
-- WHATSAPP FORA DO HORÁRIO → RESUMO → TAREFAS (fases 1 e 2)
--
-- Clientes mandam mensagem para o WhatsApp da agência de madrugada e no fim de
-- semana. O webhook (Edge Function whatsapp-webhook) grava cada mensagem; às
-- 8h30 dos dias úteis a Edge Function whatsapp-resumo resume por contato com
-- IA, cria as tarefas pela FUNÇÃO da equipe e avisa no sininho.
--
-- Decisões do Femo (15/09/2026):
--   * número DA AGÊNCIA (validação com o número de teste da Meta; o final é
--     +55 48 3198-0572, ligado quando o Norteia for Tech Provider aprovado);
--   * horário de atendimento seg–sex 8h30–17h30 (o mesmo da jornada do Ponto);
--   * toda a equipe vê mensagens e resumos;
--   * o TEXTO das mensagens é apagado em 30 dias (com contador na tela); o
--     resumo e as tarefas ficam.
--
-- Idempotente. Estudo completo: docs/estudo-whatsapp-e-permissoes.md.
-- Passo a passo de implantação: docs/whatsapp-setup.md.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.organization_members') IS NULL
     OR to_regclass('public.clients') IS NULL
     OR to_regclass('public.tasks') IS NULL
     OR to_regclass('public.notifications') IS NULL
     OR to_regclass('public.team_function_tags') IS NULL
     OR to_regclass('public.team_member_functions') IS NULL
     OR to_regprocedure('public.is_org_member(uuid,uuid)') IS NULL
     OR to_regprocedure('public.can_edit_org_content(uuid,uuid)') IS NULL
     OR to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'WhatsApp dependencies are missing';
  END IF;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- Conexão: qual número (phone_number_id da Meta) pertence a qual agência.
-- Na fase de validação é cadastrada à mão (ver docs/whatsapp-setup.md).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL UNIQUE,
  display_phone_number TEXT,
  is_test_number BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_connections_phone_number_id_valid CHECK (
    phone_number_id ~ '^[0-9]{5,30}$'
  ),
  CONSTRAINT whatsapp_connections_status_valid CHECK (
    status IN ('active', 'paused')
  )
);

DROP TRIGGER IF EXISTS update_whatsapp_connections_updated_at ON public.whatsapp_connections;
CREATE TRIGGER update_whatsapp_connections_updated_at
BEFORE UPDATE ON public.whatsapp_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Horário de atendimento. Sem linha = padrão seg–sex 8h30–17h30, Brasília.
-- weekdays usa ISO: 1 = segunda ... 7 = domingo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_business_hours (
  organization_id UUID PRIMARY KEY
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  time_zone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  weekdays SMALLINT[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5]::SMALLINT[],
  opens_at TIME NOT NULL DEFAULT '08:30',
  closes_at TIME NOT NULL DEFAULT '17:30',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_business_hours_order CHECK (opens_at < closes_at),
  CONSTRAINT whatsapp_business_hours_weekdays_valid CHECK (
    weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[]
  )
);

CREATE OR REPLACE FUNCTION public.whatsapp_fora_do_horario(
  _organization_id UUID,
  _momento TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH horario AS (
    SELECT
      COALESCE(bh.time_zone, 'America/Sao_Paulo') AS tz,
      COALESCE(bh.weekdays, ARRAY[1, 2, 3, 4, 5]::SMALLINT[]) AS dias,
      COALESCE(bh.opens_at, '08:30'::TIME) AS abre,
      COALESCE(bh.closes_at, '17:30'::TIME) AS fecha
    FROM (SELECT 1) AS singleton
    LEFT JOIN public.whatsapp_business_hours AS bh
      ON bh.organization_id = _organization_id
  )
  SELECT NOT (
    EXTRACT(ISODOW FROM (_momento AT TIME ZONE horario.tz))::SMALLINT = ANY (horario.dias)
    AND (_momento AT TIME ZONE horario.tz)::TIME >= horario.abre
    AND (_momento AT TIME ZONE horario.tz)::TIME < horario.fecha
  )
  FROM horario
$fn$;

-- ---------------------------------------------------------------------------
-- Contatos: número do WhatsApp → cliente do Norteia (vinculado na tela).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  wa_id TEXT NOT NULL,
  profile_name TEXT,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_contacts_wa_id_valid CHECK (wa_id ~ '^[0-9]{6,20}$'),
  CONSTRAINT whatsapp_contacts_org_wa_id_key UNIQUE (organization_id, wa_id)
);

DROP TRIGGER IF EXISTS update_whatsapp_contacts_updated_at ON public.whatsapp_contacts;
CREATE TRIGGER update_whatsapp_contacts_updated_at
BEFORE UPDATE ON public.whatsapp_contacts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.validate_whatsapp_contact_client()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  -- OLD só existe em UPDATE: checar TG_OP antes de ler OLD.
  IF TG_OP = 'UPDATE' AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.wa_id IS DISTINCT FROM OLD.wa_id
  ) THEN
    RAISE EXCEPTION 'O número e a agência do contato não podem ser alterados';
  END IF;
  IF NEW.client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients AS cliente
    WHERE cliente.id = NEW.client_id
      AND cliente.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'O cliente deve pertencer à mesma agência do contato';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS validate_whatsapp_contact_client ON public.whatsapp_contacts;
CREATE TRIGGER validate_whatsapp_contact_client
BEFORE INSERT OR UPDATE ON public.whatsapp_contacts
FOR EACH ROW EXECUTE FUNCTION public.validate_whatsapp_contact_client();

-- ---------------------------------------------------------------------------
-- Resumos: ficam depois que o texto das mensagens é apagado.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.whatsapp_contacts(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  -- Nome/número no momento do resumo: continua legível se o contato sumir.
  contact_label TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  message_count INTEGER NOT NULL CHECK (message_count > 0),
  summary TEXT NOT NULL CHECK (btrim(summary) <> ''),
  urgency TEXT NOT NULL CHECK (urgency IN ('baixa', 'media', 'alta')),
  task_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_summaries_org_created_idx
  ON public.whatsapp_summaries (organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Mensagens. wamid UNIQUE = a Meta pode reenviar o webhook sem duplicar nada.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.whatsapp_connections(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.whatsapp_contacts(id) ON DELETE CASCADE,
  wamid TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('recebida', 'enviada')),
  message_type TEXT NOT NULL,
  body TEXT,
  sent_at TIMESTAMPTZ NOT NULL,
  fora_do_horario BOOLEAN NOT NULL,
  summary_id UUID REFERENCES public.whatsapp_summaries(id) ON DELETE SET NULL,
  -- LGPD: o texto some em 30 dias; a tela mostra quantos dias faltam.
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_pendentes_idx
  ON public.whatsapp_messages (organization_id, contact_id, sent_at)
  WHERE summary_id IS NULL AND fora_do_horario;
CREATE INDEX IF NOT EXISTS whatsapp_messages_org_sent_idx
  ON public.whatsapp_messages (organization_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_expires_idx
  ON public.whatsapp_messages (expires_at);

-- ---------------------------------------------------------------------------
-- RLS: toda a equipe da agência lê; vincular contato a cliente exige edição.
-- ---------------------------------------------------------------------------
ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_business_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_connections_member_select ON public.whatsapp_connections;
CREATE POLICY whatsapp_connections_member_select ON public.whatsapp_connections
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS whatsapp_business_hours_member_select ON public.whatsapp_business_hours;
CREATE POLICY whatsapp_business_hours_member_select ON public.whatsapp_business_hours
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS whatsapp_contacts_member_select ON public.whatsapp_contacts;
CREATE POLICY whatsapp_contacts_member_select ON public.whatsapp_contacts
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS whatsapp_contacts_editor_update ON public.whatsapp_contacts;
CREATE POLICY whatsapp_contacts_editor_update ON public.whatsapp_contacts
  FOR UPDATE TO authenticated
  USING (public.can_edit_org_content(organization_id, auth.uid()))
  WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));

DROP POLICY IF EXISTS whatsapp_summaries_member_select ON public.whatsapp_summaries;
CREATE POLICY whatsapp_summaries_member_select ON public.whatsapp_summaries
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS whatsapp_messages_member_select ON public.whatsapp_messages;
CREATE POLICY whatsapp_messages_member_select ON public.whatsapp_messages
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- Gravação de uma mensagem vinda do webhook (só service_role).
-- Devolve 'inserida' | 'duplicada' | 'sem_conexao'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_server_ingest(
  _phone_number_id TEXT,
  _wamid TEXT,
  _wa_id TEXT,
  _profile_name TEXT,
  _direction TEXT,
  _message_type TEXT,
  _body TEXT,
  _sent_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_connection public.whatsapp_connections%ROWTYPE;
  v_contact_id UUID;
  v_message_id UUID;
BEGIN
  IF btrim(COALESCE(_wamid, '')) = ''
     OR COALESCE(_wa_id, '') !~ '^[0-9]{6,20}$'
     OR _direction NOT IN ('recebida', 'enviada')
     OR _sent_at IS NULL THEN
    RAISE EXCEPTION 'whatsapp_message_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_connection
  FROM public.whatsapp_connections AS conexao
  WHERE conexao.phone_number_id = _phone_number_id
    AND conexao.status = 'active';

  IF v_connection.id IS NULL THEN
    RETURN 'sem_conexao';
  END IF;

  INSERT INTO public.whatsapp_contacts AS contato (organization_id, wa_id, profile_name)
  VALUES (
    v_connection.organization_id,
    _wa_id,
    NULLIF(left(btrim(COALESCE(_profile_name, '')), 200), '')
  )
  ON CONFLICT (organization_id, wa_id) DO UPDATE SET
    profile_name = COALESCE(EXCLUDED.profile_name, contato.profile_name)
  RETURNING contato.id INTO v_contact_id;

  INSERT INTO public.whatsapp_messages (
    organization_id, connection_id, contact_id, wamid, direction,
    message_type, body, sent_at, fora_do_horario, expires_at
  ) VALUES (
    v_connection.organization_id,
    v_connection.id,
    v_contact_id,
    left(btrim(_wamid), 200),
    _direction,
    left(COALESCE(NULLIF(btrim(_message_type), ''), 'desconhecido'), 40),
    NULLIF(left(COALESCE(_body, ''), 8000), ''),
    _sent_at,
    public.whatsapp_fora_do_horario(v_connection.organization_id, _sent_at),
    _sent_at + interval '30 days'
  )
  ON CONFLICT (wamid) DO NOTHING
  RETURNING id INTO v_message_id;

  RETURN CASE WHEN v_message_id IS NULL THEN 'duplicada' ELSE 'inserida' END;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Resumo + tarefas + avisos + marcação das mensagens, numa transação só.
-- Se outra execução já resumiu estas mensagens, devolve NULL e não duplica.
-- _tasks: [{titulo, descricao, funcao, prioridade(baixa|media|alta)}]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_server_apply_summary(
  _organization_id UUID,
  _contact_id UUID,
  _message_ids UUID[],
  _summary TEXT,
  _urgency TEXT,
  _tasks JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_contact public.whatsapp_contacts%ROWTYPE;
  v_owner UUID;
  v_tz TEXT;
  v_hoje DATE;
  v_label TEXT;
  v_task JSONB;
  v_titulo TEXT;
  v_descricao TEXT;
  v_funcao TEXT;
  v_assignee UUID;
  v_prioridade TEXT;
  v_task_id UUID;
  v_task_ids UUID[] := ARRAY[]::UUID[];
  v_inicio TIMESTAMPTZ;
  v_fim TIMESTAMPTZ;
  v_total INTEGER;
  v_summary_id UUID;
BEGIN
  IF _urgency NOT IN ('baixa', 'media', 'alta')
     OR btrim(COALESCE(_summary, '')) = ''
     OR COALESCE(array_length(_message_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'whatsapp_summary_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_contact
  FROM public.whatsapp_contacts AS contato
  WHERE contato.id = _contact_id
    AND contato.organization_id = _organization_id;
  IF v_contact.id IS NULL THEN
    RAISE EXCEPTION 'whatsapp_contact_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Trava as mensagens: duas execuções ao mesmo tempo não criam tarefa dobrada.
  PERFORM 1 FROM public.whatsapp_messages AS mensagem
  WHERE mensagem.id = ANY (_message_ids)
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.whatsapp_messages AS mensagem
    WHERE mensagem.id = ANY (_message_ids)
      AND (
        mensagem.summary_id IS NOT NULL
        OR mensagem.organization_id <> _organization_id
        OR mensagem.contact_id <> _contact_id
      )
  ) THEN
    RETURN NULL;
  END IF;

  SELECT min(mensagem.sent_at), max(mensagem.sent_at), count(*)
  INTO v_inicio, v_fim, v_total
  FROM public.whatsapp_messages AS mensagem
  WHERE mensagem.id = ANY (_message_ids);
  IF COALESCE(v_total, 0) = 0 THEN
    RETURN NULL;
  END IF;

  -- Autor das tarefas: quem é dono (ou ADM) da agência — não há usuário humano
  -- nesta execução.
  SELECT membro.user_id INTO v_owner
  FROM public.organization_members AS membro
  WHERE membro.organization_id = _organization_id
    AND membro.status = 'active'
    AND membro.role IN ('owner', 'admin')
  ORDER BY (membro.role = 'owner') DESC, membro.user_id
  LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'whatsapp_owner_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(bh.time_zone, 'America/Sao_Paulo') INTO v_tz
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.whatsapp_business_hours AS bh
    ON bh.organization_id = _organization_id;
  v_hoje := (now() AT TIME ZONE v_tz)::DATE;
  v_label := COALESCE(NULLIF(btrim(v_contact.profile_name), ''), '+' || v_contact.wa_id);

  FOR v_task IN SELECT tarefa.value FROM jsonb_array_elements(COALESCE(_tasks, '[]'::JSONB)) AS tarefa LOOP
    v_titulo := left(btrim(COALESCE(v_task ->> 'titulo', '')), 200);
    CONTINUE WHEN v_titulo = '';
    v_descricao := btrim(COALESCE(v_task ->> 'descricao', ''));
    v_funcao := btrim(COALESCE(v_task ->> 'funcao', ''));

    -- Quem tem a função e menos tarefas abertas. Sem ninguém: dono/ADM.
    v_assignee := NULL;
    SELECT funcao_membro.user_id INTO v_assignee
    FROM public.team_member_functions AS funcao_membro
    JOIN public.team_function_tags AS tag
      ON tag.id = funcao_membro.tag_id
    JOIN public.organization_members AS membro
      ON membro.organization_id = funcao_membro.organization_id
     AND membro.user_id = funcao_membro.user_id
     AND membro.status = 'active'
    WHERE funcao_membro.organization_id = _organization_id
      AND tag.organization_id = _organization_id
      AND lower(btrim(tag.name)) = lower(v_funcao)
    ORDER BY (
      SELECT count(*) FROM public.tasks AS aberta
      WHERE aberta.organization_id = _organization_id
        AND aberta.assignee_id = funcao_membro.user_id
        AND aberta.status <> 'done'
    ), funcao_membro.user_id
    LIMIT 1;
    v_assignee := COALESCE(v_assignee, v_owner);

    v_prioridade := CASE v_task ->> 'prioridade'
      WHEN 'alta' THEN 'high'
      WHEN 'baixa' THEN 'low'
      ELSE 'medium'
    END;

    INSERT INTO public.tasks (
      organization_id, client_id, title, description, status, priority,
      assignee_id, due_date, tags, created_by
    ) VALUES (
      _organization_id,
      v_contact.client_id,
      v_titulo,
      left(
        CASE WHEN v_descricao = '' THEN '' ELSE v_descricao || E'\n\n' END
          || 'Origem: WhatsApp de ' || v_label || ', fora do horário.',
        4000
      ),
      'todo',
      v_prioridade,
      v_assignee,
      v_hoje,
      ARRAY['whatsapp']::TEXT[],
      v_owner
    )
    RETURNING id INTO v_task_id;
    v_task_ids := v_task_ids || v_task_id;

    INSERT INTO public.notifications (organization_id, user_id, type, title, body, read)
    VALUES (
      _organization_id,
      v_assignee,
      'whatsapp_tarefa',
      '💬 Tarefa do WhatsApp',
      left(v_label || ': ' || v_titulo, 500),
      false
    );
  END LOOP;

  INSERT INTO public.whatsapp_summaries (
    organization_id, contact_id, client_id, contact_label, period_start,
    period_end, message_count, summary, urgency, task_ids
  ) VALUES (
    _organization_id, v_contact.id, v_contact.client_id, v_label, v_inicio,
    v_fim, v_total, left(btrim(_summary), 2000), _urgency, v_task_ids
  )
  RETURNING id INTO v_summary_id;

  UPDATE public.whatsapp_messages AS mensagem
  SET summary_id = v_summary_id
  WHERE mensagem.id = ANY (_message_ids);

  RETURN v_summary_id;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- LGPD: apaga o texto vencido (30 dias). Resumos e tarefas ficam.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_purge_expired()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_apagadas INTEGER;
BEGIN
  DELETE FROM public.whatsapp_messages AS mensagem
  WHERE mensagem.expires_at <= now();
  GET DIAGNOSTICS v_apagadas = ROW_COUNT;
  RETURN v_apagadas;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Privilégios.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.whatsapp_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.whatsapp_business_hours FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.whatsapp_contacts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.whatsapp_summaries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.whatsapp_messages FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.whatsapp_connections TO service_role;
GRANT ALL ON TABLE public.whatsapp_business_hours TO service_role;
GRANT ALL ON TABLE public.whatsapp_contacts TO service_role;
GRANT ALL ON TABLE public.whatsapp_summaries TO service_role;
GRANT ALL ON TABLE public.whatsapp_messages TO service_role;

GRANT SELECT ON TABLE public.whatsapp_connections TO authenticated;
GRANT SELECT ON TABLE public.whatsapp_business_hours TO authenticated;
GRANT SELECT ON TABLE public.whatsapp_contacts TO authenticated;
GRANT UPDATE (client_id) ON TABLE public.whatsapp_contacts TO authenticated;
GRANT SELECT ON TABLE public.whatsapp_summaries TO authenticated;
GRANT SELECT ON TABLE public.whatsapp_messages TO authenticated;

REVOKE ALL ON FUNCTION public.whatsapp_fora_do_horario(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_fora_do_horario(UUID, TIMESTAMPTZ)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.whatsapp_server_ingest(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_server_ingest(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;

REVOKE ALL ON FUNCTION public.whatsapp_server_apply_summary(UUID, UUID, UUID[], TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_server_apply_summary(UUID, UUID, UUID[], TEXT, TEXT, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION public.whatsapp_purge_expired()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Agendamentos.
--   * 03:00 (Brasília) todo dia: apaga texto vencido;
--   * 08:30 (Brasília) seg–sex: chama whatsapp-resumo via pg_net. O endereço e
--     o segredo moram no Vault (whatsapp_resumo_url, whatsapp_internal_secret)
--     — criados à mão, ver docs/whatsapp-setup.md. Sem eles o job roda e só
--     registra erro no log do cron; nada quebra.
-- UTC: Brasília é UTC-3 o ano todo (sem horário de verão desde 2019).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule(job.jobid)
  FROM cron.job AS job
  WHERE job.jobname IN ('whatsapp_apagar_expiradas', 'whatsapp_resumo_diario');

  PERFORM cron.schedule(
    'whatsapp_apagar_expiradas',
    '0 6 * * *',
    $cron$select public.whatsapp_purge_expired();$cron$
  );

  PERFORM cron.schedule(
    'whatsapp_resumo_diario',
    '30 11 * * 1-5',
    $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_resumo_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Internal-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_internal_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
    $cron$
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Conferência (uma consulta só). Devem vir 14 linhas, TODAS com `ok = true`.
-- ---------------------------------------------------------------------------
SELECT item, ok
FROM (
  SELECT 'tabela ' || tabela AS item, to_regclass('public.' || tabela) IS NOT NULL AS ok
  FROM unnest(ARRAY[
    'whatsapp_connections', 'whatsapp_business_hours', 'whatsapp_contacts',
    'whatsapp_summaries', 'whatsapp_messages'
  ]) AS tabela
  UNION ALL
  SELECT 'service_role grava mensagem',
    has_function_privilege('service_role', 'public.whatsapp_server_ingest(text,text,text,text,text,text,text,timestamptz)', 'EXECUTE')
  UNION ALL
  SELECT 'service_role aplica resumo',
    has_function_privilege('service_role', 'public.whatsapp_server_apply_summary(uuid,uuid,uuid[],text,text,jsonb)', 'EXECUTE')
  UNION ALL
  SELECT 'navegador NÃO grava mensagem',
    NOT has_function_privilege('authenticated', 'public.whatsapp_server_ingest(text,text,text,text,text,text,text,timestamptz)', 'EXECUTE')
  UNION ALL
  SELECT 'terça 10h está no horário',
    NOT public.whatsapp_fora_do_horario(gen_random_uuid(), '2026-09-15 10:00:00-03')
  UNION ALL
  SELECT 'terça 22h está fora do horário',
    public.whatsapp_fora_do_horario(gen_random_uuid(), '2026-09-15 22:00:00-03')
  UNION ALL
  SELECT 'sábado 12h está fora do horário',
    public.whatsapp_fora_do_horario(gen_random_uuid(), '2026-09-12 12:00:00-03')
  UNION ALL
  SELECT '17h30 em ponto já está fora',
    public.whatsapp_fora_do_horario(gen_random_uuid(), '2026-09-15 17:30:00-03')
  UNION ALL
  SELECT 'job apagar_expiradas agendado',
    EXISTS (SELECT 1 FROM cron.job AS job WHERE job.jobname = 'whatsapp_apagar_expiradas')
  UNION ALL
  SELECT 'job resumo_diario agendado',
    EXISTS (SELECT 1 FROM cron.job AS job WHERE job.jobname = 'whatsapp_resumo_diario')
) AS conferencia;

COMMIT;
