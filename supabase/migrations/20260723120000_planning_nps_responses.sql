-- ============================================================================
-- NPS DO PLANEJAMENTO — FUNDAÇÃO DE DADOS
--
-- Registra respostas recebidas pelo link público do cliente sem persistir o
-- public_link_token. O token é uma credencial de capacidade e serve apenas
-- para a RPC resolver e validar client_id, planning_id e organization_id.
--
-- Não cria UI, não coleta IP/user agent e não altera planejamentos existentes.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- TABELA
-- ---------------------------------------------------------------------------
CREATE TABLE public.planning_nps_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  planning_id UUID NOT NULL
    REFERENCES public.plannings(id) ON DELETE CASCADE,
  client_id UUID
    REFERENCES public.clients(id) ON DELETE SET NULL,
  score INTEGER NOT NULL,
  classification TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT planning_nps_score_valid
    CHECK (score BETWEEN 0 AND 10),
  CONSTRAINT planning_nps_classification_valid
    CHECK (classification IN ('detractor', 'passive', 'promoter')),
  CONSTRAINT planning_nps_score_classification_consistent
    CHECK (
      classification = CASE
        WHEN score BETWEEN 0 AND 6 THEN 'detractor'
        WHEN score BETWEEN 7 AND 8 THEN 'passive'
        ELSE 'promoter'
      END
    ),
  CONSTRAINT planning_nps_detractor_reason_required
    CHECK (
      score > 6
      OR NULLIF(btrim(reason), '') IS NOT NULL
    ),
  CONSTRAINT planning_nps_reason_length
    CHECK (reason IS NULL OR char_length(reason) <= 2000)
);

COMMENT ON TABLE public.planning_nps_responses IS
  'Respostas NPS enviadas pelo link público de um planejamento.';
COMMENT ON COLUMN public.planning_nps_responses.client_id IS
  'Identificador equivalente ao dono do link público. O public_link_token nunca é persistido nesta tabela.';
COMMENT ON COLUMN public.planning_nps_responses.classification IS
  'Derivada do score pelo trigger: detractor (0-6), passive (7-8), promoter (9-10).';
COMMENT ON COLUMN public.planning_nps_responses.reason IS
  'Justificativa opcional, exceto para scores de 0 a 6, quando é obrigatória.';

CREATE INDEX planning_nps_org_created_idx
  ON public.planning_nps_responses (organization_id, created_at DESC);
CREATE INDEX planning_nps_planning_created_idx
  ON public.planning_nps_responses (planning_id, created_at DESC);
CREATE INDEX planning_nps_client_created_idx
  ON public.planning_nps_responses (client_id, created_at DESC)
  WHERE client_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- INTEGRIDADE DE ESCOPO
--
-- Além da validação da RPC, o trigger impede combinações inconsistentes entre
-- organização, planejamento e cliente em qualquer caminho privilegiado.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_planning_nps_response_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_scope_valid BOOLEAN;
BEGIN
  NEW.reason := NULLIF(btrim(NEW.reason), '');
  NEW.classification := CASE
    WHEN NEW.score BETWEEN 0 AND 6 THEN 'detractor'
    WHEN NEW.score BETWEEN 7 AND 8 THEN 'passive'
    WHEN NEW.score BETWEEN 9 AND 10 THEN 'promoter'
    ELSE NEW.classification
  END;

  IF NEW.client_id IS NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.plannings p
      WHERE p.id = NEW.planning_id
        AND p.organization_id = NEW.organization_id
    )
    INTO v_scope_valid;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.plannings p
      JOIN public.clients c
        ON c.id = p.client_id
       AND c.organization_id = p.organization_id
      WHERE p.id = NEW.planning_id
        AND p.client_id = NEW.client_id
        AND p.organization_id = NEW.organization_id
    )
    INTO v_scope_valid;
  END IF;

  IF v_scope_valid IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'planning_nps_scope_invalid';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_planning_nps_response_scope
BEFORE INSERT OR UPDATE
ON public.planning_nps_responses
FOR EACH ROW
EXECUTE FUNCTION public.enforce_planning_nps_response_scope();

-- ---------------------------------------------------------------------------
-- RLS / ACESSO DIRETO
--
-- Não há policies para roles da API nesta fase. A tabela não é uma API
-- pública: anon/authenticated gravam somente pela RPC abaixo e não podem
-- consultar respostas diretamente.
-- ---------------------------------------------------------------------------
ALTER TABLE public.planning_nps_responses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.planning_nps_responses
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_planning_nps_response_scope()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC PÚBLICA
--
-- _planning_id identifica qual planejamento visível no portal está sendo
-- avaliado, mas organização e cliente nunca são aceitos do frontend. Ambos são
-- derivados do token após validação de revogação, expiração e pertencimento.
--
-- Uma trava transacional por cliente/planejamento torna o dedupe de 30 dias
-- seguro contra duas requisições simultâneas. Uma resposta posterior é aceita
-- normalmente quando a janela expira.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_submit_planning_nps(
  _token TEXT,
  _planning_id UUID,
  _score INTEGER,
  _reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  response_id UUID,
  accepted BOOLEAN,
  next_allowed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_organization_id UUID;
  v_client_id UUID;
  v_reason TEXT;
  v_existing_id UUID;
  v_existing_next_allowed_at TIMESTAMPTZ;
  v_response_id UUID;
  v_created_at TIMESTAMPTZ;
BEGIN
  IF NULLIF(btrim(_token), '') IS NULL OR char_length(_token) > 512 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'public_link_invalid';
  END IF;

  IF _planning_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'planning_id_required';
  END IF;

  IF _score IS NULL OR _score < 0 OR _score > 10 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'nps_score_invalid';
  END IF;

  v_reason := NULLIF(btrim(_reason), '');

  IF _score BETWEEN 0 AND 6 AND v_reason IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'nps_reason_required';
  END IF;

  IF v_reason IS NOT NULL AND char_length(v_reason) > 2000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'nps_reason_too_long';
  END IF;

  SELECT p.organization_id, c.id
  INTO v_organization_id, v_client_id
  FROM public.plannings p
  JOIN public.clients c
    ON c.id = p.client_id
   AND c.organization_id = p.organization_id
  WHERE p.id = _planning_id
    AND c.public_link_token::text = _token
    AND c.public_link_revoked = false
    AND (
      c.public_link_expires_at IS NULL
      OR c.public_link_expires_at > now()
    );

  IF v_organization_id IS NULL OR v_client_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'public_link_or_planning_invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_client_id::text || ':' || _planning_id::text,
      0
    )
  );

  SELECT r.id, r.created_at + interval '30 days'
  INTO v_existing_id, v_existing_next_allowed_at
  FROM public.planning_nps_responses r
  WHERE r.planning_id = _planning_id
    AND r.client_id = v_client_id
    AND r.created_at > now() - interval '30 days'
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY
    SELECT v_existing_id, false, v_existing_next_allowed_at;
    RETURN;
  END IF;

  INSERT INTO public.planning_nps_responses (
    organization_id,
    planning_id,
    client_id,
    score,
    classification,
    reason
  )
  VALUES (
    v_organization_id,
    _planning_id,
    v_client_id,
    _score,
    CASE
      WHEN _score BETWEEN 0 AND 6 THEN 'detractor'
      WHEN _score BETWEEN 7 AND 8 THEN 'passive'
      ELSE 'promoter'
    END,
    v_reason
  )
  RETURNING id, created_at
  INTO v_response_id, v_created_at;

  RETURN QUERY
  SELECT v_response_id, true, v_created_at + interval '30 days';
END;
$$;

COMMENT ON FUNCTION public.public_submit_planning_nps(TEXT, UUID, INTEGER, TEXT) IS
  'Registra NPS via token público válido. Deriva escopo no servidor e limita a uma resposta por planejamento/cliente a cada 30 dias.';

REVOKE ALL ON FUNCTION public.public_submit_planning_nps(TEXT, UUID, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_submit_planning_nps(TEXT, UUID, INTEGER, TEXT)
  TO anon, authenticated;

COMMIT;
