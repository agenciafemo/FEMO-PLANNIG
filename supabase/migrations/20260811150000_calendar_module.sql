-- ============================================================================
-- MODULO DE CALENDARIO — FASE 1
--
-- Migration preparada para revisao. Nao aplicar diretamente em producao.
-- ============================================================================

BEGIN;

-- Alinhamento excepcional: estas tabelas foram criadas manualmente em uma
-- tentativa anterior, permanecem vazias e ainda nao possuem consumidores.
-- ATENCAO: reaplicar esta migration no futuro remove todos os dados delas.
DROP TABLE IF EXISTS public.calendar_events CASCADE;
DROP TABLE IF EXISTS public.commemorative_dates CASCADE;

-- ---------------------------------------------------------------------------
-- CATALOGO DE DATAS COMEMORATIVAS
--
-- organization_id NULL identifica o catalogo global padrao, legivel por todos
-- os usuarios autenticados. Linhas com organization_id pertencem apenas a uma
-- organizacao e podem ser administradas pela equipe que edita conteudo.
--
-- recurrence_rule e necessaria porque algumas datas nao possuem month/day
-- fixos: Carnaval, Pascoa, Dia das Maes, Dia dos Pais e Black Friday.
-- ---------------------------------------------------------------------------
CREATE TABLE public.commemorative_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  month INTEGER,
  day INTEGER,
  title TEXT NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('nacional', 'varejo', 'sazonal')),
  recurring BOOLEAN NOT NULL DEFAULT true,
  recurrence_rule TEXT NOT NULL DEFAULT 'fixed'
    CHECK (
      recurrence_rule IN (
        'fixed',
        'carnival',
        'easter',
        'mothers_day',
        'fathers_day',
        'black_friday'
      )
    ),

  CONSTRAINT commemorative_dates_title_not_blank
    CHECK (btrim(title) <> ''),
  CONSTRAINT commemorative_dates_title_length
    CHECK (char_length(btrim(title)) <= 160),
  CONSTRAINT commemorative_dates_valid_fixed_date
    CHECK (
      (
        recurrence_rule = 'fixed'
        AND month BETWEEN 1 AND 12
        AND day BETWEEN 1 AND 31
      )
      OR (
        recurrence_rule <> 'fixed'
        AND month IS NULL
        AND day IS NULL
      )
    )
);

COMMENT ON TABLE public.commemorative_dates IS
  'Catalogo global ou por organizacao de datas relevantes para marketing.';
COMMENT ON COLUMN public.commemorative_dates.organization_id IS
  'NULL indica uma data do catalogo global padrao.';
COMMENT ON COLUMN public.commemorative_dates.recurrence_rule IS
  'Regra para datas moveis; fixed usa os campos month e day.';

ALTER TABLE public.commemorative_dates ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX commemorative_dates_global_title_rule_key
  ON public.commemorative_dates (lower(btrim(title)), recurrence_rule)
  WHERE organization_id IS NULL;

CREATE UNIQUE INDEX commemorative_dates_org_title_rule_key
  ON public.commemorative_dates (
    organization_id,
    lower(btrim(title)),
    recurrence_rule
  )
  WHERE organization_id IS NOT NULL;

CREATE INDEX commemorative_dates_organization_idx
  ON public.commemorative_dates (organization_id, category, month, day);

-- Catalogo global: todos os autenticados podem ler.
-- Catalogo privado: somente membros ativos da organizacao podem ler.
CREATE POLICY commemorative_dates_select_global_or_org
ON public.commemorative_dates
FOR SELECT TO authenticated
USING (
  organization_id IS NULL
  OR public.is_org_member(organization_id, auth.uid())
);

-- O frontend nunca cria ou altera linhas globais. Somente datas proprias de
-- uma organizacao podem ser gerenciadas pela equipe que edita conteudo.
CREATE POLICY commemorative_dates_editors_insert_org
ON public.commemorative_dates
FOR INSERT TO authenticated
WITH CHECK (
  organization_id IS NOT NULL
  AND public.can_edit_org_content(organization_id, auth.uid())
);

CREATE POLICY commemorative_dates_editors_update_org
ON public.commemorative_dates
FOR UPDATE TO authenticated
USING (
  organization_id IS NOT NULL
  AND public.can_edit_org_content(organization_id, auth.uid())
)
WITH CHECK (
  organization_id IS NOT NULL
  AND public.can_edit_org_content(organization_id, auth.uid())
);

CREATE POLICY commemorative_dates_editors_delete_org
ON public.commemorative_dates
FOR DELETE TO authenticated
USING (
  organization_id IS NOT NULL
  AND public.can_edit_org_content(organization_id, auth.uid())
);

REVOKE ALL ON public.commemorative_dates FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.commemorative_dates TO authenticated;

-- ---------------------------------------------------------------------------
-- EVENTOS DO CALENDARIO
--
-- client_id NULL representa um evento geral da organizacao.
-- ---------------------------------------------------------------------------
CREATE TABLE public.calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID
    REFERENCES public.clients(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('comemorativa', 'personalizado', 'campanha')),
  color TEXT NOT NULL DEFAULT '#0F766E',
  note TEXT,
  created_by UUID NOT NULL
    REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT calendar_events_title_not_blank
    CHECK (btrim(title) <> ''),
  CONSTRAINT calendar_events_title_length
    CHECK (char_length(btrim(title)) <= 160),
  CONSTRAINT calendar_events_color_hex
    CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT calendar_events_note_length
    CHECK (note IS NULL OR char_length(note) <= 5000)
);

COMMENT ON TABLE public.calendar_events IS
  'Eventos internos por organizacao; client_id NULL indica um evento geral.';
COMMENT ON COLUMN public.calendar_events.event_type IS
  'Tipo do evento: comemorativa, personalizado ou campanha.';

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX calendar_events_org_date_idx
  ON public.calendar_events (organization_id, event_date);

CREATE INDEX calendar_events_org_client_date_idx
  ON public.calendar_events (organization_id, client_id, event_date);

CREATE INDEX calendar_events_org_type_date_idx
  ON public.calendar_events (organization_id, event_type, event_date);

-- Impede mistura de tenants e torna organization_id/created_by imutaveis.
CREATE OR REPLACE FUNCTION public.validate_calendar_event_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'A organizacao do evento nao pode ser alterada';
    END IF;

    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'O criador do evento nao pode ser alterado';
    END IF;
  END IF;

  IF NEW.client_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.client_id IS DISTINCT FROM OLD.client_id)
     AND NOT EXISTS (
       SELECT 1
       FROM public.clients client
       WHERE client.id = NEW.client_id
         AND client.organization_id = NEW.organization_id
     ) THEN
    RAISE EXCEPTION 'O cliente deve pertencer a mesma organizacao do evento';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_calendar_event_tenant
BEFORE INSERT OR UPDATE ON public.calendar_events
FOR EACH ROW EXECUTE FUNCTION public.validate_calendar_event_tenant();

CREATE POLICY calendar_events_members_select
ON public.calendar_events
FOR SELECT TO authenticated
USING (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY calendar_events_editors_insert
ON public.calendar_events
FOR INSERT TO authenticated
WITH CHECK (
  public.can_edit_org_content(organization_id, auth.uid())
  AND created_by = auth.uid()
);

CREATE POLICY calendar_events_editors_update
ON public.calendar_events
FOR UPDATE TO authenticated
USING (public.can_edit_org_content(organization_id, auth.uid()))
WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));

CREATE POLICY calendar_events_editors_delete
ON public.calendar_events
FOR DELETE TO authenticated
USING (public.can_edit_org_content(organization_id, auth.uid()));

REVOKE ALL ON public.calendar_events FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.calendar_events TO authenticated;

-- ---------------------------------------------------------------------------
-- SEED GLOBAL — PRINCIPAIS DATAS DE MARKETING DO BRASIL
-- ---------------------------------------------------------------------------
INSERT INTO public.commemorative_dates (
  organization_id,
  month,
  day,
  title,
  category,
  recurring,
  recurrence_rule
)
VALUES
  (NULL, 1, 1, 'Ano Novo', 'nacional', true, 'fixed'),
  (NULL, NULL, NULL, 'Carnaval', 'sazonal', true, 'carnival'),
  (NULL, 3, 8, 'Dia Internacional da Mulher', 'sazonal', true, 'fixed'),
  (NULL, 3, 15, 'Dia do Consumidor', 'varejo', true, 'fixed'),
  (NULL, NULL, NULL, 'Páscoa', 'sazonal', true, 'easter'),
  (NULL, 4, 21, 'Tiradentes', 'nacional', true, 'fixed'),
  (NULL, 5, 1, 'Dia do Trabalho', 'nacional', true, 'fixed'),
  (NULL, NULL, NULL, 'Dia das Mães', 'varejo', true, 'mothers_day'),
  (NULL, 6, 12, 'Dia dos Namorados', 'varejo', true, 'fixed'),
  (NULL, 6, 24, 'São João', 'sazonal', true, 'fixed'),
  (NULL, 7, 20, 'Dia do Amigo', 'sazonal', true, 'fixed'),
  (NULL, NULL, NULL, 'Dia dos Pais', 'varejo', true, 'fathers_day'),
  (NULL, 9, 7, 'Independência do Brasil', 'nacional', true, 'fixed'),
  (NULL, 9, 15, 'Dia do Cliente', 'varejo', true, 'fixed'),
  (NULL, 10, 12, 'Dia das Crianças', 'varejo', true, 'fixed'),
  (NULL, 10, 31, 'Halloween', 'sazonal', true, 'fixed'),
  (NULL, 11, 15, 'Proclamação da República', 'nacional', true, 'fixed'),
  (NULL, 11, 20, 'Dia da Consciência Negra', 'nacional', true, 'fixed'),
  (NULL, NULL, NULL, 'Black Friday', 'varejo', true, 'black_friday'),
  (NULL, 12, 25, 'Natal', 'nacional', true, 'fixed'),
  (NULL, 12, 31, 'Réveillon', 'sazonal', true, 'fixed')
ON CONFLICT DO NOTHING;

COMMIT;
