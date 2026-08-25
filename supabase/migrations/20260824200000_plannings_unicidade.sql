-- ============================================================================
-- Um planejamento por cliente por mes — garantido pelo BANCO.
--
-- A tabela foi criada com UNIQUE(client_id, month, year), mas a producao tem
-- Balas India com DOIS planejamentos de agosto/2026. Ou a restricao foi
-- perdida em alguma alteracao manual, ou nunca chegou neste ambiente. O
-- resultado e o relato de "planejamento duplicado".
--
-- A checagem no frontend ajuda a avisar com jeito, mas nao substitui esta: duas
-- pessoas criando o mesmo mes ao mesmo tempo passariam pelas duas checagens
-- antes de qualquer uma gravar. So o banco resolve corrida.
--
-- ATENCAO: este script NAO apaga nada. Se ainda houver duplicados, ele FALHA de
-- proposito e lista quais sao — decidir qual manter e do usuario, porque os
-- dois lados podem ter conteudo real.
-- Idempotente.
-- ============================================================================

DO $$
DECLARE
  v_duplicados INT;
  v_lista TEXT;
BEGIN
  SELECT count(*), string_agg(txt, ' | ')
  INTO v_duplicados, v_lista
  FROM (
    SELECT c.name || ' ' || d.month || '/' || d.year || ' (' || d.qtd || ' planejamentos)' AS txt
    FROM (
      SELECT client_id, month, year, count(*) AS qtd
      FROM public.plannings
      GROUP BY client_id, month, year
      HAVING count(*) > 1
    ) d
    JOIN public.clients c ON c.id = d.client_id
  ) x;

  IF COALESCE(v_duplicados, 0) > 0 THEN
    RAISE EXCEPTION
      'Existem % combinacoes de cliente/mes duplicadas. Resolva antes: %',
      v_duplicados, v_lista
      USING ERRCODE = '23505';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.plannings'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%client_id%month%year%'
  ) THEN
    ALTER TABLE public.plannings
      ADD CONSTRAINT plannings_client_month_year_unique
      UNIQUE (client_id, month, year);
  END IF;
END $$;
