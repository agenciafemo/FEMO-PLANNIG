-- Synthetic standalone Postgres fixture. NEVER run against a real Supabase project.
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE TYPE public.organization_member_role AS ENUM ('owner','admin','manager','editor','viewer');
CREATE TYPE public.organization_member_status AS ENUM ('active','suspended','removed');
CREATE TABLE public.organizations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE,
 created_by uuid REFERENCES auth.users(id), client_limit integer DEFAULT 5
);
CREATE TABLE public.profiles(
 id uuid PRIMARY KEY REFERENCES auth.users(id), active_organization_id uuid REFERENCES public.organizations(id)
);
CREATE TABLE public.organization_members(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES public.organizations,
 user_id uuid REFERENCES auth.users, role public.organization_member_role, status public.organization_member_status,
 UNIQUE(organization_id,user_id)
);
CREATE FUNCTION public.is_org_member(_organization_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.organization_members
   WHERE organization_id=_organization_id AND user_id=_user_id AND status='active'
 )
$$;
CREATE FUNCTION public.get_org_role(_organization_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS public.organization_member_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT role FROM public.organization_members WHERE organization_id=_organization_id AND user_id=_user_id AND status='active'
$$;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.organization_members, public.organizations TO authenticated;
CREATE POLICY own_memberships ON public.organization_members FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY own_organizations ON public.organizations FOR SELECT TO authenticated USING(public.get_org_role(id) IS NOT NULL);
CREATE TABLE public.clients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES public.organizations, name text);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.clients TO authenticated;
CREATE POLICY client_members_only ON public.clients FOR SELECT TO authenticated USING(public.get_org_role(organization_id) IS NOT NULL);
INSERT INTO auth.users SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid, 'user'||n||'@example.test', CASE WHEN n=6 THEN NULL ELSE now() END FROM generate_series(1,8) n;
INSERT INTO public.profiles(id) SELECT id FROM auth.users;
INSERT INTO public.organizations(id,name,slug) SELECT ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid, 'Agency '||n, 'agency-'||n FROM generate_series(1,9) n;
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','owner','active'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','manager','active'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','editor','active'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000005','owner','active'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000007','editor','suspended');
INSERT INTO public.clients(organization_id,name) VALUES ('10000000-0000-0000-0000-000000000001','Private client A'),('10000000-0000-0000-0000-000000000002','Private client B');
CREATE SCHEMA test;
GRANT USAGE ON SCHEMA test TO anon, authenticated;
CREATE FUNCTION test.assert(_condition boolean, _message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF _condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', _message; END IF; RAISE NOTICE 'PASS: %', _message; END $$;
CREATE FUNCTION test.expect_error(_sql text, _state text, _message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE _sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> _state THEN RAISE EXCEPTION 'Wrong error for %: % %', _message, SQLSTATE, SQLERRM; END IF;
    RAISE NOTICE 'PASS: %', _message; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: expected denial: %', _message;
END $$;
