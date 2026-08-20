BEGIN;

-- O seed por segmento foi aplicado à organização com mais clientes. Antes da
-- proteção contra o catálogo global, ele criou cópias locais de 11 datas que
-- já existiam globalmente. Removemos somente essas cópias conhecidas.
WITH target_org AS (
  SELECT organization_id AS id
  FROM public.clients
  WHERE organization_id IS NOT NULL
  GROUP BY organization_id
  ORDER BY count(*) DESC
  LIMIT 1
),
duplicate_keys(title_key, recurrence_rule) AS (
  VALUES
    ('black friday', 'black_friday'),
    ('carnaval', 'carnival'),
    ('dia das crianças', 'fixed'),
    ('dia das mães', 'mothers_day'),
    ('dia do cliente', 'fixed'),
    ('dia dos namorados', 'fixed'),
    ('dia dos pais', 'fathers_day'),
    ('dia internacional da mulher', 'fixed'),
    ('natal', 'fixed'),
    ('páscoa', 'easter'),
    ('réveillon', 'fixed')
),
duplicates AS (
  SELECT organization_date.id
  FROM public.commemorative_dates AS organization_date
  JOIN target_org
    ON organization_date.organization_id = target_org.id
  JOIN duplicate_keys
    ON duplicate_keys.title_key = lower(btrim(organization_date.title))
   AND duplicate_keys.recurrence_rule = organization_date.recurrence_rule
  WHERE organization_date.client_id IS NULL
    AND organization_date.segment IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.commemorative_dates AS global_date
      WHERE global_date.organization_id IS NULL
        AND global_date.client_id IS NULL
        AND global_date.segment IS NULL
        AND lower(btrim(global_date.title)) = duplicate_keys.title_key
        AND global_date.recurrence_rule = duplicate_keys.recurrence_rule
    )
)
DELETE FROM public.commemorative_dates AS date_to_remove
USING duplicates
WHERE date_to_remove.id = duplicates.id;

COMMIT;
