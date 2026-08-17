-- ============================================================================
-- ESTÚDIO DE CONTEÚDO — BASE DE CONHECIMENTO POR CLIENTE (Fase 1)
--
-- Tabelas que a Edge Function generate-content consulta (server-side, via RLS)
-- para gerar copy/roteiros com contexto e compliance por cliente. Colunas
-- casam exatamente com os SELECTs da função.
--
--   client_content_profiles   -> perfil da marca (obrigatório p/ gerar)
--   client_knowledge_items     -> fatos/base de conhecimento (com fonte/validade)
--   client_content_claims      -> claims permitidos/proibidos (com status/fonte)
--   client_compliance_rules    -> regras (CFM etc.) com severidade block/warning
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- PERFIL DA MARCA (1 por cliente)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_content_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  brand_summary TEXT,
  segment TEXT,
  specialties TEXT[] NOT NULL DEFAULT '{}',
  positioning TEXT,
  differentiators TEXT[] NOT NULL DEFAULT '{}',
  location_scope TEXT,
  products_services TEXT[] NOT NULL DEFAULT '{}',
  personas TEXT[] NOT NULL DEFAULT '{}',
  audience_pains TEXT[] NOT NULL DEFAULT '{}',
  audience_desires TEXT[] NOT NULL DEFAULT '{}',
  audience_objections TEXT[] NOT NULL DEFAULT '{}',
  audience_language TEXT,
  sensitive_topics TEXT[] NOT NULL DEFAULT '{}',
  voice_personality TEXT,
  formality TEXT,
  preferred_words TEXT[] NOT NULL DEFAULT '{}',
  forbidden_words TEXT[] NOT NULL DEFAULT '{}',
  emoji_limit INTEGER,
  preferred_ctas TEXT[] NOT NULL DEFAULT '{}',
  forbidden_ctas TEXT[] NOT NULL DEFAULT '{}',
  mandatory_disclosures TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE (organization_id, client_id)
);

-- ---------------------------------------------------------------------------
-- BASE DE CONHECIMENTO (N por cliente)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_knowledge_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  item_type TEXT,
  title TEXT,
  content TEXT,
  source_url TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  effective_from DATE,
  effective_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS client_knowledge_items_client_idx
  ON public.client_knowledge_items (organization_id, client_id, status);

-- ---------------------------------------------------------------------------
-- CLAIMS (N por cliente): approved / prohibited / review_required
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_content_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  claim_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('approved', 'prohibited', 'review_required')),
  source_title TEXT,
  source_url TEXT,
  usage_notes TEXT,
  effective_from DATE,
  effective_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS client_content_claims_client_idx
  ON public.client_content_claims (organization_id, client_id);

-- ---------------------------------------------------------------------------
-- REGRAS DE COMPLIANCE (N; client_id NULL = regra global da org)
-- severity: block (absoluta) / warning (formulação conservadora) / info
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_compliance_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  segment TEXT,
  title TEXT,
  rule_text TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('block', 'warning', 'info')),
  channels TEXT[] NOT NULL DEFAULT '{}',
  source_title TEXT,
  source_url TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  effective_from DATE,
  effective_until DATE,
  exceptions TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS client_compliance_rules_scope_idx
  ON public.client_compliance_rules (organization_id, client_id, status);

-- ---------------------------------------------------------------------------
-- RLS: leitura p/ membro da org; escrita p/ editor (padrão do app).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'client_content_profiles',
    'client_knowledge_items',
    'client_content_claims',
    'client_compliance_rules'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated '
      'USING (public.is_org_member(organization_id, auth.uid()));', t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated '
      'USING (public.can_edit_org_content(organization_id, auth.uid())) '
      'WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()));', t, t);

    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated;', t);
  END LOOP;
END $$;

COMMIT;
