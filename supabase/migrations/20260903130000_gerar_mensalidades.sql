-- ============================================================================
-- GERAÇÃO DAS MENSALIDADES DO MÊS
-- ----------------------------------------------------------------------------
-- Cria uma cobrança por cliente recorrente ativo, na competência pedida.
--
-- REGRAS, confirmadas com quem cobra:
--
-- 1. O valor sai do CONTRATO DE CADA CLIENTE (client_financeiro.valor_mensalidade).
--    Não existe valor padrão de agência — cada cliente tem o seu.
--
-- 2. Cliente que entrou no meio da competência paga PROPORCIONAL aos dias que
--    foi cliente, sobre o valor do contrato dele. Quem já era cliente antes do
--    mês começar paga cheio.
--
-- 3. Vencimento é o dia do contrato, PRESO AO ÚLTIMO DIA DO MÊS quando o mês é
--    mais curto: dia 31 em fevereiro vira 28 (ou 29).
--
-- 4. Churn no meio do mês NÃO cancela a cobrança já emitida. Por isso esta
--    função nunca apaga nem altera lançamento existente — ela só insere o que
--    falta. O que já foi cobrado, foi cobrado.
--
-- SEGURANÇA CONTRA DUPLICIDADE: o índice único
-- `lancamentos_mensalidade_unica (client_id, competencia) WHERE is_mensalidade`
-- é quem garante uma por cliente por mês. O ON CONFLICT abaixo só transforma
-- isso em "ignora e segue" em vez de erro — rodar duas vezes é inofensivo.
--
-- Idempotente.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.gerar_mensalidades(_competencia DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org       UUID;
  v_qtd_org   INT;
  v_inicio    DATE;
  v_fim       DATE;
  v_dias      INT;
  v_categoria UUID;
  v_criadas   INT;
BEGIN
  -- Organização de quem chamou. Mesma regra do resto do módulo: com a pessoa
  -- em duas organizações, recusa em vez de escolher — emitir cobrança na
  -- organização errada é pior que falhar.
  SELECT om.organization_id, count(*) OVER ()
    INTO v_org, v_qtd_org
    FROM public.organization_members om
   WHERE om.user_id = auth.uid()
     AND om.status = 'active'
   LIMIT 1;

  IF v_qtd_org IS NULL OR v_qtd_org = 0 THEN
    RAISE EXCEPTION 'Sem organização ativa para gerar mensalidades.';
  END IF;
  IF v_qtd_org > 1 THEN
    RAISE EXCEPTION 'Você pertence a mais de uma organização.';
  END IF;

  IF NOT public.can_edit_org_content(v_org) THEN
    RAISE EXCEPTION 'Sem permissão para gerar mensalidades nesta organização.';
  END IF;

  v_inicio := date_trunc('month', _competencia)::date;
  v_fim    := (v_inicio + INTERVAL '1 month' - INTERVAL '1 day')::date;
  v_dias   := EXTRACT(DAY FROM v_fim)::int;

  -- Categoria própria das mensalidades. Criada na primeira execução para a
  -- agência não precisar cadastrar nada antes de faturar.
  SELECT id INTO v_categoria
    FROM public.categorias
   WHERE organization_id = v_org AND lower(btrim(nome)) = 'mensalidade'
   LIMIT 1;

  IF v_categoria IS NULL THEN
    INSERT INTO public.categorias (organization_id, nome, tipo)
    VALUES (v_org, 'Mensalidade', 'Entrada')
    RETURNING id INTO v_categoria;
  END IF;

  WITH elegiveis AS (
    SELECT
      c.id AS client_id,
      c.name AS nome,
      cf.valor_mensalidade,
      cf.dia_vencimento,
      -- agency_since nulo significa cliente antigo, de antes de alguém
      -- preencher a data: cobra cheio em vez de deixar de faturar.
      COALESCE(c.agency_since, v_inicio) AS entrada
    FROM public.client_financeiro cf
    JOIN public.clients c ON c.id = cf.client_id
    WHERE cf.organization_id = v_org
      AND cf.status = 'Ativo'
      AND cf.is_recorrente
      AND cf.valor_mensalidade > 0
      -- Ainda não era cliente nesta competência.
      AND COALESCE(c.agency_since, v_inicio) <= v_fim
      -- Já tinha saído antes de o mês começar.
      AND (cf.data_saida IS NULL OR cf.data_saida >= v_inicio)
  ),
  calculadas AS (
    SELECT
      client_id,
      nome,
      -- Proporcional só para quem entrou dentro da competência. Conta os dias
      -- a partir da entrada, inclusive: entrar dia 1 é mês cheio.
      CASE
        WHEN entrada > v_inicio THEN
          round(
            valor_mensalidade
            * (v_dias - EXTRACT(DAY FROM entrada)::int + 1)::numeric
            / v_dias,
            2
          )
        ELSE round(valor_mensalidade, 2)
      END AS valor,
      -- Dia do contrato, preso ao último dia do mês.
      (v_inicio + (LEAST(dia_vencimento, v_dias) - 1) * INTERVAL '1 day')::date AS vencimento,
      entrada > v_inicio AS proporcional
    FROM elegiveis
  ),
  inseridas AS (
    INSERT INTO public.lancamentos_financeiros (
      organization_id, tipo, valor, data_lancamento, descricao,
      status_pagamento, categoria_id, client_id, is_mensalidade
    )
    SELECT
      v_org,
      'Entrada',
      valor,
      vencimento,
      CASE
        WHEN proporcional
          THEN 'Mensalidade ' || to_char(v_inicio, 'MM/YYYY') || ' — ' || nome || ' (proporcional)'
        ELSE 'Mensalidade ' || to_char(v_inicio, 'MM/YYYY') || ' — ' || nome
      END,
      'Pendente',
      v_categoria,
      client_id,
      true
    FROM calculadas
    WHERE valor > 0
    -- Já existe mensalidade desta competência para este cliente: não é erro,
    -- é a segunda execução do mesmo mês.
    ON CONFLICT (client_id, competencia) WHERE is_mensalidade DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_criadas FROM inseridas;

  RETURN COALESCE(v_criadas, 0);
END;
$$;

COMMENT ON FUNCTION public.gerar_mensalidades(DATE) IS
  'Cria as mensalidades pendentes da competência informada e devolve quantas '
  'foram criadas. Nunca altera nem apaga lançamento existente.';

REVOKE ALL ON FUNCTION public.gerar_mensalidades(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_mensalidades(DATE) TO authenticated;

COMMIT;
