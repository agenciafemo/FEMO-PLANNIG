-- ============================================================================
-- Quadro de Produção — Fase 1: modelo de CHECKLIST.
--
-- Antes: production_items.stage guardava UMA etapa por peça (kanban linear).
-- Isso não representa o trabalho real, que é paralelo (capa/legenda pode ficar
-- pronta antes do vídeo sair da edição).
--
-- Agora: cada peça nasce com TODAS as suas etapas em production_item_steps e a
-- equipe marca o que conclui, em qualquer ordem.
--
-- A coluna antiga `stage` é preservada (não removemos nada) para não quebrar
-- nada que ainda a leia. O backfill converte o que está em andamento.
-- Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.production_item_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.production_items(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  label TEXT NOT NULL,
  -- check = feito/não feito | data = com data marcada (captação)
  -- gate  = aprovado/reprovado + motivo | acao = executa algo e marca
  kind TEXT NOT NULL DEFAULT 'check' CHECK (kind IN ('check', 'data', 'gate', 'acao')),
  position INTEGER NOT NULL DEFAULT 0,

  done BOOLEAN NOT NULL DEFAULT false,
  done_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  done_at TIMESTAMPTZ,

  scheduled_at TIMESTAMPTZ,                 -- captação: data e hora
  outcome TEXT CHECK (outcome IN ('aprovado', 'reprovado')),
  reason_codes TEXT[],                      -- motivos da reprovação
  reason_note TEXT,

  assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT production_item_steps_item_key_key UNIQUE (item_id, step_key)
);

CREATE INDEX IF NOT EXISTS production_item_steps_item_idx
  ON public.production_item_steps (item_id, position);
CREATE INDEX IF NOT EXISTS production_item_steps_org_idx
  ON public.production_item_steps (organization_id);
CREATE INDEX IF NOT EXISTS production_item_steps_assignee_idx
  ON public.production_item_steps (assignee_id) WHERE done = false;

ALTER TABLE public.production_item_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_item_steps_select ON public.production_item_steps;
CREATE POLICY production_item_steps_select
  ON public.production_item_steps FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS production_item_steps_write ON public.production_item_steps;
CREATE POLICY production_item_steps_write
  ON public.production_item_steps FOR ALL TO authenticated
  USING (public.can_edit_org_content(organization_id, auth.uid()))
  WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_item_steps TO authenticated;

DROP TRIGGER IF EXISTS update_production_item_steps_updated_at ON public.production_item_steps;
CREATE TRIGGER update_production_item_steps_updated_at
  BEFORE UPDATE ON public.production_item_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- BACKFILL: cria as etapas das peças que já existem e marca como concluídas
-- as que a peça já passou (conforme a etapa antiga em `stage`).
-- ============================================================================
WITH pipeline(content_type, step_key, label, kind, position, role) AS (
  VALUES
    ('reels',    'roteiro',             'Roteiro',                     'check', 0, 'writing'),
    ('reels',    'aprov_roteiro',       'Aprovação do roteiro',        'gate',  1, 'review'),
    ('reels',    'captacao',            'Captação',                    'data',  2, 'editing'),
    ('reels',    'edicao',              'Edição',                      'check', 3, 'editing'),
    ('reels',    'legenda_capa',        'Legenda e capa',              'check', 4, 'design'),
    ('reels',    'enviar_planejamento', 'Enviar para o planejamento',  'acao',  5, 'design'),
    ('reels',    'revisao',             'Revisão',                     'check', 6, 'review'),
    ('reels',    'aprov_cliente',       'Aprovação do cliente',        'gate',  7, 'review'),

    ('carousel', 'copy',                'Copy',                        'check', 0, 'design'),
    ('carousel', 'design',              'Design',                      'check', 1, 'design'),
    ('carousel', 'legenda',             'Legenda',                     'check', 2, 'design'),
    ('carousel', 'enviar_planejamento', 'Enviar para o planejamento',  'acao',  3, 'design'),
    ('carousel', 'revisao',             'Revisão',                     'check', 4, 'review'),
    ('carousel', 'aprov_cliente',       'Aprovação do cliente',        'gate',  5, 'review'),

    ('static',   'copy',                'Copy',                        'check', 0, 'design'),
    ('static',   'design',              'Design',                      'check', 1, 'design'),
    ('static',   'legenda',             'Legenda',                     'check', 2, 'design'),
    ('static',   'enviar_planejamento', 'Enviar para o planejamento',  'acao',  3, 'design'),
    ('static',   'revisao',             'Revisão',                     'check', 4, 'review'),
    ('static',   'aprov_cliente',       'Aprovação do cliente',        'gate',  5, 'review'),

    ('story',    'design',              'Arte do story',               'check', 0, 'design'),
    ('story',    'enviar_planejamento', 'Enviar para o planejamento',  'acao',  1, 'design'),
    ('story',    'revisao',             'Revisão',                     'check', 2, 'review'),
    ('story',    'aprov_cliente',       'Aprovação do cliente',        'gate',  3, 'review'),

    ('blog',     'texto',               'Texto',                       'check', 0, 'writing'),
    ('blog',     'revisao',             'Revisão',                     'check', 1, 'review'),
    ('blog',     'enviar_planejamento', 'Enviar para o planejamento',  'acao',  2, 'design'),
    ('blog',     'aprov_cliente',       'Aprovação do cliente',        'gate',  3, 'review')
),
-- Onde a peça está hoje: posição da etapa equivalente à `stage` antiga.
-- 'pronto' = passou por tudo, menos a aprovação do cliente (que é nova).
progress AS (
  SELECT
    i.id AS item_id,
    CASE
      WHEN i.stage = 'pronto' THEN 999
      ELSE COALESCE(
        (SELECT p.position FROM pipeline p
          WHERE p.content_type = i.content_type AND p.step_key = i.stage),
        0)
    END AS reached
  FROM public.production_items i
)
INSERT INTO public.production_item_steps
  (organization_id, item_id, step_key, label, kind, position, done, done_at, assignee_id)
SELECT
  i.organization_id,
  i.id,
  p.step_key,
  p.label,
  p.kind,
  p.position,
  -- concluída se a peça já passou por ela (e nunca marca a aprovação do cliente)
  (pr.reached > p.position AND p.step_key <> 'aprov_cliente') AS done,
  CASE WHEN (pr.reached > p.position AND p.step_key <> 'aprov_cliente')
       THEN now() ELSE NULL END,
  CASE p.role
    WHEN 'design'  THEN ra.design_user_id
    WHEN 'writing' THEN ra.writing_user_id
    WHEN 'editing' THEN ra.editing_user_id
    WHEN 'review'  THEN ra.review_user_id
  END
FROM public.production_items i
JOIN pipeline p ON p.content_type = i.content_type
JOIN progress pr ON pr.item_id = i.id
LEFT JOIN public.production_role_assignees ra ON ra.organization_id = i.organization_id
ON CONFLICT (item_id, step_key) DO NOTHING;
