-- ============================================================================
-- MODULO DE PONTO
--
-- Migration preparada para revisao. Nao aplicar diretamente em producao.
-- Reutiliza o modelo multi-tenant existente:
--   - cada membro ativo registra e consulta as proprias batidas;
--   - ADM, Head e o administrador geral consultam a equipe da organizacao;
--   - horario e data de criacao sao definidos pelo banco.
-- ============================================================================

BEGIN;

CREATE TABLE public.time_clock_punches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL
    REFERENCES auth.users(id),
  punched_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  kind TEXT NOT NULL
    CHECK (kind IN ('entrada', 'saida_almoco', 'volta_almoco', 'saida')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT time_clock_punches_note_not_blank
    CHECK (note IS NULL OR btrim(note) <> ''),
  CONSTRAINT time_clock_punches_note_length
    CHECK (note IS NULL OR char_length(note) <= 500)
);

COMMENT ON TABLE public.time_clock_punches IS
  'Batidas imutaveis do ponto da equipe, isoladas por organizacao.';
COMMENT ON COLUMN public.time_clock_punches.punched_at IS
  'Horario efetivo da batida, sempre definido pelo relogio do banco.';
COMMENT ON COLUMN public.time_clock_punches.kind IS
  'Etapa da jornada: entrada, saida_almoco, volta_almoco ou saida.';

ALTER TABLE public.time_clock_punches ENABLE ROW LEVEL SECURITY;

CREATE INDEX time_clock_punches_org_punched_at_idx
  ON public.time_clock_punches (organization_id, punched_at DESC);
CREATE INDEX time_clock_punches_org_user_punched_at_idx
  ON public.time_clock_punches (organization_id, user_id, punched_at DESC);

-- Impede que clientes escolham um horario arbitrario e garante que a batida
-- sempre pertença a um membro ativo da mesma organizacao.
CREATE OR REPLACE FUNCTION public.prepare_time_clock_punch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_day_start TIMESTAMPTZ;
  v_next_day_start TIMESTAMPTZ;
  v_last_kind TEXT;
  v_expected_kind TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members member
    WHERE member.organization_id = NEW.organization_id
      AND member.user_id = NEW.user_id
      AND member.status = 'active'
  ) THEN
    RAISE EXCEPTION 'O usuario deve ser membro ativo da organizacao';
  END IF;

  -- Serializa as batidas deste usuario/organizacao para impedir dois cliques
  -- concorrentes de registrarem a mesma etapa da jornada.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.organization_id::TEXT || ':' || NEW.user_id::TEXT, 0)
  );

  v_day_start := date_trunc('day', v_now AT TIME ZONE 'America/Sao_Paulo')
    AT TIME ZONE 'America/Sao_Paulo';
  v_next_day_start := v_day_start + INTERVAL '1 day';

  SELECT punch.kind
  INTO v_last_kind
  FROM public.time_clock_punches punch
  WHERE punch.organization_id = NEW.organization_id
    AND punch.user_id = NEW.user_id
    AND punch.punched_at >= v_day_start
    AND punch.punched_at < v_next_day_start
  ORDER BY punch.punched_at DESC
  LIMIT 1;

  v_expected_kind := CASE v_last_kind
    WHEN 'entrada' THEN 'saida_almoco'
    WHEN 'saida_almoco' THEN 'volta_almoco'
    WHEN 'volta_almoco' THEN 'saida'
    WHEN 'saida' THEN NULL
    ELSE 'entrada'
  END;

  IF v_expected_kind IS NULL THEN
    RAISE EXCEPTION 'A jornada de hoje ja foi concluida';
  END IF;

  IF NEW.kind <> v_expected_kind THEN
    RAISE EXCEPTION 'Proxima batida esperada: %', v_expected_kind;
  END IF;

  NEW.punched_at := v_now;
  NEW.created_at := NEW.punched_at;
  NEW.note := NULLIF(btrim(NEW.note), '');

  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_time_clock_punch
BEFORE INSERT ON public.time_clock_punches
FOR EACH ROW EXECUTE FUNCTION public.prepare_time_clock_punch();

-- SECURITY DEFINER permite consultar o e-mail administrativo sem expor
-- auth.users ao frontend. A funcao sempre usa auth.uid(), portanto o chamador
-- nao consegue simular a identidade de outro usuario.
CREATE OR REPLACE FUNCTION public.can_view_team_time_clock(_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members member
    JOIN auth.users account ON account.id = member.user_id
    WHERE member.organization_id = _organization_id
      AND member.user_id = auth.uid()
      AND member.status = 'active'
      AND (
        lower(account.email) = 'ferlopesmoro@gmail.com'
        OR lower(btrim(COALESCE(member.job_title, ''))) IN ('adm', 'head')
      )
  );
$$;

COMMENT ON FUNCTION public.can_view_team_time_clock(UUID) IS
  'Informa se o usuario autenticado pode consultar o ponto da equipe na organizacao.';

REVOKE ALL ON FUNCTION public.can_view_team_time_clock(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_team_time_clock(UUID)
  TO authenticated;

-- Cada membro ativo consulta apenas as proprias batidas. ADM, Head e o
-- administrador geral consultam todas as batidas da organizacao ativa.
CREATE POLICY "members_select_own_or_managers_select_org_time_clock"
ON public.time_clock_punches FOR SELECT TO authenticated
USING (
  (
    user_id = auth.uid()
    AND public.is_org_member(organization_id)
  )
  OR public.can_view_team_time_clock(organization_id)
);

-- Ninguem registra ponto por outra pessoa, nem em outra organizacao.
CREATE POLICY "members_insert_own_time_clock"
ON public.time_clock_punches FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.is_org_member(organization_id)
);

-- Batidas sao imutaveis: nao ha policy nem grant de UPDATE/DELETE.
REVOKE ALL ON public.time_clock_punches FROM anon;
REVOKE UPDATE, DELETE ON public.time_clock_punches FROM authenticated;
GRANT SELECT, INSERT ON public.time_clock_punches TO authenticated;

COMMIT;
