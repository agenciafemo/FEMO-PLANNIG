-- ============================================================================
-- NPS DO PLANEJAMENTO — LEITURA INTERNA SANITIZADA
--
-- Mantém public.planning_nps_responses sem SELECT direto para as roles da API.
-- A equipe autenticada consulta apenas dados da organização em que possui
-- membership ativa, por meio destas RPCs SECURITY DEFININER.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- RESUMO E DISTRIBUIÇÕES
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_planning_nps_dashboard(
  _organization_id UUID,
  _from TIMESTAMPTZ DEFAULT NULL,
  _to TIMESTAMPTZ DEFAULT NULL,
  _client_id UUID DEFAULT NULL,
  _classification TEXT DEFAULT NULL
)
RETURNS TABLE (
  average_score NUMERIC,
  total_responses INTEGER,
  promoter_count INTEGER,
  passive_count INTEGER,
  detractor_count INTEGER,
  positive_count INTEGER,
  neutral_count INTEGER,
  negative_count INTEGER,
  last_response_at TIMESTAMPTZ,
  classification_distribution JSONB,
  period_distribution JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'authentication_required';
  END IF;

  IF _organization_id IS NULL
     OR NOT public.is_org_member(_organization_id, v_user_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'organization_access_denied';
  END IF;

  IF _classification IS NOT NULL
     AND _classification NOT IN ('detractor', 'passive', 'promoter') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'nps_classification_invalid';
  END IF;

  IF _from IS NOT NULL AND _to IS NOT NULL AND _from > _to THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'nps_period_invalid';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      r.score,
      r.classification,
      r.created_at
    FROM public.planning_nps_responses r
    WHERE r.organization_id = _organization_id
      AND (_from IS NULL OR r.created_at >= _from)
      AND (_to IS NULL OR r.created_at <= _to)
      AND (_client_id IS NULL OR r.client_id = _client_id)
      AND (_classification IS NULL OR r.classification = _classification)
  ),
  totals AS (
    SELECT
      round(avg(f.score)::NUMERIC, 2) AS average_score,
      count(*)::INTEGER AS total_responses,
      count(*) FILTER (WHERE f.classification = 'promoter')::INTEGER
        AS promoter_count,
      count(*) FILTER (WHERE f.classification = 'passive')::INTEGER
        AS passive_count,
      count(*) FILTER (WHERE f.classification = 'detractor')::INTEGER
        AS detractor_count,
      max(f.created_at) AS last_response_at
    FROM filtered f
  ),
  months AS (
    SELECT generate_series(
      date_trunc('month', current_date) - interval '5 months',
      date_trunc('month', current_date),
      interval '1 month'
    ) AS month_start
  ),
  monthly AS (
    SELECT
      m.month_start,
      count(f.created_at)::INTEGER AS total,
      round(avg(f.score)::NUMERIC, 2) AS average_score
    FROM months m
    LEFT JOIN filtered f
      ON date_trunc('month', f.created_at) = m.month_start
    GROUP BY m.month_start
    ORDER BY m.month_start
  ),
  periods AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'period', to_char(monthly.month_start, 'YYYY-MM'),
        'label', to_char(monthly.month_start, 'MM/YYYY'),
        'total', monthly.total,
        'average_score', monthly.average_score
      )
      ORDER BY monthly.month_start
    ) AS distribution
    FROM monthly
  )
  SELECT
    t.average_score,
    t.total_responses,
    t.promoter_count,
    t.passive_count,
    t.detractor_count,
    t.promoter_count AS positive_count,
    t.passive_count AS neutral_count,
    t.detractor_count AS negative_count,
    t.last_response_at,
    jsonb_build_object(
      'promoter', t.promoter_count,
      'passive', t.passive_count,
      'detractor', t.detractor_count
    ) AS classification_distribution,
    coalesce(p.distribution, '[]'::JSONB) AS period_distribution
  FROM totals t
  CROSS JOIN periods p;
END;
$$;

COMMENT ON FUNCTION public.get_planning_nps_dashboard(
  UUID,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  UUID,
  TEXT
) IS
  'Retorna resumo NPS sanitizado da organização para um membro autenticado e ativo.';

-- ---------------------------------------------------------------------------
-- RESPOSTAS FILTRADAS E PAGINADAS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_planning_nps_responses(
  _organization_id UUID,
  _from TIMESTAMPTZ DEFAULT NULL,
  _to TIMESTAMPTZ DEFAULT NULL,
  _client_id UUID DEFAULT NULL,
  _classification TEXT DEFAULT NULL,
  _search TEXT DEFAULT NULL,
  _limit INTEGER DEFAULT 25,
  _offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  response_id UUID,
  client_id UUID,
  client_name TEXT,
  planning_id UUID,
  planning_label TEXT,
  score INTEGER,
  classification TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_search TEXT := NULLIF(btrim(_search), '');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'authentication_required';
  END IF;

  IF _organization_id IS NULL
     OR NOT public.is_org_member(_organization_id, v_user_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'organization_access_denied';
  END IF;

  IF _classification IS NOT NULL
     AND _classification NOT IN ('detractor', 'passive', 'promoter') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'nps_classification_invalid';
  END IF;

  IF _from IS NOT NULL AND _to IS NOT NULL AND _from > _to THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'nps_period_invalid';
  END IF;

  IF _limit IS NULL OR _limit < 1 OR _limit > 100 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'nps_limit_invalid';
  END IF;

  IF _offset IS NULL OR _offset < 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'nps_offset_invalid';
  END IF;

  IF v_search IS NOT NULL AND char_length(v_search) > 200 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'nps_search_too_long';
  END IF;

  RETURN QUERY
  SELECT
    r.id AS response_id,
    r.client_id,
    c.name AS client_name,
    r.planning_id,
    lpad(p.month::TEXT, 2, '0') || '/' || p.year::TEXT AS planning_label,
    r.score,
    r.classification,
    r.reason,
    r.created_at,
    count(*) OVER () AS total_count
  FROM public.planning_nps_responses r
  JOIN public.plannings p
    ON p.id = r.planning_id
   AND p.organization_id = r.organization_id
  LEFT JOIN public.clients c
    ON c.id = r.client_id
   AND c.organization_id = r.organization_id
  WHERE r.organization_id = _organization_id
    AND (_from IS NULL OR r.created_at >= _from)
    AND (_to IS NULL OR r.created_at <= _to)
    AND (_client_id IS NULL OR r.client_id = _client_id)
    AND (_classification IS NULL OR r.classification = _classification)
    AND (
      v_search IS NULL
      OR c.name ILIKE '%' || v_search || '%'
      OR r.reason ILIKE '%' || v_search || '%'
    )
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT _limit
  OFFSET _offset;
END;
$$;

COMMENT ON FUNCTION public.get_planning_nps_responses(
  UUID,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  UUID,
  TEXT,
  TEXT,
  INTEGER,
  INTEGER
) IS
  'Lista respostas NPS sanitizadas e paginadas da organização para um membro autenticado e ativo.';

-- As funções SECURITY DEFINER são a única API interna de leitura.
-- A tabela permanece sem SELECT direto para as roles da API.
REVOKE SELECT ON TABLE public.planning_nps_responses
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_planning_nps_dashboard(
  UUID,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  UUID,
  TEXT
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_planning_nps_responses(
  UUID,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  UUID,
  TEXT,
  TEXT,
  INTEGER,
  INTEGER
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_planning_nps_dashboard(
  UUID,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  UUID,
  TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_planning_nps_responses(
  UUID,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  UUID,
  TEXT,
  TEXT,
  INTEGER,
  INTEGER
) TO authenticated;

COMMIT;
