-- ============================================================================
-- Feedback do time sobre a ata gerada por IA.
--
-- PARA QUE SERVE, DE VERDADE:
-- Um polegar nao faz o Gemini aprender — modelo de linguagem nao se ajusta por
-- voto. O que faz diferenca e GUARDAR o que foi reprovado e por que, e depois
-- injetar isso no prompt das proximas atas como orientacao explicita. Sem essa
-- volta, o botao seria enfeite.
--
-- Por isso a tabela guarda o TEXTO julgado junto do voto: sem saber o que foi
-- reprovado, o voto nao ensina nada. E por isso o comentario e o campo mais
-- valioso aqui — "ficou generico demais" vale mais que mil polegares.
--
-- Uma linha por pessoa POR GERACAO: regerar a ata cria uma avaliacao nova, e o
-- historico fica. Trocar a linha antiga apagaria justamente o aprendizado.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.meeting_summary_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id      UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 1 = ajudou, -1 = nao ajudou. Sem escala de 1 a 5: ninguem sabe o que e 3.
  rating          SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
  note            TEXT,
  -- O que estava na tela quando a pessoa votou. E o que torna o voto util
  -- depois — sem isto, sabe-se que alguem reprovou, nao o que foi reprovado.
  summary_snapshot TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.meeting_summary_feedback IS
  'Voto do time sobre a ata por IA. Alimenta o prompt das proximas geracoes.';

CREATE INDEX IF NOT EXISTS meeting_summary_feedback_org_idx
  ON public.meeting_summary_feedback (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS meeting_summary_feedback_meeting_idx
  ON public.meeting_summary_feedback (meeting_id, created_at DESC);

ALTER TABLE public.meeting_summary_feedback ENABLE ROW LEVEL SECURITY;

-- Todo membro da organizacao le: a ata e trabalho coletivo, e ver que alguem
-- ja reprovou evita duas pessoas reclamarem da mesma coisa em silencio.
DROP POLICY IF EXISTS meeting_summary_feedback_select ON public.meeting_summary_feedback;
CREATE POLICY meeting_summary_feedback_select ON public.meeting_summary_feedback
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

-- Cada um vota por si. `user_id = auth.uid()` no WITH CHECK impede votar no
-- lugar de outro.
DROP POLICY IF EXISTS meeting_summary_feedback_insert ON public.meeting_summary_feedback;
CREATE POLICY meeting_summary_feedback_insert ON public.meeting_summary_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id, auth.uid())
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.meetings m
       WHERE m.id = meeting_id
         AND m.organization_id = meeting_summary_feedback.organization_id
    )
  );

-- Apagar o proprio voto: quem mudou de ideia nao deveria precisar de suporte.
DROP POLICY IF EXISTS meeting_summary_feedback_delete ON public.meeting_summary_feedback;
CREATE POLICY meeting_summary_feedback_delete ON public.meeting_summary_feedback
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.meeting_summary_feedback TO authenticated;
REVOKE ALL ON public.meeting_summary_feedback FROM anon;

COMMIT;
