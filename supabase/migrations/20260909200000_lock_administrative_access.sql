-- Administração sensível é responsabilidade do owner/admin da organização.
-- Funções profissionais e exceções configuráveis não podem liberar dados
-- financeiros para manager/editor/viewer.

BEGIN;

DELETE FROM public.organization_member_permissions
WHERE permission_key IN ('financeiro.ver', 'financeiro.editar');

DELETE FROM public.organization_role_permissions
WHERE permission_key IN ('financeiro.ver', 'financeiro.editar');

UPDATE public.permissions
SET category = 'Administrativo',
    description = CASE key
      WHEN 'financeiro.ver' THEN
        'Acesso fixo de Proprietário e Gestor / Head aos dados financeiros da agência.'
      ELSE
        'Acesso fixo de Proprietário e Gestor / Head para alterar os dados financeiros da agência.'
    END,
    default_roles = ARRAY['admin']::text[]
WHERE key IN ('financeiro.ver', 'financeiro.editar');

CREATE OR REPLACE FUNCTION public.has_permission(
  _organization_id UUID,
  _key TEXT,
  _user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN _organization_id IS NULL OR _user_id IS NULL THEN FALSE
    WHEN NOT public.is_org_member(_organization_id, _user_id) THEN FALSE
    -- Estas chaves protegem dados administrativos sensíveis. Nem desvio de
    -- cargo nem exceção individual podem concedê-las à operação.
    WHEN _key IN ('financeiro.ver', 'financeiro.editar') THEN
      public.get_org_role(_organization_id, _user_id)::TEXT IN ('owner', 'admin')
    WHEN public.get_org_role(_organization_id, _user_id)::TEXT = 'owner' THEN TRUE
    ELSE COALESCE(
      (SELECT mp.allowed
         FROM public.organization_member_permissions AS mp
        WHERE mp.organization_id = _organization_id
          AND mp.user_id = _user_id
          AND mp.permission_key = _key),
      (SELECT rp.allowed
         FROM public.organization_role_permissions AS rp
        WHERE rp.organization_id = _organization_id
          AND rp.permission_key = _key
          AND rp.role = public.get_org_role(_organization_id, _user_id)::TEXT),
      (SELECT public.get_org_role(_organization_id, _user_id)::TEXT = ANY(p.default_roles)
         FROM public.permissions AS p
        WHERE p.key = _key),
      FALSE
    )
  END
$$;

REVOKE ALL ON FUNCTION public.has_permission(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION public.has_permission(UUID, TEXT, UUID) IS
  'Resolve permissões operacionais; financeiro.ver/editar são fixas para owner/admin.';

NOTIFY pgrst, 'reload schema';
COMMIT;
