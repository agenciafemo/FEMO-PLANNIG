BEGIN;

-- Base estruturada usada futuramente pelo Estudio de Conteudo. Esta migration
-- nao cria geracao por IA, embeddings ou armazenamento de arquivos.

CREATE TABLE public.client_content_profiles (
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
  formality TEXT NOT NULL DEFAULT 'balanced'
    CHECK (formality IN ('casual', 'balanced', 'formal')),
  preferred_words TEXT[] NOT NULL DEFAULT '{}',
  forbidden_words TEXT[] NOT NULL DEFAULT '{}',
  emoji_limit INTEGER NOT NULL DEFAULT 2 CHECK (emoji_limit BETWEEN 0 AND 20),
  preferred_ctas TEXT[] NOT NULL DEFAULT '{}',
  forbidden_ctas TEXT[] NOT NULL DEFAULT '{}',
  mandatory_disclosures TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  updated_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_content_profiles_org_client_key UNIQUE (organization_id, client_id),
  CONSTRAINT client_content_profiles_summary_length CHECK (brand_summary IS NULL OR char_length(brand_summary) <= 10000),
  CONSTRAINT client_content_profiles_notes_length CHECK (notes IS NULL OR char_length(notes) <= 10000)
);

COMMENT ON TABLE public.client_content_profiles IS
  'Dossie editorial estruturado por cliente: identidade, publico e voz da marca.';

CREATE TABLE public.client_knowledge_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN (
    'briefing', 'product_service', 'faq', 'regulation', 'reference',
    'approved_example', 'rejected_example'
  )),
  title TEXT NOT NULL CHECK (btrim(title) <> '' AND char_length(btrim(title)) <= 180),
  content TEXT NOT NULL CHECK (btrim(content) <> '' AND char_length(content) <= 30000),
  source_url TEXT CHECK (
    source_url IS NULL OR (char_length(source_url) <= 2000 AND source_url ~* '^https?://')
  ),
  tags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  effective_from DATE,
  effective_until DATE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  updated_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_knowledge_items_valid_period CHECK (
    effective_until IS NULL OR effective_from IS NULL OR effective_until >= effective_from
  )
);

COMMENT ON TABLE public.client_knowledge_items IS
  'Briefings, referencias, FAQs, regulamentos e exemplos editoriais aprovados ou rejeitados.';

CREATE TABLE public.client_content_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  claim_text TEXT NOT NULL CHECK (btrim(claim_text) <> '' AND char_length(claim_text) <= 5000),
  status TEXT NOT NULL CHECK (status IN ('approved', 'prohibited', 'review_required')),
  source_title TEXT CHECK (source_title IS NULL OR char_length(source_title) <= 300),
  source_url TEXT CHECK (
    source_url IS NULL OR (char_length(source_url) <= 2000 AND source_url ~* '^https?://')
  ),
  usage_notes TEXT CHECK (usage_notes IS NULL OR char_length(usage_notes) <= 5000),
  effective_from DATE,
  effective_until DATE,
  approved_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  updated_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_content_claims_valid_period CHECK (
    effective_until IS NULL OR effective_from IS NULL OR effective_until >= effective_from
  )
);

COMMENT ON TABLE public.client_content_claims IS
  'Afirmacoes factuais classificadas para impedir que futuras geracoes inventem ou usem claims proibidos.';

CREATE TABLE public.client_compliance_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  segment TEXT,
  title TEXT NOT NULL CHECK (btrim(title) <> '' AND char_length(btrim(title)) <= 180),
  rule_text TEXT NOT NULL CHECK (btrim(rule_text) <> '' AND char_length(rule_text) <= 10000),
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'block')),
  channels TEXT[] NOT NULL DEFAULT '{}',
  source_title TEXT CHECK (source_title IS NULL OR char_length(source_title) <= 300),
  source_url TEXT CHECK (
    source_url IS NULL OR (char_length(source_url) <= 2000 AND source_url ~* '^https?://')
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  effective_from DATE,
  effective_until DATE,
  exceptions TEXT CHECK (exceptions IS NULL OR char_length(exceptions) <= 5000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  updated_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_compliance_rules_valid_period CHECK (
    effective_until IS NULL OR effective_from IS NULL OR effective_until >= effective_from
  )
);

COMMENT ON TABLE public.client_compliance_rules IS
  'Regras editoriais e regulatorias versionadas; client_id nulo representa regra geral da organizacao/segmento.';

CREATE INDEX client_content_profiles_org_client_idx
  ON public.client_content_profiles (organization_id, client_id);
CREATE INDEX client_knowledge_items_org_client_status_idx
  ON public.client_knowledge_items (organization_id, client_id, status, updated_at DESC);
CREATE INDEX client_content_claims_org_client_status_idx
  ON public.client_content_claims (organization_id, client_id, status, updated_at DESC);
CREATE INDEX client_compliance_rules_org_client_status_idx
  ON public.client_compliance_rules (organization_id, client_id, status, updated_at DESC);
CREATE INDEX client_compliance_rules_org_segment_idx
  ON public.client_compliance_rules (organization_id, segment)
  WHERE segment IS NOT NULL;

CREATE TRIGGER update_client_content_profiles_updated_at
BEFORE UPDATE ON public.client_content_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_client_knowledge_items_updated_at
BEFORE UPDATE ON public.client_knowledge_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_client_content_claims_updated_at
BEFORE UPDATE ON public.client_content_claims
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_client_compliance_rules_updated_at
BEFORE UPDATE ON public.client_compliance_rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Centraliza a validacao cross-tenant para as quatro tabelas. A regra geral de
-- compliance e a unica linha que pode ter client_id nulo.
CREATE OR REPLACE FUNCTION public.validate_client_content_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'A organizacao do registro nao pode ser alterada';
    END IF;
    IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      RAISE EXCEPTION 'O cliente do registro nao pode ser alterado';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'O criador do registro nao pode ser alterado';
    END IF;
  END IF;

  IF NEW.client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients client
    WHERE client.id = NEW.client_id
      AND client.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'O cliente deve pertencer a mesma organizacao do registro';
  END IF;

  IF NEW.updated_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'O responsavel pela atualizacao deve ser o usuario autenticado';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_client_content_profile_tenant
BEFORE INSERT OR UPDATE ON public.client_content_profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_client_content_tenant();
CREATE TRIGGER validate_client_knowledge_item_tenant
BEFORE INSERT OR UPDATE ON public.client_knowledge_items
FOR EACH ROW EXECUTE FUNCTION public.validate_client_content_tenant();
CREATE TRIGGER validate_client_content_claim_tenant
BEFORE INSERT OR UPDATE ON public.client_content_claims
FOR EACH ROW EXECUTE FUNCTION public.validate_client_content_tenant();
CREATE TRIGGER validate_client_compliance_rule_tenant
BEFORE INSERT OR UPDATE ON public.client_compliance_rules
FOR EACH ROW EXECUTE FUNCTION public.validate_client_content_tenant();

ALTER TABLE public.client_content_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_content_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_compliance_rules ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_manage_content_compliance(_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND public.is_org_member(_organization_id, auth.uid())
    AND public.get_org_role(_organization_id, auth.uid()) IN ('owner', 'admin', 'manager');
$$;

REVOKE ALL ON FUNCTION public.can_manage_content_compliance(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_content_compliance(UUID)
  TO authenticated;

CREATE POLICY client_content_profiles_select ON public.client_content_profiles
FOR SELECT TO authenticated USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY client_content_profiles_insert ON public.client_content_profiles
FOR INSERT TO authenticated WITH CHECK (
  public.can_edit_org_content(organization_id, auth.uid())
  AND created_by = auth.uid() AND updated_by = auth.uid()
);
CREATE POLICY client_content_profiles_update ON public.client_content_profiles
FOR UPDATE TO authenticated USING (public.can_edit_org_content(organization_id, auth.uid()))
WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()) AND updated_by = auth.uid());
CREATE POLICY client_content_profiles_delete ON public.client_content_profiles
FOR DELETE TO authenticated USING (public.can_edit_org_content(organization_id, auth.uid()));

CREATE POLICY client_knowledge_items_select ON public.client_knowledge_items
FOR SELECT TO authenticated USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY client_knowledge_items_insert ON public.client_knowledge_items
FOR INSERT TO authenticated WITH CHECK (
  public.can_edit_org_content(organization_id, auth.uid())
  AND created_by = auth.uid() AND updated_by = auth.uid()
);
CREATE POLICY client_knowledge_items_update ON public.client_knowledge_items
FOR UPDATE TO authenticated USING (public.can_edit_org_content(organization_id, auth.uid()))
WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()) AND updated_by = auth.uid());
CREATE POLICY client_knowledge_items_delete ON public.client_knowledge_items
FOR DELETE TO authenticated USING (public.can_edit_org_content(organization_id, auth.uid()));

CREATE POLICY client_content_claims_select ON public.client_content_claims
FOR SELECT TO authenticated USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY client_content_claims_insert ON public.client_content_claims
FOR INSERT TO authenticated WITH CHECK (
  public.can_edit_org_content(organization_id, auth.uid())
  AND created_by = auth.uid() AND updated_by = auth.uid()
);
CREATE POLICY client_content_claims_update ON public.client_content_claims
FOR UPDATE TO authenticated USING (public.can_edit_org_content(organization_id, auth.uid()))
WITH CHECK (public.can_edit_org_content(organization_id, auth.uid()) AND updated_by = auth.uid());
CREATE POLICY client_content_claims_delete ON public.client_content_claims
FOR DELETE TO authenticated USING (public.can_edit_org_content(organization_id, auth.uid()));

CREATE POLICY client_compliance_rules_select ON public.client_compliance_rules
FOR SELECT TO authenticated USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY client_compliance_rules_insert ON public.client_compliance_rules
FOR INSERT TO authenticated WITH CHECK (
  (
    (client_id IS NOT NULL AND public.can_edit_org_content(organization_id, auth.uid()))
    OR (client_id IS NULL AND public.can_manage_content_compliance(organization_id))
  )
  AND created_by = auth.uid() AND updated_by = auth.uid()
);
CREATE POLICY client_compliance_rules_update ON public.client_compliance_rules
FOR UPDATE TO authenticated USING (
  (client_id IS NOT NULL AND public.can_edit_org_content(organization_id, auth.uid()))
  OR (client_id IS NULL AND public.can_manage_content_compliance(organization_id))
)
WITH CHECK (
  (
    (client_id IS NOT NULL AND public.can_edit_org_content(organization_id, auth.uid()))
    OR (client_id IS NULL AND public.can_manage_content_compliance(organization_id))
  )
  AND updated_by = auth.uid()
);
CREATE POLICY client_compliance_rules_delete ON public.client_compliance_rules
FOR DELETE TO authenticated USING (
  (client_id IS NOT NULL AND public.can_edit_org_content(organization_id, auth.uid()))
  OR (client_id IS NULL AND public.can_manage_content_compliance(organization_id))
);

REVOKE ALL ON public.client_content_profiles FROM anon;
REVOKE ALL ON public.client_knowledge_items FROM anon;
REVOKE ALL ON public.client_content_claims FROM anon;
REVOKE ALL ON public.client_compliance_rules FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_content_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_knowledge_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_content_claims TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_compliance_rules TO authenticated;

COMMIT;
