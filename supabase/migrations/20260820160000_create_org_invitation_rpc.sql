-- ============================================================================
-- RPC para CRIAR convite de membro (gera o token/link). O aceite já existe
-- (accept_organization_invitation). Só owner/admin (Proprietário/Gestor/Head)
-- podem convidar. SECURITY DEFINER porque não há policy de INSERT direto em
-- organization_invitations.
-- Idempotente (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_organization_invitation(
  _organization_id UUID,
  _email TEXT,
  _role public.organization_member_role DEFAULT 'editor'
)
RETURNS public.organization_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.organization_invitations;
BEGIN
  IF NOT public.is_org_admin_or_owner(_organization_id) THEN
    RAISE EXCEPTION 'Sem permissão para convidar nesta organização'
      USING ERRCODE = '42501';
  END IF;

  IF btrim(COALESCE(_email, '')) = '' THEN
    RAISE EXCEPTION 'Informe um e-mail para o convite'
      USING ERRCODE = '22023';
  END IF;

  -- Não permite convidar como proprietário por link.
  IF _role = 'owner' THEN
    RAISE EXCEPTION 'Não é possível convidar como proprietário'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.organization_invitations (organization_id, email, role, created_by)
  VALUES (_organization_id, lower(btrim(_email)), _role, auth.uid())
  RETURNING * INTO v_inv;

  RETURN v_inv;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization_invitation(UUID, TEXT, public.organization_member_role)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization_invitation(UUID, TEXT, public.organization_member_role)
  TO authenticated;
