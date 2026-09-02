-- ============================================================================
-- Permissoes configuraveis pelo app.
--
-- O PROBLEMA:
-- Hoje a permissao mora no SQL: 36 policies repetem `get_org_role(...) IN
-- ('owner','admin','manager')`, e as excecoes sao casadas por NOME de tag com
-- ILIKE '%trafego%' / '%social%'. Isso funciona para a FEMO e nao sobrevive a
-- segunda agencia, que nao vai ter cargo chamado "Head" nem "Social Midia".
--
-- O DESENHO:
--   permissions                     catalogo do produto (o que existe)
--   organization_role_permissions   o que a organizacao mudou por CARGO
--   organization_member_permissions o que ela mudou para UMA PESSOA
--
-- As duas ultimas guardam so DESVIOS. Organizacao que nunca mexeu em nada nao
-- tem uma linha sequer, e organizacao nova ja nasce funcionando — nao existe
-- semeadura para esquecer de rodar. Foi de proposito: seed por organizacao e
-- exatamente o tipo de passo manual que este projeto ja esqueceu antes.
--
-- has_permission() decide nesta ordem:
--   1. owner sempre pode (piso — senao da para se trancar para fora)
--   2. excecao da pessoa, se houver
--   3. excecao do cargo, se houver
--   4. o padrao do catalogo
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Catalogo. Global, nao por organizacao: e o produto que define o que existe.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permissions (
  key           TEXT PRIMARY KEY,
  category      TEXT NOT NULL,
  label         TEXT NOT NULL,
  description   TEXT NOT NULL,
  -- Quem pode, quando a organizacao nao mudou nada. 'owner' fica implicito.
  default_roles TEXT[] NOT NULL DEFAULT '{}',
  position      INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.permissions IS
  'Catalogo de permissoes do produto. So entra aqui o que ALGUMA policy checa de verdade — chave sem policy vira interruptor que nao faz nada.';

-- ---------------------------------------------------------------------------
-- Desvios por cargo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_role_permissions (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  permission_key  TEXT NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  allowed         BOOLEAN NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (organization_id, role, permission_key)
);

-- ---------------------------------------------------------------------------
-- Desvios por pessoa. Substitui o casamento por nome de tag: a excecao passa a
-- ser uma escolha explicita, nao um efeito colateral de como a tag foi escrita.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_member_permissions (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission_key  TEXT NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  allowed         BOOLEAN NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (organization_id, user_id, permission_key)
);

-- ---------------------------------------------------------------------------
-- A decisao.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(
  _organization_id UUID,
  _key TEXT,
  _user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT public.is_org_member(_organization_id, _user_id) THEN FALSE
    -- Piso: o dono nunca perde acesso, por mais que mexam nos interruptores.
    WHEN public.get_org_role(_organization_id, _user_id)::TEXT = 'owner' THEN TRUE
    ELSE COALESCE(
      (SELECT mp.allowed
         FROM public.organization_member_permissions mp
        WHERE mp.organization_id = _organization_id
          AND mp.user_id = _user_id
          AND mp.permission_key = _key),
      (SELECT rp.allowed
         FROM public.organization_role_permissions rp
        WHERE rp.organization_id = _organization_id
          AND rp.permission_key = _key
          AND rp.role = public.get_org_role(_organization_id, _user_id)::TEXT),
      (SELECT public.get_org_role(_organization_id, _user_id)::TEXT = ANY(p.default_roles)
         FROM public.permissions p
        WHERE p.key = _key),
      FALSE
    )
  END
$$;

-- Funcao NOVA: o GRANT tem que vir junto. Recriar funcao descarta privilegios,
-- e foi isso que derrubou o OAuth da Meta em producao esta semana.
REVOKE ALL ON FUNCTION public.has_permission(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS. Todo membro LE (a tela precisa mostrar quem pode o que); so quem
-- administra a equipe ESCREVE.
-- ---------------------------------------------------------------------------
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_member_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS permissions_read ON public.permissions;
CREATE POLICY permissions_read ON public.permissions
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS org_role_permissions_read ON public.organization_role_permissions;
CREATE POLICY org_role_permissions_read ON public.organization_role_permissions
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS org_role_permissions_write ON public.organization_role_permissions;
CREATE POLICY org_role_permissions_write ON public.organization_role_permissions
  FOR ALL TO authenticated
  USING (public.get_org_role(organization_id, auth.uid())::TEXT IN ('owner', 'admin'))
  WITH CHECK (public.get_org_role(organization_id, auth.uid())::TEXT IN ('owner', 'admin'));

DROP POLICY IF EXISTS org_member_permissions_read ON public.organization_member_permissions;
CREATE POLICY org_member_permissions_read ON public.organization_member_permissions
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS org_member_permissions_write ON public.organization_member_permissions;
CREATE POLICY org_member_permissions_write ON public.organization_member_permissions
  FOR ALL TO authenticated
  USING (public.get_org_role(organization_id, auth.uid())::TEXT IN ('owner', 'admin'))
  WITH CHECK (public.get_org_role(organization_id, auth.uid())::TEXT IN ('owner', 'admin'));

GRANT SELECT ON public.permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_role_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_member_permissions TO authenticated;
REVOKE ALL ON public.permissions FROM anon;
REVOKE ALL ON public.organization_role_permissions FROM anon;
REVOKE ALL ON public.organization_member_permissions FROM anon;

-- ---------------------------------------------------------------------------
-- O catalogo inicial. SO as chaves que ja sao verificadas de verdade nesta
-- mesma leva — interruptor que nao faz nada e pior que interruptor nenhum.
--
-- Os default_roles reproduzem EXATAMENTE o comportamento de hoje, para que
-- ninguem ganhe nem perca acesso no dia da virada.
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (key, category, label, description, default_roles, position) VALUES
  ('plannings.create', 'Planejamento', 'Criar planejamento',
   'Criar o planejamento do mes de um cliente.',
   ARRAY['admin','manager','editor'], 10),
  ('plannings.update', 'Planejamento', 'Editar planejamento',
   'Alterar mes, ano e quantidade de pecas de um planejamento existente.',
   ARRAY['admin','manager','editor'], 20),
  ('plannings.delete', 'Planejamento', 'Excluir planejamento',
   'Apagar um planejamento. Leva junto os posts, roteiros, itens de producao e respostas de NPS ligados a ele.',
   ARRAY['admin','manager'], 30)
ON CONFLICT (key) DO UPDATE SET
  category      = EXCLUDED.category,
  label         = EXCLUDED.label,
  description   = EXCLUDED.description,
  default_roles = EXCLUDED.default_roles,
  position      = EXCLUDED.position;

COMMIT;
