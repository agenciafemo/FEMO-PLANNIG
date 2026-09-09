-- ============================================================================
-- CONTRATO DO CLIENTE: LinkedIn, tráfego pago e prioridade.
--
-- O contrato já dizia quantos posts, reels, carrosséis, stories e blogs o
-- cliente tem por mês — e o planejamento já nascia com esses números. Faltavam
-- três coisas que a agência decide na venda e depois repete de cabeça todo mês:
--
--   1. LinkedIn. Vira um TIPO DE PEÇA de verdade, não um número solto: sem
--      isso, "3 mídias para LinkedIn" no contrato não teria como virar 3 peças
--      no planejamento — que é o ponto do contrato existir.
--   2. Tráfego pago: faz? em quais plataformas? A resposta hoje mora na cabeça
--      de quem vendeu, e é o que decide se o relatório do cliente deve ou não
--      ter uma seção de investimento.
--   3. Prioridade. Nem todo cliente pesa igual na fila da equipe.
--
-- `does_linkedin` existe SEPARADO de `qty_linkedin` de propósito: "faz LinkedIn
-- sem quantidade fixa" é um caso real, e um zero não sabe dizer se é "não faz"
-- ou "faz sob demanda".
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. LinkedIn entra como tipo de peça nas três tabelas que restringem o tipo.
--
-- As três precisam andar juntas: um post de LinkedIn sem peça de produção
-- correspondente nasce órfão, e a peça sem modelo de etapas nasce vazia.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  alvo RECORD;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('posts',                     'posts_content_type_check',
       ARRAY['static','reels','carousel','story','blog','linkedin']),
      ('production_items',          'production_items_content_type_check',
       ARRAY['static','reels','carousel','story','blog','extra','linkedin']),
      ('production_step_templates', 'production_step_templates_content_type_check',
       ARRAY['static','reels','carousel','story','blog','extra','linkedin'])
    ) AS t(tabela, constraint_name, valores)
  LOOP
    IF to_regclass('public.' || alvo.tabela) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      alvo.tabela, alvo.constraint_name
    );
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (content_type IN (%s))',
      alvo.tabela,
      alvo.constraint_name,
      (SELECT string_agg(quote_literal(v), ', ') FROM unnest(alvo.valores) AS v)
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. As colunas novas do contrato.
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_content_contract
  ADD COLUMN IF NOT EXISTS qty_linkedin INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS does_linkedin BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS does_paid_traffic BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS paid_platforms TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS paid_platforms_other TEXT,
  -- 1 a 5, começando no MEIO. O padrão não pode ser "baixa": um cliente novo
  -- nasceria despriorizado sem ninguém ter decidido isso.
  ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_content_contract_qty_linkedin_check'
  ) THEN
    ALTER TABLE public.client_content_contract
      ADD CONSTRAINT client_content_contract_qty_linkedin_check
      CHECK (qty_linkedin >= 0 AND qty_linkedin <= 200);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_content_contract_priority_check'
  ) THEN
    ALTER TABLE public.client_content_contract
      ADD CONSTRAINT client_content_contract_priority_check
      CHECK (priority BETWEEN 1 AND 5);
  END IF;

  -- Plataformas: lista fechada. Texto livre aqui vira "meta", "Meta", "META"
  -- e "facebook" na mesma coluna, e nenhum relatório consegue agrupar depois.
  -- O caso "outra" tem campo próprio para o nome.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_content_contract_paid_platforms_check'
  ) THEN
    ALTER TABLE public.client_content_contract
      ADD CONSTRAINT client_content_contract_paid_platforms_check
      CHECK (paid_platforms <@ ARRAY['meta','google','outra']::TEXT[]);
  END IF;
END;
$$;

COMMENT ON COLUMN public.client_content_contract.does_linkedin IS
  'Cliente publica no LinkedIn. Separado de qty_linkedin: "faz sob demanda" é diferente de "não faz".';
COMMENT ON COLUMN public.client_content_contract.paid_platforms IS
  'Onde o cliente investe: meta, google, outra. Lista fechada para permitir agrupamento.';
COMMENT ON COLUMN public.client_content_contract.priority IS
  'Peso do cliente na fila da equipe, de 1 (menor) a 5 (maior). 3 = padrão.';

-- ---------------------------------------------------------------------------
-- Conferência: as colunas existem e o LinkedIn é aceito nos três lugares.
-- ---------------------------------------------------------------------------
SELECT
  count(*) FILTER (WHERE column_name = 'qty_linkedin')         AS tem_qty_linkedin,
  count(*) FILTER (WHERE column_name = 'does_paid_traffic')    AS tem_trafego,
  count(*) FILTER (WHERE column_name = 'priority')             AS tem_prioridade
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'client_content_contract';

SELECT
  rel.relname                                   AS tabela,
  pg_get_constraintdef(con.oid) LIKE '%linkedin%' AS aceita_linkedin
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE con.conname IN (
  'posts_content_type_check',
  'production_items_content_type_check',
  'production_step_templates_content_type_check'
)
ORDER BY rel.relname;

COMMIT;
