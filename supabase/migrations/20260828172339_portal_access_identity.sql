-- ============================================================================
-- IDENTIDADE DE ACESSO AO PORTAL PÚBLICO
--
-- Objetivo: impedir que uma abertura feita pela própria equipe seja anunciada
-- como "Cliente abriu o planejamento". O navegador envia apenas um identificador
-- aleatório; o banco armazena somente o SHA-256 e faz toda a classificação.
--
-- Esta migration NÃO cria login de cliente. Acessos sem identidade verificada
-- são classificados como "anonymous" e geram a mensagem neutra
-- "Link público do planejamento acessado".
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.portal_team_devices (
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL
    CHECK (device_hash ~ '^[0-9a-f]{64}$'),
  registered_by UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, device_hash)
);

COMMENT ON TABLE public.portal_team_devices IS
  'Hashes de identificadores aleatórios de navegadores já usados por membros ativos. Não armazena fingerprint, IP ou identificador bruto.';

ALTER TABLE public.portal_team_devices ENABLE ROW LEVEL SECURITY;

CREATE INDEX portal_team_devices_registered_by_idx
  ON public.portal_team_devices (registered_by);

CREATE TABLE public.portal_planning_access_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL
    REFERENCES public.clients(id) ON DELETE CASCADE,
  planning_id UUID NOT NULL
    REFERENCES public.plannings(id) ON DELETE CASCADE,
  viewer_type TEXT NOT NULL
    CHECK (viewer_type IN ('team_member', 'team_device', 'verified_client', 'anonymous')),
  viewer_user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL,
  device_hash TEXT
    CHECK (device_hash IS NULL OR device_hash ~ '^[0-9a-f]{64}$'),
  notification_created BOOLEAN NOT NULL DEFAULT false,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.portal_planning_access_events IS
  'Auditoria deduplicada de acessos ao planejamento público. anonymous significa link acessado, não identidade de cliente confirmada.';

ALTER TABLE public.portal_planning_access_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX portal_planning_access_events_org_time_idx
  ON public.portal_planning_access_events (organization_id, occurred_at DESC);
CREATE INDEX portal_planning_access_events_planning_time_idx
  ON public.portal_planning_access_events (planning_id, occurred_at DESC);
CREATE INDEX portal_planning_access_events_device_time_idx
  ON public.portal_planning_access_events (device_hash, occurred_at DESC)
  WHERE device_hash IS NOT NULL;

-- Nenhuma escrita direta é permitida. As RPCs abaixo validam token, status,
-- organização e vínculo do usuário antes de contornar a RLS.
REVOKE ALL ON TABLE public.portal_team_devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.portal_planning_access_events FROM PUBLIC, anon, authenticated;

-- Registra o navegador em todas as organizações nas quais o usuário autenticado
-- é membro ativo. O ID bruto nunca sai da transação: apenas o hash é persistido.
CREATE OR REPLACE FUNCTION public.register_portal_team_device(_device_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_device_hash TEXT;
  v_registered_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória';
  END IF;

  IF _device_id IS NULL OR length(btrim(_device_id)) NOT BETWEEN 16 AND 128 THEN
    RAISE EXCEPTION 'Identificador de dispositivo inválido';
  END IF;

  v_device_hash := encode(digest(btrim(_device_id), 'sha256'), 'hex');

  INSERT INTO public.portal_team_devices (
    organization_id,
    device_hash,
    registered_by,
    last_seen_at
  )
  SELECT
    member.organization_id,
    v_device_hash,
    auth.uid(),
    now()
  FROM public.organization_members AS member
  WHERE member.user_id = auth.uid()
    AND member.status = 'active'
  ON CONFLICT (organization_id, device_hash)
  DO UPDATE SET
    registered_by = EXCLUDED.registered_by,
    last_seen_at = EXCLUDED.last_seen_at;

  GET DIAGNOSTICS v_registered_count = ROW_COUNT;

  IF v_registered_count = 0 THEN
    RAISE EXCEPTION 'Usuário não pertence a uma organização ativa';
  END IF;

  RETURN v_registered_count;
END;
$$;

-- Classifica o acesso no servidor e cria, no máximo, uma notificação neutra a
-- cada 15 minutos por planejamento. A mesma identidade só gera um evento a
-- cada 30 minutos, evitando ruído por cliques/refresh repetidos.
CREATE OR REPLACE FUNCTION public.public_register_planning_access(
  _token TEXT,
  _planning_id UUID,
  _device_id TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_org_id UUID;
  v_client_id UUID;
  v_client_name TEXT;
  v_device_hash TEXT;
  v_viewer_type TEXT := 'anonymous';
  v_viewer_user_id UUID;
  v_duplicate BOOLEAN := false;
  v_should_notify BOOLEAN := false;
  v_event_id UUID;
BEGIN
  SELECT planning.organization_id, planning.client_id, client.name
  INTO v_org_id, v_client_id, v_client_name
  FROM public.plannings AS planning
  JOIN public.clients AS client
    ON client.id = planning.client_id
   AND client.organization_id = planning.organization_id
  WHERE planning.id = _planning_id
    AND client.public_link_token::text = _token
    AND client.public_link_revoked = false
    AND (client.public_link_expires_at IS NULL OR client.public_link_expires_at > now())
    AND planning.status IN ('client_review', 'approved');

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Token inválido ou planejamento não disponível';
  END IF;

  IF _device_id IS NOT NULL AND length(btrim(_device_id)) BETWEEN 16 AND 128 THEN
    v_device_hash := encode(digest(btrim(_device_id), 'sha256'), 'hex');
  END IF;

  IF auth.uid() IS NOT NULL AND public.is_org_member(v_org_id, auth.uid()) THEN
    v_viewer_type := 'team_member';
    v_viewer_user_id := auth.uid();

    IF v_device_hash IS NOT NULL THEN
      INSERT INTO public.portal_team_devices (
        organization_id,
        device_hash,
        registered_by,
        last_seen_at
      ) VALUES (
        v_org_id,
        v_device_hash,
        auth.uid(),
        now()
      )
      ON CONFLICT (organization_id, device_hash)
      DO UPDATE SET
        registered_by = EXCLUDED.registered_by,
        last_seen_at = EXCLUDED.last_seen_at;
    END IF;
  ELSIF v_device_hash IS NOT NULL THEN
    SELECT device.registered_by
    INTO v_viewer_user_id
    FROM public.portal_team_devices AS device
    JOIN public.organization_members AS member
      ON member.organization_id = device.organization_id
     AND member.user_id = device.registered_by
     AND member.status = 'active'
    WHERE device.organization_id = v_org_id
      AND device.device_hash = v_device_hash
    LIMIT 1;

    IF v_viewer_user_id IS NOT NULL THEN
      v_viewer_type := 'team_device';

      UPDATE public.portal_team_devices
      SET last_seen_at = now()
      WHERE organization_id = v_org_id
        AND device_hash = v_device_hash;
    END IF;
  END IF;

  -- Serializa acessos concorrentes ao mesmo planejamento para que a janela de
  -- deduplicação também funcione quando dois requests chegam juntos.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('portal-planning-access:' || _planning_id::text, 0)
  );

  SELECT EXISTS (
    SELECT 1
    FROM public.portal_planning_access_events AS access_event
    WHERE access_event.planning_id = _planning_id
      AND access_event.viewer_type = v_viewer_type
      AND access_event.viewer_user_id IS NOT DISTINCT FROM v_viewer_user_id
      AND access_event.device_hash IS NOT DISTINCT FROM v_device_hash
      AND access_event.occurred_at >= now() - interval '30 minutes'
  ) INTO v_duplicate;

  IF v_duplicate THEN
    RETURN v_viewer_type;
  END IF;

  IF v_viewer_type = 'anonymous' THEN
    SELECT NOT EXISTS (
      SELECT 1
      FROM public.portal_planning_access_events AS recent_event
      WHERE recent_event.planning_id = _planning_id
        AND recent_event.notification_created = true
        AND recent_event.occurred_at >= now() - interval '15 minutes'
    ) INTO v_should_notify;
  END IF;

  INSERT INTO public.portal_planning_access_events (
    organization_id,
    client_id,
    planning_id,
    viewer_type,
    viewer_user_id,
    device_hash,
    notification_created
  ) VALUES (
    v_org_id,
    v_client_id,
    _planning_id,
    v_viewer_type,
    v_viewer_user_id,
    v_device_hash,
    v_should_notify
  )
  RETURNING id INTO v_event_id;

  IF v_should_notify THEN
    INSERT INTO public.notifications (
      organization_id,
      type,
      title,
      body,
      planning_id
    ) VALUES (
      v_org_id,
      'planning_link_accessed',
      'Link público do planejamento acessado',
      v_client_name,
      _planning_id
    );
  END IF;

  RETURN v_viewer_type;
END;
$$;

-- Compatibilidade com versões antigas do frontend. Mesmo sem device_id, a
-- mensagem deixa de afirmar que o visitante anônimo é necessariamente cliente.
CREATE OR REPLACE FUNCTION public.public_notify_planning_viewed(
  _token TEXT,
  _planning_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.public_register_planning_access(_token, _planning_id, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.register_portal_team_device(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_register_planning_access(TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_notify_planning_viewed(TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.register_portal_team_device(TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_register_planning_access(TEXT, UUID, TEXT)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_notify_planning_viewed(TEXT, UUID)
  TO anon, authenticated;

COMMIT;
