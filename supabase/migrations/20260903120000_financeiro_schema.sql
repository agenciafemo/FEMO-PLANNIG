-- ============================================================================
-- MÓDULO FINANCEIRO — criação do schema no banco do Norteia
-- ----------------------------------------------------------------------------
-- O FEMO FINANÇAS é hoje só um front gerado pelo Lovable: nunca foi instalado
-- (não há node_modules), o banco que o .env aponta não existe, e não há
-- migration nem dado em lugar nenhum. Isso é uma boa notícia — não há nada
-- para migrar, e dá para desenhar certo de primeira.
--
-- DECISÃO CENTRAL: não existe tabela `clientes` paralela.
--
-- O rascunho do Lovable trazia uma carteira própria, que criaria duas listas de
-- cliente divergindo em silêncio — o problema que motivou juntar os dois
-- produtos. Aqui a carteira é a do Norteia (`clients`), e o financeiro
-- acrescenta os campos que só ele conhece, numa tabela 1:1.
--
-- O que já existe em `clients` NÃO é repetido:
--   • data de entrada  → clients.agency_since
--   • segmento         → clients.segment
--   • nome, logo, cor  → clients.*
--
-- NÃO recria `user_roles` nem o enum `app_role`: já existem no Norteia com o
-- mesmo papel.
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
-- O front financeiro não conhece organização e não envia organization_id em
-- nenhum insert. Este trigger preenche a partir de quem está escrevendo, e só
-- quando a pessoa pertence a exatamente UMA organização. Com duas ou mais ele
-- RECUSA em vez de escolher: gravar dado financeiro na organização errada é
-- pior que falhar na cara do usuário.
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
  tipo TEXT NOT NULL DEFAULT 'Ambos' CHECK (tipo IN ('Entrada', 'Saída', 'Ambos')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, nome)
);

-- Funções de comissão personalizadas.
CREATE TABLE IF NOT EXISTS public.funcoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  nome TEXT NOT NULL CHECK (btrim(nome) <> ''),
  descricao TEXT,
  tipo_base TEXT NOT NULL CHECK (tipo_base IN ('fatia_social_media', 'fatia_trafego', 'valor_total')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O lado financeiro de um cliente que já existe no Norteia.
--
-- A chave primária É o client_id: um cliente tem no máximo uma ficha
-- financeira, e ela deixa de existir junto com ele. Cliente sem linha aqui é
-- simplesmente um cliente que ninguém cadastrou no financeiro ainda.
CREATE TABLE IF NOT EXISTS public.client_financeiro (
  client_id UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Situação comercial. Fica aqui por ora; quando o Norteia quiser esconder
  -- cliente encerrado do quadro de planejamento, isto sobe para `clients`.
  status public.client_status NOT NULL DEFAULT 'Ativo',
  data_saida DATE,
  data_status_alterado TIMESTAMPTZ,
  data_aniversario DATE,
  -- Mensalidade
  valor_mensalidade NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor_mensalidade >= 0),
  is_recorrente BOOLEAN NOT NULL DEFAULT true,
  dia_vencimento INTEGER NOT NULL DEFAULT 10 CHECK (dia_vencimento BETWEEN 1 AND 31),
  -- Fatias que servem de base para comissão
  pct_social_media NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (pct_social_media BETWEEN 0 AND 100),
  pct_trafego NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (pct_trafego BETWEEN 0 AND 100),
  socios TEXT[] NOT NULL DEFAULT '{}',
  id_cliente_asaas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.client_financeiro IS
  'Lado financeiro de um cliente do Norteia. A data de entrada não é repetida '
  'aqui: ela é clients.agency_since, e é dela que sai o tempo de casa usado no '
  'cálculo de comissão progressiva.';

CREATE TABLE IF NOT EXISTS public.colaboradores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Pessoa da equipe no Norteia, quando houver. NULL = colaborador que só
  -- existe na folha (prestador, alguém que saiu antes de ter conta).
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
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
  -- Aponta direto para a carteira do Norteia. ON DELETE SET NULL: apagar um
  -- cliente não pode apagar o histórico de dinheiro que entrou por ele.
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
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
  -- Mensalidade gerada pela rotina mensal, e não lançamento avulso. Separar os
  -- dois é o que permite o índice único abaixo garantir "uma por cliente por
  -- mês" sem impedir que alguém lance uma segunda entrada do mesmo cliente.
  is_mensalidade BOOLEAN NOT NULL DEFAULT false,
  -- Mês a que a cobrança se refere, derivado do vencimento. Coluna gerada para
  -- poder entrar no índice único — a regra vive no banco, não na função que
  -- gera. Função esquece de conferir; índice não.
  competencia DATE GENERATED ALWAYS AS (date_trunc('month', data_lancamento)::date) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma cobrança do Asaas não pode virar dois lançamentos.
CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_cobranca_asaas_key
  ON public.lancamentos_financeiros (id_cobranca_asaas)
  WHERE id_cobranca_asaas IS NOT NULL;

-- Um cliente não pode receber duas mensalidades da mesma competência. Rodar a
-- geração duas vezes no mesmo mês passa a ser inofensivo por construção.
CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_mensalidade_unica
  ON public.lancamentos_financeiros (client_id, competencia)
  WHERE is_mensalidade;

-- Liga colaborador → cliente para o cálculo de comissão.
CREATE TABLE IF NOT EXISTS public.contratos_fatiamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  colaborador_id UUID NOT NULL REFERENCES public.colaboradores(id) ON DELETE CASCADE,
  valor_base_calculo NUMERIC(12,2) NOT NULL DEFAULT 0,
  status_entrega_mes_atual public.status_entrega NOT NULL DEFAULT 'Entregue no Prazo',
  prazo_entrega_planejamentos INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, colaborador_id)
);

-- Faixas de meses × percentual. funcao_id NULL = tabela padrão.
CREATE TABLE IF NOT EXISTS public.tabela_progressiva_ltv (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  funcao_id UUID REFERENCES public.funcoes(id) ON DELETE CASCADE,
  meses_min INTEGER NOT NULL CHECK (meses_min >= 0),
  meses_max INTEGER,
  percentual NUMERIC(6,3) NOT NULL CHECK (percentual >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (meses_max IS NULL OR meses_max >= meses_min)
);

CREATE TABLE IF NOT EXISTS public.recebimentos_extras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  colaborador_id UUID NOT NULL REFERENCES public.colaboradores(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL CHECK (btrim(descricao) <> ''),
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
  peso NUMERIC(6,3) NOT NULL DEFAULT 100 CHECK (peso BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (colaborador_id, mes_competencia)
);

-- Configuração financeira da agência: uma linha por organização.
--
-- A chave é a organização, não um `id = 1` fixo como no rascunho — com default
-- fixo, a segunda agência colidiria na chave primária.
CREATE TABLE IF NOT EXISTS public.configuracoes_financeiro (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  pct_rotativa NUMERIC(6,3) NOT NULL DEFAULT 50,
  pct_reserva NUMERIC(6,3) NOT NULL DEFAULT 50,
  pct_penalidade_atraso NUMERIC(6,3) NOT NULL DEFAULT 0,
  pct_penalidade_churn NUMERIC(6,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A distribuição do lucro precisa fechar em 100%: sem isto, sobra ou falta
  -- dinheiro na conta e ninguém percebe até o fim do mês.
  CHECK (pct_rotativa + pct_reserva = 100)
);

COMMENT ON TABLE public.configuracoes_financeiro IS
  'Só o que é financeiro. Cores e logo do rascunho ficaram de fora: a '
  'identidade visual já é do Norteia, e duplicá-la criaria dois lugares para '
  'trocar a mesma logo.';

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
  current_stage INTEGER NOT NULL DEFAULT 1 CHECK (current_stage BETWEEN 1 AND 8),
  response_status TEXT NOT NULL DEFAULT 'sem_resposta',
  referrals_count INTEGER NOT NULL DEFAULT 0,
  pain_identified TEXT,
  meeting_date TIMESTAMPTZ,
  last_action TEXT,
  general_notes TEXT,
  -- Lead que virou cliente. Fecha o funil: dá para medir quanto do faturamento
  -- veio de prospecção sem ninguém cruzar planilha na mão.
  converted_client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.checklist_prospeccao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  activity TEXT NOT NULL CHECK (btrim(activity) <> ''),
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
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS lancamentos_org_data_idx
  ON public.lancamentos_financeiros (organization_id, data_lancamento DESC);
CREATE INDEX IF NOT EXISTS lancamentos_client_idx
  ON public.lancamentos_financeiros (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lancamentos_colaborador_idx
  ON public.lancamentos_financeiros (colaborador_id) WHERE colaborador_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lancamentos_recorrencia_idx
  ON public.lancamentos_financeiros (recorrencia_grupo_id) WHERE recorrencia_grupo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_financeiro_org_status_idx
  ON public.client_financeiro (organization_id, status);
CREATE INDEX IF NOT EXISTS contratos_colaborador_idx
  ON public.contratos_fatiamento (colaborador_id);
CREATE INDEX IF NOT EXISTS folha_competencia_idx
  ON public.historico_folha_pagamento (organization_id, mes_competencia DESC);
CREATE INDEX IF NOT EXISTS crm_leads_org_stage_idx
  ON public.crm_leads (organization_id, current_stage);

-- ---------------------------------------------------------------------------
-- 5) updated_at e tenancy
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  com_updated TEXT[] := ARRAY[
    'funcoes', 'client_financeiro', 'colaboradores', 'lancamentos_financeiros',
    'tabela_progressiva_ltv', 'historico_folha_pagamento', 'pesos_comissao_folha',
    'configuracoes_financeiro', 'dashboard_anual', 'crm_leads', 'checklist_prospeccao'
  ];
  com_org TEXT[] := ARRAY[
    'categorias', 'funcoes', 'client_financeiro', 'colaboradores',
    'lancamentos_financeiros', 'contratos_fatiamento', 'tabela_progressiva_ltv',
    'recebimentos_extras', 'historico_folha_pagamento', 'pesos_comissao_folha',
    'dashboard_anual', 'crm_leads', 'checklist_prospeccao'
  ];
BEGIN
  FOREACH t IN ARRAY com_updated LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS fin_set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER fin_set_updated_at BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
  END LOOP;

  -- configuracoes_financeiro tem a organização como chave primária: o trigger
  -- de tenancy não se aplica, quem insere já sabe de quem é a configuração.
  FOREACH t IN ARRAY com_org LOOP
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
-- própria de "Financeiro", estas políticas passam a consultá-la. Até lá,
-- seguem o padrão em uso, para não inventar uma terceira regra de acesso.
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
-- 7) O QUE FALTA
--
-- A geração das mensalidades do mês (`gerar_cobrancas_recorrentes` no rascunho)
-- NÃO entra aqui. Ela nunca existiu de verdade — o banco nunca foi criado — e
-- escrevê-la agora é decidir regra de cobrança: quem é elegível, o que fazer
-- quando o dia de vencimento não existe no mês, como garantir uma cobrança por
-- cliente por mês. Isso vai em migration própria, depois de confirmadas as
-- regras com quem cobra.
-- ---------------------------------------------------------------------------

COMMIT;
