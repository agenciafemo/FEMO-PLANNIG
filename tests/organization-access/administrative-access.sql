\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000008',
  'admin',
  'active'
);

-- Mesmo que exista um desvio antigo concedendo financeiro a um editor, a
-- função fixa a decisão no papel administrativo.
INSERT INTO public.organization_role_permissions (
  organization_id, role, permission_key, allowed, updated_by
)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  'editor',
  'financeiro.ver',
  true,
  '00000000-0000-0000-0000-000000000001'
);

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT test.assert(
  public.has_permission('10000000-0000-0000-0000-000000000001', 'financeiro.ver'),
  'owner keeps administrative access'
);

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000008',true);
SELECT test.assert(
  public.has_permission('10000000-0000-0000-0000-000000000001', 'financeiro.editar'),
  'admin receives administrative access'
);

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT test.assert(
  NOT public.has_permission('10000000-0000-0000-0000-000000000001', 'financeiro.ver'),
  'manager cannot access administration'
);

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SELECT test.assert(
  NOT public.has_permission('10000000-0000-0000-0000-000000000001', 'financeiro.ver'),
  'editor override cannot grant administrative access'
);
SELECT test.assert(
  (SELECT count(*) FROM public.clients) = 1,
  'editor can list clients from own organization'
);

RESET ROLE;
ROLLBACK;
