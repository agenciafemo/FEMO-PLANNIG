-- Expansão do calendário editorial para clientes de saúde/medicina.
-- As datas foram conferidas no Calendário da Saúde do Ministério da Saúde e
-- em campanhas oficiais da OMS. São inseridas na organização com maior base
-- de clientes, seguindo o mesmo padrão do seed original.

BEGIN;

WITH org AS (
  SELECT organization_id AS id
  FROM public.clients
  WHERE organization_id IS NOT NULL
  GROUP BY organization_id
  ORDER BY count(*) DESC
  LIMIT 1
),
seed(title, month, day, category, segment) AS (
  VALUES
    ('Dia Mundial das Doenças Tropicais Negligenciadas', 1, 30, 'nacional', 'medicos'),
    ('Dia Nacional da Visibilidade Trans', 1, 29, 'nacional', 'medicos'),
    ('Dia Nacional da Criança Traqueostomizada', 2, 18, 'nacional', 'medicos'),
    ('Dia Mundial das Doenças Raras', 2, 28, 'nacional', 'medicos'),
    ('Dia Mundial do Câncer de Colo do Útero', 3, 26, 'nacional', 'medicos'),
    ('Dia Nacional de Combate ao Câncer Colorretal', 3, 27, 'nacional', 'medicos'),
    ('Dia Mundial do Transtorno Bipolar', 3, 30, 'nacional', 'medicos'),
    ('Dia Mundial da Conscientização sobre o Autismo', 4, 2, 'nacional', 'medicos'),
    ('Dia Nacional do Portador da Doença de Parkinson', 4, 4, 'nacional', 'medicos'),
    ('Dia Mundial da Doença de Chagas', 4, 14, 'nacional', 'medicos'),
    ('Dia Internacional da Hemofilia', 4, 17, 'nacional', 'medicos'),
    ('Dia Mundial da Luta contra a Malária', 4, 25, 'nacional', 'medicos'),
    ('Dia Nacional de Prevenção e Combate à Hipertensão Arterial', 4, 26, 'nacional', 'medicos'),
    ('Dia Nacional de Doação do Leite Humano', 5, 19, 'nacional', 'medicos'),
    ('Dia Mundial sem Tabaco', 5, 31, 'nacional', 'medicos'),
    ('Dia Internacional de Combate às Drogas', 6, 26, 'nacional', 'medicos'),
    ('Dia Mundial da Hepatite', 7, 28, 'nacional', 'medicos'),
    ('Dia Mundial da Segurança do Paciente', 9, 17, 'nacional', 'medicos'),
    ('Dia Mundial do Coração', 9, 29, 'nacional', 'medicos'),
    ('Dia Mundial da Alimentação', 10, 16, 'nacional', 'medicos'),
    ('Dia Mundial da Osteoporose', 10, 20, 'nacional', 'medicos'),
    ('Dia Mundial do Diabetes', 11, 14, 'nacional', 'medicos'),
    ('Dia Mundial da Prematuridade', 11, 17, 'nacional', 'medicos'),
    ('Dia Nacional de Combate à Dengue', 11, 19, 'nacional', 'medicos'),
    ('Dia Mundial de Luta contra a AIDS', 12, 1, 'nacional', 'medicos')
)
INSERT INTO public.commemorative_dates
  (organization_id, title, month, day, category, recurring, recurrence_rule, segment, client_id)
SELECT org.id, seed.title, seed.month, seed.day, seed.category, true, 'fixed', seed.segment, NULL
FROM seed CROSS JOIN org
WHERE NOT EXISTS (
  SELECT 1
  FROM public.commemorative_dates existing
  WHERE existing.organization_id = org.id
    AND lower(btrim(existing.title)) = lower(btrim(seed.title))
    AND existing.recurrence_rule = 'fixed'
    AND existing.segment = seed.segment
    AND existing.client_id IS NULL
);

COMMIT;
