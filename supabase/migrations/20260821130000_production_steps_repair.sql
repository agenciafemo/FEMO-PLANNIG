-- ============================================================================
-- Reparo do backfill de production_item_steps.
--
-- No backfill original, o LEFT JOIN em production_role_assignees multiplicava
-- as linhas de origem e algumas peças acabaram sem etapa nenhuma. Aqui o
-- responsável vem de uma subconsulta escalar (LIMIT 1), então cada (peça,etapa)
-- aparece exatamente uma vez.
--
-- Roda para TODAS as peças; o que já existe é ignorado pelo ON CONFLICT.
-- Totalmente idempotente — pode rodar quantas vezes quiser.
-- ============================================================================

WITH pipeline(content_type, step_key, label, kind, position, role) AS (
  VALUES
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
    ('blog',     'aprov_cliente',       'Aprovação do cliente',       'gate',  3, 'review')
),
pecas AS (
  SELECT
    i.id,
    i.organization_id,
    i.content_type,
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
  f.organization_id,
  f.id,
  p.step_key,
  p.label,
  p.kind,
  p.position,
  (f.reached > p.position AND p.step_key <> 'aprov_cliente'),
  CASE WHEN (f.reached > p.position AND p.step_key <> 'aprov_cliente')
       THEN now() ELSE NULL END,
  (SELECT CASE p.role
            WHEN 'design'  THEN ra.design_user_id
            WHEN 'writing' THEN ra.writing_user_id
            WHEN 'editing' THEN ra.editing_user_id
            WHEN 'review'  THEN ra.review_user_id
          END
     FROM public.production_role_assignees ra
    WHERE ra.organization_id = f.organization_id
    LIMIT 1)
FROM pecas f
JOIN pipeline p ON p.content_type = f.content_type
ON CONFLICT (item_id, step_key) DO NOTHING;
