BEGIN;

CREATE SCHEMA IF NOT EXISTS norteia_access;
REVOKE ALL ON SCHEMA norteia_access FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA norteia_access TO authenticated;

CREATE OR REPLACE FUNCTION norteia_access.create_organization(_name text, _slug text)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org public.organizations;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;

  -- Criar uma segunda operação é uma ação administrativa. Usuários sem
  -- vínculo, colaboradores, leitores e líderes não podem criar organizações.
  PERFORM 1
  FROM public.organization_members
  WHERE user_id = auth.uid()
    AND status = 'active'
    AND role IN ('owner', 'admin')
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Somente proprietários e administradores podem criar outra agência'
      USING ERRCODE = '42501';
  END IF;

  IF length(btrim(COALESCE(_name, ''))) < 2 OR length(btrim(_name)) > 100 THEN
    RAISE EXCEPTION 'O nome da agência deve ter entre 2 e 100 caracteres';
  END IF;
  IF _slug IS NULL OR _slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' OR length(_slug) > 80 THEN
    RAISE EXCEPTION 'Identificador da agência inválido';
  END IF;

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES (btrim(_name), _slug, auth.uid())
  RETURNING * INTO v_org;

  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES (v_org.id, auth.uid(), 'owner', 'active');

  UPDATE public.profiles
  SET active_organization_id = v_org.id
  WHERE id = auth.uid();

  RETURN v_org;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_organization(_name text, _slug text)
RETURNS public.organizations
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT norteia_access.create_organization(_name, _slug)
$$;

REVOKE ALL ON FUNCTION norteia_access.create_organization(text, text),
  public.create_organization(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION norteia_access.create_organization(text, text),
  public.create_organization(text, text) TO authenticated;

COMMENT ON FUNCTION public.create_organization(text, text) IS
  'Cria uma organização separada somente para usuário já ativo como owner/admin em outra organização.';

NOTIFY pgrst, 'reload schema';
COMMIT;
