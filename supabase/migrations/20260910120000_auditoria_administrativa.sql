-- ============================================================================
-- MOVIMENTAÇÕES: quem mexeu no quê, dentro do Administrativo.
--
-- O painel já diz quem PODE ver cada área, mas não guarda o que cada um FAZ.
-- Numa conferência de folha ou de fluxo, a pergunta que aparece é "quem mudou
-- isto?" — e hoje a resposta não existe em lugar nenhum.
--
-- O registro é feito por GATILHO, não pela tela. Se dependesse do frontend,
-- qualquer alteração feita por fora dele (SQL direto, outra tela, uma função)
-- sumiria do histórico — e histórico com buraco é pior que nenhum, porque se
-- confia nele.
--
-- ESCOPO: só o financeiro. A área de Clientes fica de fora de propósito: é
-- operacional, a equipe inteira usa, e encher o log com isso afogaria o que
-- importa.
--
-- NÃO guarda valor antigo nem novo — só quem, quando e o quê. Guardar salário
-- e valor de contrato aqui criaria uma segunda cópia de dado sensível, com o
-- risco de vazar por um caminho que ninguém lembrou de proteger.
--
-- Vale a partir de AGORA: não há histórico anterior para recuperar, e inventar
-- um a partir de `updated_at` daria uma linha por registro, sem autor, com
-- cara de histórico completo.
--
-- Idempotente.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.auditoria_administrativa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- ON DELETE SET NULL: remover uma pessoa não pode apagar o que ela fez — é
  -- justamente o histórico que se quer preservar.
  autor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Nome no momento da ação: a pessoa pode sair da equipe ou trocar de nome, e
  -- a linha tem que continuar legível anos depois.
  autor_nome TEXT,
  acao TEXT NOT NULL CHECK (acao IN ('criou', 'alterou', 'removeu')),
  -- Rótulo legível do que foi mexido: "Lançamento", "Colaborador"…
  entidade TEXT NOT NULL,
  -- Como o registro se chamava, para a linha fazer sentido sozinha.
  registro_descricao TEXT,
  registro_id UUID,
  tabela TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.auditoria_administrativa IS
  'Movimentações do Administrativo: quem alterou o quê e quando. Sem valores, sem a área de Clientes.';

-- A consulta da tela é sempre "desta organização, mais recentes primeiro".
CREATE INDEX IF NOT EXISTS auditoria_administrativa_org_data_idx
  ON public.auditoria_administrativa (organization_id, criado_em DESC);

-- ---------------------------------------------------------------------------
-- O gatilho.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_movimentacao_administrativa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linha     JSONB;
  v_org       UUID;
  v_acao      TEXT;
  v_descricao TEXT;
  v_autor     UUID := auth.uid();
  v_nome      TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_linha := to_jsonb(OLD);
    v_acao := 'removeu';
  ELSIF TG_OP = 'UPDATE' THEN
    v_linha := to_jsonb(NEW);
    v_acao := 'alterou';
  ELSE
    v_linha := to_jsonb(NEW);
    v_acao := 'criou';
  END IF;

  v_org := NULLIF(v_linha ->> 'organization_id', '')::UUID;
  -- Sem organização não há a quem mostrar a linha, e a coluna é NOT NULL.
  -- Acontece em registro antigo sem o campo: melhor não registrar do que
  -- derrubar a operação de quem está salvando.
  IF v_org IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- TG_ARGV[1] é a coluna que dá nome ao registro; nem toda tabela tem uma.
  IF TG_ARGV[1] IS NOT NULL AND TG_ARGV[1] <> '' THEN
    v_descricao := NULLIF(btrim(v_linha ->> TG_ARGV[1]), '');
  END IF;

  SELECT p.full_name INTO v_nome FROM public.profiles p WHERE p.id = v_autor;

  INSERT INTO public.auditoria_administrativa (
    organization_id, autor_id, autor_nome, acao, entidade,
    registro_descricao, registro_id, tabela
  ) VALUES (
    v_org, v_autor, v_nome, v_acao, TG_ARGV[0],
    v_descricao, NULLIF(v_linha ->> 'id', '')::UUID, TG_TABLE_NAME
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Registrar importa, mas nunca ao ponto de impedir alguém de lançar uma
  -- despesa. Falha no log não derruba a operação.
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ---------------------------------------------------------------------------
-- Onde observar. Só financeiro — Clientes fica fora, é operacional.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  alvo RECORD;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('lancamentos_financeiros',   'Lançamento',           'descricao'),
      ('colaboradores',             'Colaborador',          'nome'),
      ('client_financeiro',         'Ficha financeira',     ''),
      ('contratos_fatiamento',      'Contrato de comissão', ''),
      ('categorias',                'Categoria',            'nome'),
      ('funcoes',                   'Função de comissão',   'nome'),
      ('tabela_progressiva_ltv',    'Tabela de LTV',        ''),
      ('recebimentos_extras',       'Recebimento extra',    'descricao'),
      ('historico_folha_pagamento', 'Folha de pagamento',   ''),
      ('pesos_comissao_folha',      'Peso de comissão',     ''),
      ('configuracoes_financeiro',  'Configuração',         '')
    ) AS t(tabela, rotulo, coluna_nome)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS auditar_%1$s ON public.%1$I', alvo.tabela);
    EXECUTE format(
      'CREATE TRIGGER auditar_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION
         public.registrar_movimentacao_administrativa(%2$L, %3$L)',
      alvo.tabela, alvo.rotulo, alvo.coluna_nome
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Quem lê. Mesma fronteira do financeiro.
-- ---------------------------------------------------------------------------
ALTER TABLE public.auditoria_administrativa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auditoria_administrativa_select ON public.auditoria_administrativa;
CREATE POLICY auditoria_administrativa_select
  ON public.auditoria_administrativa FOR SELECT TO authenticated
  USING (public.has_permission(organization_id, 'financeiro.ver'));

-- Ninguém escreve à mão: só o gatilho, que roda como SECURITY DEFINER. Log que
-- a aplicação pode editar não serve como prova de nada.
REVOKE ALL ON TABLE public.auditoria_administrativa FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.auditoria_administrativa TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
