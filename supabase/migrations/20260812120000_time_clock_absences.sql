-- ============================================================================
-- ATESTADOS / ABONOS DO PONTO
--
-- O colaborador registra um atestado (ou folga/férias) para um dia ou período,
-- com um arquivo (foto/PDF) anexado no bucket privado time-clock-attachments.
-- Somente ADM/Head aprova ou rejeita. Dias de atestado APROVADO são abonados
-- (não geram hora negativa no banco de horas). Arquivo é opcional no cadastro
-- mas exigido para atestado médico via UI.
-- ============================================================================

BEGIN;

CREATE TABLE public.time_clock_absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  kind TEXT NOT NULL DEFAULT 'atestado'
    CHECK (kind IN ('atestado', 'folga', 'ferias', 'outro')),
  reason TEXT,
  file_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT time_clock_absences_range CHECK (end_date >= start_date),
  CONSTRAINT time_clock_absences_reason_length
    CHECK (reason IS NULL OR char_length(reason) <= 1000),
  CONSTRAINT time_clock_absences_note_length
    CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  CONSTRAINT time_clock_absences_file_https
    CHECK (file_path IS NULL OR btrim(file_path) <> ''),
  CONSTRAINT time_clock_absences_review_state CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.time_clock_absences IS
  'Atestados/abonos do ponto; arquivo no bucket privado time-clock-attachments.';

ALTER TABLE public.time_clock_absences ENABLE ROW LEVEL SECURITY;

CREATE INDEX time_clock_absences_org_user_idx
  ON public.time_clock_absences (organization_id, user_id, start_date DESC);
CREATE INDEX time_clock_absences_org_status_idx
  ON public.time_clock_absences (organization_id, status, start_date DESC);

-- Valida a criação (dono/membro) e, na revisão, exige gestor + preenche o
-- revisor. Dados originais ficam imutáveis depois de enviados.
CREATE OR REPLACE FUNCTION public.prepare_time_clock_absence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id <> auth.uid() OR NEW.created_by <> auth.uid() THEN
      RAISE EXCEPTION 'O atestado deve pertencer ao usuario autenticado';
    END IF;
    IF NOT public.is_org_member(NEW.organization_id, auth.uid()) THEN
      RAISE EXCEPTION 'O usuario deve ser membro ativo da organizacao';
    END IF;
    NEW.status := 'pending';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.review_note := NULL;
    NEW.created_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE: dados originais imutaveis.
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.end_date IS DISTINCT FROM OLD.end_date
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.file_path IS DISTINCT FROM OLD.file_path
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Os dados originais do atestado nao podem ser alterados';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'Este atestado ja foi analisado';
  END IF;
  IF NEW.status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'A analise deve aprovar ou rejeitar o atestado';
  END IF;
  IF NOT public.can_view_team_time_clock(NEW.organization_id) THEN
    RAISE EXCEPTION 'Sem permissao para analisar atestados';
  END IF;

  NEW.reviewed_by := auth.uid();
  NEW.reviewed_at := now();
  NEW.review_note := NULLIF(btrim(NEW.review_note), '');
  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_time_clock_absence
BEFORE INSERT OR UPDATE ON public.time_clock_absences
FOR EACH ROW EXECUTE FUNCTION public.prepare_time_clock_absence();

CREATE POLICY time_clock_absences_select_own_or_managers
ON public.time_clock_absences
FOR SELECT TO authenticated
USING (
  (user_id = auth.uid() AND public.is_org_member(organization_id, auth.uid()))
  OR public.can_view_team_time_clock(organization_id)
);

CREATE POLICY time_clock_absences_insert_own
ON public.time_clock_absences
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND status = 'pending'
  AND public.is_org_member(organization_id, auth.uid())
);

CREATE POLICY time_clock_absences_managers_update
ON public.time_clock_absences
FOR UPDATE TO authenticated
USING (public.can_view_team_time_clock(organization_id))
WITH CHECK (public.can_view_team_time_clock(organization_id));

REVOKE ALL ON public.time_clock_absences FROM anon;
REVOKE DELETE ON public.time_clock_absences FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.time_clock_absences TO authenticated;

-- ---------------------------------------------------------------------------
-- Bucket privado para os arquivos de atestado + políticas de storage.
-- Caminho: {organization_id}/{user_id}/{arquivo}. Dono envia/lê o próprio;
-- gestor (ADM/Head) lê os da organização.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('time-clock-attachments', 'time-clock-attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "tc_attachments_insert_own" ON storage.objects;
CREATE POLICY "tc_attachments_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'time-clock-attachments'
  AND (storage.foldername(name))[2] = auth.uid()::text
  AND public.is_org_member(((storage.foldername(name))[1])::uuid, auth.uid())
);

DROP POLICY IF EXISTS "tc_attachments_select_own_or_manager" ON storage.objects;
CREATE POLICY "tc_attachments_select_own_or_manager"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'time-clock-attachments'
  AND (
    (storage.foldername(name))[2] = auth.uid()::text
    OR public.can_view_team_time_clock(((storage.foldername(name))[1])::uuid)
  )
);

COMMIT;
