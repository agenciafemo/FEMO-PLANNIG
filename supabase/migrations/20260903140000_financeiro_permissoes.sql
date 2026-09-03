-- ============================================================================
-- FINANCEIRO: RESTRINGIR AO ADMINISTRATIVO
-- ----------------------------------------------------------------------------
-- CORREÇÃO DE ACESSO. As políticas criadas em 20260903120000 usam
-- `is_org_member` para leitura — ou seja, HOJE qualquer pessoa da organização
-- consegue ler salário, comissão, folha de pagamento e faturamento.
--
-- O financeiro é do administrativo. Esta migration troca as políticas das 14
-- tabelas para o sistema de permissões configuráveis que o produto já tem, em
-- vez de inventar uma terceira regra de acesso.
--
-- Duas chaves, porque ver e mexer são coisas diferentes: alguém do
-- administrativo pode precisar conferir o fluxo sem poder alterar a folha.
--
-- `default_roles` traz só 'admin' — 'owner' é piso implícito em
-- has_permission() e nunca perde acesso. Manager, editor e viewer ficam de
-- fora por padrão, e a agência libera caso a caso pela tela de permissões,
-- por cargo ou por pessoa.
--
-- Idempotente.
-- ============================================================================

BEGIN;

INSERT INTO public.permissions (key, category, label, description, default_roles, position) VALUES
  ('financeiro.ver', 'Financeiro', 'Ver o financeiro',
   'Abrir fluxo de caixa, mensalidades, folha de pagamento, comissões e os painéis financeiros. Inclui salário de colaborador.',
   ARRAY['admin'], 10),
  ('financeiro.editar', 'Financeiro', 'Editar o financeiro',
   'Lançar entradas e saídas, gerar mensalidades, fechar folha e alterar comissões e percentuais.',
   ARRAY['admin'], 20)
ON CONFLICT (key) DO UPDATE SET
  category      = EXCLUDED.category,
  label         = EXCLUDED.label,
  description   = EXCLUDED.description,
  default_roles = EXCLUDED.default_roles,
  position      = EXCLUDED.position;

-- ---------------------------------------------------------------------------
-- Troca das políticas nas 14 tabelas.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categorias', 'funcoes', 'client_financeiro', 'colaboradores',
    'lancamentos_financeiros', 'contratos_fatiamento', 'tabela_progressiva_ltv',
    'recebimentos_extras', 'historico_folha_pagamento', 'pesos_comissao_folha',
    'configuracoes_financeiro', 'dashboard_anual', 'crm_leads', 'checklist_prospeccao'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (public.has_permission(organization_id, ''financeiro.ver''))',
      t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (public.has_permission(organization_id, ''financeiro.editar''))
         WITH CHECK (public.has_permission(organization_id, ''financeiro.editar''))',
      t || '_write', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- A geração de mensalidades checava can_edit_org_content, que inclui editor —
-- quem produz conteúdo não emite cobrança.
-- ---------------------------------------------------------------------------
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

  IF NOT public.has_permission(v_org, 'financeiro.editar') THEN
    RAISE EXCEPTION 'Sem permissão para gerar mensalidades.';
  END IF;

  v_inicio := date_trunc('month', _competencia)::date;
  v_fim    := (v_inicio + INTERVAL '1 month' - INTERVAL '1 day')::date;
  v_dias   := EXTRACT(DAY FROM v_fim)::int;

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
      COALESCE(c.agency_since, v_inicio) AS entrada
    FROM public.client_financeiro cf
    JOIN public.clients c ON c.id = cf.client_id
    WHERE cf.organization_id = v_org
      AND cf.status = 'Ativo'
      AND cf.is_recorrente
      AND cf.valor_mensalidade > 0
      AND COALESCE(c.agency_since, v_inicio) <= v_fim
      AND (cf.data_saida IS NULL OR cf.data_saida >= v_inicio)
  ),
  calculadas AS (
    SELECT
      client_id,
      nome,
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
    ON CONFLICT (client_id, competencia) WHERE is_mensalidade DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_criadas FROM inseridas;

  RETURN COALESCE(v_criadas, 0);
END;
$$;

-- Recriar função descarta privilégios: o GRANT vem junto, sempre.
REVOKE ALL ON FUNCTION public.gerar_mensalidades(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_mensalidades(DATE) TO authenticated;

COMMIT;
