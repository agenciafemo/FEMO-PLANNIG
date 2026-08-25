-- ============================================================================
-- Registro de consentimento para gravar/transcrever reunioes.
--
-- Antes so ficava marcado em localStorage do navegador de quem clicou "Entendi,
-- ativar" — sem valor como registro (some ao limpar cache, nao diz quem
-- autorizou). Aqui fica: quem, quando, em qual organizacao. E' um log de
-- auditoria (sem UPDATE/DELETE): a primeira linha de uma organizacao ja
-- libera o recurso para todo mundo dela (mesmo comportamento anterior),
-- mas agora existe prova de quem confirmou o aviso e quando.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.meeting_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meeting_consents_org_idx ON public.meeting_consents (organization_id);

ALTER TABLE public.meeting_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meeting_consents_select ON public.meeting_consents;
CREATE POLICY meeting_consents_select ON public.meeting_consents FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

-- Só INSERT (sem UPDATE/DELETE): é um log de auditoria, não um registro editável.
-- Cada pessoa só registra consentimento em nome dela mesma.
DROP POLICY IF EXISTS meeting_consents_insert ON public.meeting_consents;
CREATE POLICY meeting_consents_insert ON public.meeting_consents FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id, auth.uid())
    AND user_id = auth.uid()
  );

GRANT SELECT, INSERT ON public.meeting_consents TO authenticated;
REVOKE ALL ON public.meeting_consents FROM anon;

COMMIT;
