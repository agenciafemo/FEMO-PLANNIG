\set ON_ERROR_STOP on
BEGIN;

SELECT test.assert(
  NOT has_function_privilege('anon', 'public.create_organization(text,text)', 'EXECUTE'),
  'anonymous role cannot call organization creation'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000008',true);
SELECT test.expect_error(
  $$SELECT public.create_organization('Unauthorized Agency','unauthorized-agency')$$,
  '42501',
  'user without membership cannot create organization'
);

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SELECT test.expect_error(
  $$SELECT public.create_organization('Editor Agency','editor-agency')$$,
  '42501',
  'editor cannot create organization'
);

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT test.expect_error(
  $$SELECT public.create_organization('Manager Agency','manager-agency')$$,
  '42501',
  'manager cannot create organization'
);

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT public.create_organization('Second Agency','second-agency');
SELECT test.assert(
  public.get_org_role((SELECT id FROM public.organizations WHERE slug='second-agency')) = 'owner',
  'existing owner creates a second organization as owner'
);

RESET ROLE;
SELECT test.assert(
  (SELECT active_organization_id FROM public.profiles WHERE id='00000000-0000-0000-0000-000000000001') =
    (SELECT id FROM public.organizations WHERE slug='second-agency'),
  'new organization becomes active only for its creator'
);

ROLLBACK;
