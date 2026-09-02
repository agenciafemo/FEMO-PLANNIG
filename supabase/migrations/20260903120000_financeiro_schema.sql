-- ============================================================================
-- MÓDULO FINANCEIRO — schema no banco do Norteia
-- ----------------------------------------------------------------------------
-- O FEMO FINANÇAS vive hoje num projeto Supabase separado (xgnqhaxwileijallnumb),
-- com o schema existindo APENAS no Lovable Cloud: não há migration nenhuma no
-- repositório dele. Duas consequências: não dá para recriar o banco, e não dá
-- para revisar uma mudança antes de aplicá-la.
--
-- Esta migration traz esse schema para o banco do Norteia (cdalntmqromwpnurdnle),
-- versionado, com multi-tenant e RLS iguais aos do resto do produto. O app
-- financeiro passa a apontar para cá; as telas continuam as mesmas por enquanto.
--
-- O QUE ESTA MIGRATION NÃO FAZ (de propósito):
--   • não move dados — a cópia é passo separado, para poder ser conferida;
--   • não mexe em `clients` do Norteia;
--   • não força ligação entre as duas carteiras. `clientes.client_id` é
--     NULLABLE: cliente financeiro sem correspondente no Norteia (histórico,
--     churn antigo, receita avulsa) continua existindo sozinho.
--
-- NÃO recria `user_roles` nem o enum `app_role`: os dois já existem no Norteia
-- com o mesmo papel, e o financeiro passa a usar os de lá.
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cargo_colaborador') THEN
    CREATE TYPE public.cargo_colaborador AS ENUM ('Social Media', 'Gestor de Tráfego', 'Outros', 'Líder');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_status') THEN
    CREATE TYPE public.client_status AS ENUM ('Ativo', 'Churn');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lancamento_tipo') THEN
    CREATE TYPE public.lancamento_tipo AS ENUM ('Entrada', 'Saída');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE public.payment_status AS ENUM ('Pago', 'Pendente', 'Inadimplente');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_entrega') THEN
    CREATE TYPE public.status_entrega AS ENUM ('Entregue no Prazo', 'Entregue com Atraso');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Tenancy automática
--
-- O app financeiro não conhece organização — ele nasceu para uma agência só e
-- não envia organization_id em nenhum insert. Exigir a coluna quebraria todas
-- as telas de uma vez.
--
-- Este trigger preenche a organização a partir de quem está escrevendo, e só
-- quando a pessoa pertence a exatamente UMA. Com duas ou mais, ele recusa em
-- vez de escolher: gravar dado financeiro na organização errada é pior que
-- falhar na cara do usuário.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fin_set_organization_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_qtd INT;
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT om.organization_id, count(*) OVER ()
    INTO v_org, v_qtd
    FROM public.organization_members om
   WHERE om.user_id = auth.uid()
     AND om.status = 'active'
   LIMIT 1;

  IF v_qtd IS NULL OR v_qtd = 0 THEN
    RAISE EXCEPTION 'Sem organização ativa para gravar este registro financeiro.';
  END IF;
  IF v_qtd > 1 THEN
    RAISE EXCEPTION 'Você pertence a mais de uma organização: informe organization_id explicitamente.';
  END IF;

  NEW.organization_id := v_org;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Tabelas
-- ---------------------------------------------------------------------------

-- Categorias de lançamento (Entrada / Saída / Ambos).
CREATE TABLE IF NOT EXISTS public.categorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  nome TEXT NOT NULL CHECK (btrim(nome) <> ''),
  tipo TEXT NOT NULL DEFAULT 'Ambos',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Funções de comissão personalizadas.
CREATE TABLE IF NOT EXISTS public.funcoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  nome TEXT NOT NULL CHECK (btrim(nome) <> ''),
  descricao TEXT,
  tipo_base TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Carteira do financeiro.
--
-- `client_id` é a ponte com a carteira do Norteia, e é OPCIONAL de propósito:
-- o financeiro guarda histórico que o Norteia nunca teve (cliente que saiu
-- antes do produto existir, receita avulsa). ON DELETE SET NULL porque apagar
-- um cliente no Norteia não pode levar junto o histórico de faturamento dele.
CREATE TABLE IF NOT EXISTS public.clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  nome TEXT NOT NULL CHECK (btrim(nome) <> ''),
  status public.client_status NOT NULL DEFAULT 'Ativo',
  data_entrada DATE NOT NULL,
  data_saida DATE,
  data_status_alterado TIMESTAMPTZ,
  data_aniversario DATE,
  valor_mensalidade NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_recorrente BOOLEAN NOT NULL DEFAULT true,
  dia_vencimento INTEGER NOT NULL DEFAULT 10 CHECK (dia_vencimento BETWEEN 1 AND 31),
  pct_social_media NUMERIC(6,3) NOT NULL DEFAULT 0,
  pct_trafego NUMERIC(6,3) NOT NULL DEFAULT 0,
  socios TEXT[] NOT NULL DEFAULT '{}',
  id_cliente_asaas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.clientes.client_id IS
  'Cliente correspondente no Norteia. NULL = existe só no financeiro.';

CREATE TABLE IF NOT EXISTS public.colaboradores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  nome TEXT NOT NULL CHECK (btrim(nome) <> ''),
  cargo public.cargo_colaborador NOT NULL DEFAULT 'Outros',
  salario_base NUMERIC(12,2) NOT NULL DEFAULT 0,
  data_entrada DATE NOT NULL,
  funcao_id UUID REFERENCES public.funcoes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O coração do fluxo de caixa.
CREATE TABLE IF NOT EXISTS public.lancamentos_financeiros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  tipo public.lancamento_tipo NOT NULL,
  valor NUMERIC(12,2) NOT NULL,
  data_lancamento DATE NOT NULL,
  descricao TEXT,
  status_pagamento public.payment_status NOT NULL DEFAULT 'Pendente',
  categoria_id UUID REFERENCES public.categorias(id) ON DELETE SET NULL,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  colaborador_id UUID REFERENCES public.colaboradores(id) ON DELETE SET NULL,
  -- Cobrança no Asaas
  id_cobranca_asaas TEXT,
  link_boleto TEXT,
  codigo_pix TEXT,
  -- Recorrência
  recorrencia_grupo_id UUID,
  recorrencia_ativa BOOLEAN NOT NULL DEFAULT false,
  recorrencia_indefinida BOOLEAN NOT NULL DEFAULT false,
  -- Estorno de comissão paga a mais
  is_clawback BOOLEAN NOT NULL DEFAULT false,
  origem_lancamento_id UUID REFERENCES public.lancamentos_financeiros(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Liga colaborador → cliente para o cálculo de comissão.
CREATE TABLE IF NOT EXISTS public.contratos_fatiamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  colaborador_id UUID NOT NULL REFERENCES public.colaboradores(id) ON DELETE CASCADE,
  valor_base_calculo NUMERIC(12,2) NOT NULL DEFAULT 0,
  status_entrega_mes_atual public.status_entrega NOT NULL DEFAULT 'Entregue no Prazo',
  prazo_entrega_planejamentos INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Faixas de meses × percentual. funcao_id NULL = tabela padrão.
CREATE TABLE IF NOT EXISTS public.tabela_progressiva_ltv (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  funcao_id UUID REFERENCES public.funcoes(id) ON DELETE CASCADE,
  meses_min INTEGER NOT NULL,
  meses_max INTEGER,
  percentual NUMERIC(6,3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (meses_max IS NULL OR meses_max >= meses_min)
);

CREATE TABLE IF NOT EXISTS public.recebimentos_extras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  colaborador_id UUID NOT NULL REFERENCES public.colaboradores(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  valor NUMERIC(12,2) NOT NULL,
  data_referencia DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Folha fechada por competência.
CREATE TABLE IF NOT EXISTS public.historico_folha_pagamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  colaborador_id UUID NOT NULL REFERENCES public.colaboradores(id) ON DELETE CASCADE,
  mes_competencia DATE NOT NULL,
  salario_base NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_comissoes NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_extras NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_descontos NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_liquido NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Sobrescreve o líquido calculado quando alguém fecha na mão.
  total_manual NUMERIC(12,2),
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (colaborador_id, mes_competencia)
);

CREATE TABLE IF NOT EXISTS public.pesos_comissao_folha (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  colaborador_id UUID NOT NULL REFERENCES public.colaboradores(id) ON DELETE CASCADE,
  mes_competencia DATE NOT NULL,
  peso NUMERIC(6,3) NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (colaborador_id, mes_competencia)
);

-- Configuração da agência. Uma linha por organização.
--
-- O app pede `id = 1`. A coluna continua existindo por compatibilidade, mas a
-- chave de verdade é a organização — sem isso, uma segunda agência
-- sobrescreveria as cores e os percentuais da primeira.
CREATE TABLE IF NOT EXISTS public.configuracoes (
  -- IDENTITY em vez de DEFAULT 1: com default fixo, a segunda organização
  -- colidiria na chave primária. Assim a primeira linha ainda pode ser gravada
  -- como id = 1 (que é o que o app pede hoje) e as seguintes se viram sozinhas.
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  organization_id UUID UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  cor_primaria TEXT NOT NULL DEFAULT '#0F766E',
  cor_secundaria TEXT NOT NULL DEFAULT '#F97316',
  cor_fundo TEXT NOT NULL DEFAULT '#0B0F14',
  logo_url TEXT,
  pct_rotativa NUMERIC(6,3) NOT NULL DEFAULT 50,
  pct_reserva NUMERIC(6,3) NOT NULL DEFAULT 50,
  pct_penalidade_atraso NUMERIC(6,3) NOT NULL DEFAULT 0,
  pct_penalidade_churn NUMERIC(6,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dashboard_anual (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  ano INTEGER NOT NULL,
  mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  receitas NUMERIC(12,2) NOT NULL DEFAULT 0,
  despesas NUMERIC(12,2) NOT NULL DEFAULT 0,
  retirada NUMERIC(12,2) NOT NULL DEFAULT 0,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, ano, mes)
);

-- CRM de social selling.
CREATE TABLE IF NOT EXISTS public.crm_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_name TEXT NOT NULL CHECK (btrim(lead_name) <> ''),
  clinic_name TEXT,
  phone TEXT,
  instagram TEXT,
  cdp_validated TEXT NOT NULL DEFAULT 'nao',
  current_stage INTEGER NOT NULL DEFAULT 1,
  response_status TEXT NOT NULL DEFAULT 'sem_resposta',
  referrals_count INTEGER NOT NULL DEFAULT 0,
  pain_identified TEXT,
  meeting_date TIMESTAMPTZ,
  last_action TEXT,
  general_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.checklist_prospeccao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  activity TEXT NOT NULL,
  meta TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4) Índices
--
-- Só o que as telas realmente consultam: fluxo por período, comissão por
-- colaborador, e a ponte com a carteira do Norteia.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS lancamentos_org_data_idx
  ON public.lancamentos_financeiros (organization_id, data_lancamento DESC);
CREATE INDEX IF NOT EXISTS lancamentos_cliente_idx
  ON public.lancamentos_financeiros (cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lancamentos_colaborador_idx
  ON public.lancamentos_financeiros (colaborador_id) WHERE colaborador_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lancamentos_recorrencia_idx
  ON public.lancamentos_financeiros (recorrencia_grupo_id) WHERE recorrencia_grupo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS clientes_org_status_idx
  ON public.clientes (organization_id, status);
CREATE INDEX IF NOT EXISTS clientes_client_id_idx
  ON public.clientes (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contratos_colaborador_idx
  ON public.contratos_fatiamento (colaborador_id);
CREATE INDEX IF NOT EXISTS folha_competencia_idx
  ON public.historico_folha_pagamento (organization_id, mes_competencia DESC);

-- ---------------------------------------------------------------------------
-- 5) Trigger de tenancy em todas as tabelas
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categorias', 'funcoes', 'clientes', 'colaboradores', 'lancamentos_financeiros',
    'contratos_fatiamento', 'tabela_progressiva_ltv', 'recebimentos_extras',
    'historico_folha_pagamento', 'pesos_comissao_folha', 'configuracoes',
    'dashboard_anual', 'crm_leads', 'checklist_prospeccao'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS fin_set_org ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER fin_set_org BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.fin_set_organization_id()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6) RLS
--
-- Mesma regra do resto do produto: membro da organização lê, quem pode editar
-- conteúdo escreve. Dado financeiro é sensível — quando existir a permissão
-- própria de "Financeiro", estas políticas passam a consultá-la; até lá,
-- seguem o padrão já em uso para não inventar uma terceira regra de acesso.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categorias', 'funcoes', 'clientes', 'colaboradores', 'lancamentos_financeiros',
    'contratos_fatiamento', 'tabela_progressiva_ltv', 'recebimentos_extras',
    'historico_folha_pagamento', 'pesos_comissao_folha', 'configuracoes',
    'dashboard_anual', 'crm_leads', 'checklist_prospeccao'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (public.is_org_member(organization_id))', t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (public.can_edit_org_content(organization_id))
         WITH CHECK (public.can_edit_org_content(organization_id))', t || '_write', t);

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7) O QUE FALTA, E POR QUE NÃO ESTÁ AQUI
--
-- A função `gerar_cobrancas_recorrentes(_mes text) RETURNS integer` existe no
-- banco antigo e é ela que cria as mensalidades do mês. O `types.ts` guarda só
-- a ASSINATURA — o corpo não está em lugar nenhum do repositório.
--
-- Reconstruí-la a partir da descrição em prosa seria adivinhar regra de
-- cobrança: quem é elegível, como o dia de vencimento cai em mês curto, como a
-- duplicidade é evitada. Errar qualquer uma delas gera cobrança a mais ou a
-- menos para cliente real. Fica de fora de propósito.
--
-- Para trazer a original, rode isto no SQL Editor do projeto ANTIGO
-- (xgnqhaxwileijallnumb) e me mande o resultado:
--
--   SELECT pg_get_functiondef(oid)
--     FROM pg_proc
--    WHERE proname = 'gerar_cobrancas_recorrentes';
--
-- O mesmo vale para qualquer trigger do banco antigo: o types.ts não os mostra.
--
--   SELECT event_object_table, trigger_name, action_statement
--     FROM information_schema.triggers
--    WHERE trigger_schema = 'public';
-- ---------------------------------------------------------------------------

COMMIT;
