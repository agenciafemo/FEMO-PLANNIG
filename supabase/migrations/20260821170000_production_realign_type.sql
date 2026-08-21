-- ============================================================================
-- Quando o tipo do post muda no editor (ex.: "post" vira "reels"), a peça de
-- produção ficava com o fluxo antigo — etapas de carrossel num reels.
--
-- Aqui:
--   1) production_pipeline(): o fluxo de cada tipo, num só lugar (evita repetir
--      a lista de etapas em toda migration).
--   2) realign_production_item(): realinha as etapas de uma peça ao seu tipo.
--      Remove as que não pertencem MAS só se ainda não estiverem concluídas
--      (trabalho já registrado nunca é apagado) e acrescenta as que faltam.
--   3) Gatilho: mudou o tipo do post → a peça acompanha.
--   4) Corrige as peças que já estão fora de sincronia hoje.
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.production_pipeline()
RETURNS TABLE(content_type TEXT, step_key TEXT, label TEXT, kind TEXT, pos INT, role TEXT)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT * FROM (VALUES
    ('reels',    'roteiro',             'Roteiro',                    'check', 0, 'writing'),
    ('reels',    'aprov_roteiro',       'Aprovação do roteiro',       'gate',  1, 'review'),
    ('reels',    'captacao',            'Captação',                   'data',  2, 'editing'),
    ('reels',    'edicao',              'Edição',                     'check', 3, 'editing'),
    ('reels',    'legenda_capa',        'Legenda e capa',             'check', 4, 'design'),
    ('reels',    'enviar_planejamento', 'Enviar para o planejamento', 'acao',  5, 'design'),
    ('reels',    'revisao',             'Revisão',                    'check', 6, 'review'),
    ('reels',    'aprov_cliente',       'Aprovação do cliente',       'gate',  7, 'review'),

    ('carousel', 'copy',                'Copy',                       'check', 0, 'design'),
    ('carousel', 'design',              'Design',                     'check', 1, 'design'),
    ('carousel', 'legenda',             'Legenda',                    'check', 2, 'design'),
    ('carousel', 'enviar_planejamento', 'Enviar para o planejamento', 'acao',  3, 'design'),
    ('carousel', 'revisao',             'Revisão',                    'check', 4, 'review'),
    ('carousel', 'aprov_cliente',       'Aprovação do cliente',       'gate',  5, 'review'),

    ('static',   'copy',                'Copy',                       'check', 0, 'design'),
    ('static',   'design',              'Design',                     'check', 1, 'design'),
    ('static',   'legenda',             'Legenda',                    'check', 2, 'design'),
    ('static',   'enviar_planejamento', 'Enviar para o planejamento', 'acao',  3, 'design'),
    ('static',   'revisao',             'Revisão',                    'check', 4, 'review'),
    ('static',   'aprov_cliente',       'Aprovação do cliente',       'gate',  5, 'review'),

    ('story',    'design',              'Arte do story',              'check', 0, 'design'),
    ('story',    'enviar_planejamento', 'Enviar para o planejamento', 'acao',  1, 'design'),
    ('story',    'revisao',             'Revisão',                    'check', 2, 'review'),
    ('story',    'aprov_cliente',       'Aprovação do cliente',       'gate',  3, 'review'),

    ('blog',     'texto',               'Texto',                      'check', 0, 'writing'),
    ('blog',     'revisao',             'Revisão',                    'check', 1, 'review'),
    ('blog',     'enviar_planejamento', 'Enviar para o planejamento', 'acao',  2, 'design'),
    ('blog',     'aprov_cliente',       'Aprovação do cliente',       'gate',  3, 'review'),

    ('extra',    'concluir',            'Concluir',                   'check', 0, NULL)
  ) AS t(content_type, step_key, label, kind, pos, role);
$$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.realign_production_item(_item_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.production_items;
BEGIN
  SELECT * INTO v_item FROM public.production_items WHERE id = _item_id;
  IF v_item.id IS NULL THEN RETURN; END IF;

  -- Remove etapas que não pertencem ao tipo — mas nunca as já concluídas nem
  -- as criadas pela equipe (custom_).
  DELETE FROM public.production_item_steps s
  WHERE s.item_id = v_item.id
    AND s.done = false
    AND s.step_key NOT LIKE 'custom\_%'
    AND NOT EXISTS (
      SELECT 1 FROM public.production_pipeline() p
      WHERE p.content_type = v_item.content_type AND p.step_key = s.step_key
    );

  -- Acrescenta as etapas do tipo que ainda não existem.
  INSERT INTO public.production_item_steps
    (organization_id, item_id, step_key, label, kind, position, done, assignee_id)
  SELECT
    v_item.organization_id, v_item.id, p.step_key, p.label, p.kind, p.pos, false,
    (SELECT CASE p.role
              WHEN 'design'  THEN ra.design_user_id
              WHEN 'writing' THEN ra.writing_user_id
              WHEN 'editing' THEN ra.editing_user_id
              WHEN 'review'  THEN ra.review_user_id
            END
       FROM public.production_role_assignees ra
      WHERE ra.organization_id = v_item.organization_id
      LIMIT 1)
  FROM public.production_pipeline() p
  WHERE p.content_type = v_item.content_type
  ON CONFLICT (item_id, step_key) DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- Gatilho: mudou o tipo do post → a peça acompanha e realinha as etapas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_production_type_from_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id UUID;
BEGIN
  IF NEW.content_type IS NOT DISTINCT FROM OLD.content_type THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_item_id FROM public.production_items WHERE post_id = NEW.id LIMIT 1;
  IF v_item_id IS NULL THEN RETURN NEW; END IF;

  UPDATE public.production_items SET content_type = NEW.content_type WHERE id = v_item_id;
  PERFORM public.realign_production_item(v_item_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_production_type ON public.posts;
CREATE TRIGGER sync_production_type
  AFTER UPDATE OF content_type ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.sync_production_type_from_post();

-- ---------------------------------------------------------------------------
-- Corrige o que já está fora de sincronia hoje.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT i.id, p.content_type AS tipo_certo
    FROM public.production_items i
    JOIN public.posts p ON p.id = i.post_id
    WHERE i.content_type <> p.content_type
  LOOP
    UPDATE public.production_items SET content_type = r.tipo_certo WHERE id = r.id;
    PERFORM public.realign_production_item(r.id);
  END LOOP;
END $$;
