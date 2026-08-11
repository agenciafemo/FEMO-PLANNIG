BEGIN;

-- Tags de função são classificações informativas e não concedem permissões.
-- A gestão continua baseada nos papéis existentes da organização.
CREATE OR REPLACE FUNCTION public.can_manage_team_function_tags(
  _organization_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND public.is_org_member(_organization_id, auth.uid())
    AND public.get_org_role(_organization_id, auth.uid())
      IN ('owner', 'admin', 'manager');
$$;

REVOKE ALL ON FUNCTION public.can_manage_team_function_tags(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_team_function_tags(UUID)
  TO authenticated;

COMMENT ON FUNCTION public.can_manage_team_function_tags(UUID) IS
  'Autoriza a gestão das tags de função para owner, admin ou manager (Head), sempre dentro de uma organização da qual o usuário é membro ativo.';

CREATE TABLE public.team_function_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT team_function_tags_name_not_blank
    CHECK (btrim(name) <> ''),
  CONSTRAINT team_function_tags_name_length
    CHECK (char_length(btrim(name)) <= 80),
  CONSTRAINT team_function_tags_color_hex
    CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT team_function_tags_organization_id_id_key
    UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX team_function_tags_org_normalized_name_key
  ON public.team_function_tags (organization_id, lower(btrim(name)));

CREATE INDEX team_function_tags_organization_id_idx
  ON public.team_function_tags (organization_id);

COMMENT ON TABLE public.team_function_tags IS
  'Catálogo de funções de trabalho definido separadamente por organização.';
COMMENT ON COLUMN public.team_function_tags.name IS
  'Nome da função de trabalho; não representa nem concede permissão de acesso.';
COMMENT ON COLUMN public.team_function_tags.color IS
  'Cor hexadecimal no formato #RRGGBB.';

CREATE TABLE public.team_member_functions (
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  tag_id UUID NOT NULL,

  CONSTRAINT team_member_functions_user_tag_key
    UNIQUE (user_id, tag_id),
  CONSTRAINT team_member_functions_member_fkey
    FOREIGN KEY (organization_id, user_id)
    REFERENCES public.organization_members(organization_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT team_member_functions_tag_fkey
    FOREIGN KEY (organization_id, tag_id)
    REFERENCES public.team_function_tags(organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX team_member_functions_organization_user_idx
  ON public.team_member_functions (organization_id, user_id);

CREATE INDEX team_member_functions_organization_tag_idx
  ON public.team_member_functions (organization_id, tag_id);

COMMENT ON TABLE public.team_member_functions IS
  'Relaciona colaboradores a uma ou mais funções de trabalho dentro da mesma organização.';

ALTER TABLE public.team_function_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_member_functions ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_function_tags_select_for_members
  ON public.team_function_tags
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY team_function_tags_insert_for_managers
  ON public.team_function_tags
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_team_function_tags(organization_id));

CREATE POLICY team_function_tags_update_for_managers
  ON public.team_function_tags
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_team_function_tags(organization_id))
  WITH CHECK (public.can_manage_team_function_tags(organization_id));

CREATE POLICY team_function_tags_delete_for_managers
  ON public.team_function_tags
  FOR DELETE
  TO authenticated
  USING (public.can_manage_team_function_tags(organization_id));

CREATE POLICY team_member_functions_select_for_members
  ON public.team_member_functions
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY team_member_functions_insert_for_managers
  ON public.team_member_functions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_team_function_tags(organization_id));

CREATE POLICY team_member_functions_update_for_managers
  ON public.team_member_functions
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_team_function_tags(organization_id))
  WITH CHECK (public.can_manage_team_function_tags(organization_id));

CREATE POLICY team_member_functions_delete_for_managers
  ON public.team_member_functions
  FOR DELETE
  TO authenticated
  USING (public.can_manage_team_function_tags(organization_id));

REVOKE ALL ON TABLE public.team_function_tags FROM anon;
REVOKE ALL ON TABLE public.team_member_functions FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.team_function_tags
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.team_member_functions
  TO authenticated;

-- Seed inicial para organizações já existentes. Organizações futuras podem
-- criar seu próprio catálogo pela interface ou por um fluxo de onboarding.
INSERT INTO public.team_function_tags (organization_id, name, color)
SELECT
  organization.id,
  default_tag.name,
  default_tag.color
FROM public.organizations AS organization
CROSS JOIN (
  VALUES
    ('Social Mídia', '#0F766E'),
    ('Tráfego Pago', '#2563EB'),
    ('Editor', '#7C3AED'),
    ('Head', '#D97706'),
    ('ADM', '#DC2626')
) AS default_tag(name, color)
ON CONFLICT DO NOTHING;

COMMIT;
