-- ============================================================================
-- FRAME.IO — estado de revisao preservado por arquivo
--
-- A tabela independente evita perder um status recebido antes de o arquivo ser
-- vinculado a uma peca no Norteia. A Edge Function escreve como service_role;
-- membros da organizacao possuem somente leitura.
-- ============================================================================

BEGIN;

ALTER TABLE public.frameio_asset_links
  ADD COLUMN frameio_status_updated_at TIMESTAMPTZ;

CREATE TABLE public.frameio_file_states (
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL CHECK (char_length(btrim(file_id)) BETWEEN 1 AND 200),
  frameio_status TEXT NOT NULL
    CHECK (char_length(btrim(frameio_status)) BETWEEN 1 AND 120),
  external_updated_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, file_id)
);

COMMENT ON TABLE public.frameio_file_states IS
  'Ultimo status de revisao recebido do Frame.io por arquivo, inclusive antes do vinculo com uma peca.';

CREATE INDEX frameio_file_states_org_updated_idx
  ON public.frameio_file_states (organization_id, external_updated_at DESC);

-- Vinculos criados na primeira versao passam a ter um estado inicial coerente.
UPDATE public.frameio_asset_links
SET frameio_status = COALESCE(frameio_status, 'in_review'),
    frameio_status_updated_at = COALESCE(
      frameio_status_updated_at,
      updated_at,
      created_at,
      now()
    )
WHERE frameio_status IS NULL
   OR frameio_status_updated_at IS NULL;

CREATE OR REPLACE FUNCTION public.apply_frameio_file_status(
  _organization_id UUID,
  _file_id TEXT,
  _frameio_status TEXT,
  _external_updated_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_applied BOOLEAN := false;
BEGIN
  INSERT INTO public.frameio_file_states (
    organization_id,
    file_id,
    frameio_status,
    external_updated_at,
    received_at
  ) VALUES (
    _organization_id,
    btrim(_file_id),
    btrim(_frameio_status),
    _external_updated_at,
    now()
  )
  ON CONFLICT (organization_id, file_id) DO UPDATE
  SET frameio_status = EXCLUDED.frameio_status,
      external_updated_at = EXCLUDED.external_updated_at,
      received_at = now()
  WHERE EXCLUDED.external_updated_at >= public.frameio_file_states.external_updated_at;

  v_applied := FOUND;

  IF v_applied THEN
    UPDATE public.frameio_asset_links
    SET frameio_status = btrim(_frameio_status),
        frameio_status_updated_at = _external_updated_at
    WHERE organization_id = _organization_id
      AND file_id = btrim(_file_id)
      AND (
        frameio_status_updated_at IS NULL
        OR _external_updated_at >= frameio_status_updated_at
      );
  END IF;

  RETURN v_applied;
END;
$$;

-- Mantem a validacao cross-org existente e hidrata o estado mais recente no
-- primeiro vinculo. Sem evento anterior, vincular o link inicia "Em revisao".
CREATE OR REPLACE FUNCTION public.validate_frameio_asset_link_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_state public.frameio_file_states%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.production_items item
    WHERE item.id = NEW.production_item_id
      AND item.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'A peca deve pertencer a mesma organizacao do vinculo Frame.io';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
  END IF;

  NEW.file_id := btrim(NEW.file_id);
  NEW.file_name := NULLIF(btrim(NEW.file_name), '');
  NEW.file_url := NULLIF(btrim(NEW.file_url), '');
  NEW.account_id := NULLIF(btrim(NEW.account_id), '');
  NEW.workspace_id := NULLIF(btrim(NEW.workspace_id), '');
  NEW.project_id := NULLIF(btrim(NEW.project_id), '');
  NEW.frameio_status := NULLIF(btrim(NEW.frameio_status), '');

  IF TG_OP = 'INSERT' AND NEW.frameio_status IS NULL THEN
    SELECT state.*
      INTO v_state
    FROM public.frameio_file_states state
    WHERE state.organization_id = NEW.organization_id
      AND state.file_id = NEW.file_id;

    IF FOUND THEN
      NEW.frameio_status := v_state.frameio_status;
      NEW.frameio_status_updated_at := v_state.external_updated_at;
    ELSE
      NEW.frameio_status := 'in_review';
      NEW.frameio_status_updated_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.frameio_file_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY frameio_file_states_select
  ON public.frameio_file_states
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

REVOKE ALL ON TABLE public.frameio_file_states FROM anon, authenticated;
GRANT SELECT ON TABLE public.frameio_file_states TO authenticated;
GRANT ALL ON TABLE public.frameio_file_states TO service_role;

REVOKE ALL ON FUNCTION public.apply_frameio_file_status(UUID, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_frameio_file_status(UUID, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;

-- A funcao de trigger continua sem ser uma API publica.
REVOKE ALL ON FUNCTION public.validate_frameio_asset_link_tenant()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_frameio_asset_link_tenant()
  TO service_role;

COMMIT;
