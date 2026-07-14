-- ============================================================================
-- LIMITE DE CLIENTES POR ORGANIZAÇÃO (Norteia beta) — organizations.client_limit
--
-- ⚠️ NÃO APLICADA. Rascunho para revisão. Migration NOVA e independente:
--    não altera nenhuma migration já aplicada, não toca dados existentes,
--    não mexe em RLS, Cofre, portal público, Dashboard ou PlanningDetail.
--
-- Regra: organizações NOVAS (criadas depois desta migration) podem cadastrar
-- no máximo 5 clientes. A FEMO e TODAS as organizações já existentes ficam com
-- client_limit = NULL = ILIMITADO (não são afetadas).
--
-- Ordem de deploy: aplicar esta migration ANTES de subir o frontend que lê
-- organizations.client_limit (senão o select quebra onde a coluna não existe).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (1) Coluna SEM default → todas as linhas EXISTENTES ficam NULL (ilimitado).
--     CUIDADO OBRIGATÓRIO: NUNCA usar
--         ALTER TABLE ... ADD COLUMN client_limit integer DEFAULT 5;
--     porque isso preencheria as linhas existentes (inclusive a FEMO, que já
--     tem >5 clientes) com 5, limitando quem não deve ser limitado.
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations ADD COLUMN client_limit integer;

-- Sanidade: ou é ilimitado (NULL) ou é um inteiro não-negativo.
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_client_limit_positive
  CHECK (client_limit IS NULL OR client_limit >= 0);

COMMENT ON COLUMN public.organizations.client_limit IS
  'Máximo de clientes que a organização pode cadastrar. NULL = ilimitado (FEMO e orgs criadas antes desta migration). Orgs criadas depois recebem 5 pelo DEFAULT.';

-- ---------------------------------------------------------------------------
-- (2) Só organizações NOVAS recebem 5. O DEFAULT vale para INSERTs FUTUROS e
--     NÃO altera nenhuma linha existente. A RPC create_organization insere sem
--     informar client_limit, portanto herda este default automaticamente.
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations ALTER COLUMN client_limit SET DEFAULT 5;

-- ---------------------------------------------------------------------------
-- (3) Proteção real no banco: trigger BEFORE INSERT em public.clients.
--     Dispara em QUALQUER caminho de INSERT (frontend, API REST/PostgREST,
--     script) — o 6º cliente é barrado no banco, não apenas na UI.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_client_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER          -- conta TODOS os clientes da org ignorando RLS
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_count integer;
BEGIN
  -- organization_id é NOT NULL em clients; guarda defensiva mesmo assim.
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT client_limit INTO v_limit
  FROM public.organizations
  WHERE id = NEW.organization_id;

  -- NULL = ilimitado (FEMO / organizações antigas): não bloqueia.
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serializa inserts concorrentes da MESMA organização, evitando a corrida em
  -- que dois inserts simultâneos passam na contagem e criam o 6º. Lock por
  -- transação (liberado no COMMIT/ROLLBACK). hashtext(int4) -> bigint do lock.
  PERFORM pg_advisory_xact_lock(hashtext('client_limit:' || NEW.organization_id::text));

  SELECT count(*) INTO v_count
  FROM public.clients
  WHERE organization_id = NEW.organization_id;

  IF v_count >= v_limit THEN
    -- Erro CLARO e IDENTIFICÁVEL:
    --   - prefixo textual 'client_limit_reached' (o frontend casa por isso)
    --   - ERRCODE check_violation (SQLSTATE 23514)
    -- O frontend traduz para a mensagem beta aprovada; não exibe este texto cru.
    RAISE EXCEPTION 'client_limit_reached: a organização atingiu o limite de % clientes.', v_limit
      USING ERRCODE = 'check_violation',
            HINT = 'Norteia beta: novas equipes podem cadastrar ate 5 clientes.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_client_limit() FROM PUBLIC;
-- Supabase concede EXECUTE a anon por DEFAULT PRIVILEGES; REVOKE FROM PUBLIC não
-- remove esse grant explícito. Removemos anon também (mesma lição da M3). É uma
-- trigger function: não deve ser chamável diretamente por ninguém via API.
REVOKE EXECUTE ON FUNCTION public.enforce_client_limit() FROM anon;

CREATE TRIGGER enforce_client_limit
BEFORE INSERT ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.enforce_client_limit();

COMMIT;

-- ============================================================================
-- VALIDAÇÃO PÓS-APLICAÇÃO (rodar manualmente no staging; não faz parte do DDL):
--
--   -- FEMO e orgs existentes ilimitadas:
--   SELECT name, client_limit FROM public.organizations ORDER BY name;   -- NULL
--
--   -- Org nova herda 5:
--   SELECT public.create_organization('Teste Limite','teste-limite-'||floor(random()*1e6)::int);
--   SELECT name, client_limit FROM public.organizations WHERE slug LIKE 'teste-limite-%';  -- 5
--
--   -- 6º cliente barrado (após inserir 5 na org nova):
--   --   RAISE 'client_limit_reached: ...'  (SQLSTATE 23514)
--
--   -- FEMO segue criando clientes acima de 5 (ela é NULL).
-- ============================================================================
