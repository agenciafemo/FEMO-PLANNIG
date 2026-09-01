-- ============================================================================
-- Estende a permissao de excluir planejamento a funcao "Head".
--
-- POR QUE ISTO E UMA MIGRATION SEPARADA:
-- A lista de cargos da tela (TeamCollaborators.tsx) mapeia Head -> 'admin', o
-- que daria a exclusao de graca. Mas o cadastro real nao segue esse mapa: em
-- producao, o Head esta gravado com role = 'editor'. Ele so tem a FUNCAO
-- "Head" atribuida — nao o papel.
--
-- Duas saidas existiam:
--   1. Promover a 'admin' — daria acesso total, muito alem de apagar
--      planejamento (inclusive o ponto de toda a equipe).
--   2. Reconhecer a FUNCAO, como ja e feito para "Trafego Pago" e agora para
--      "Social Midia".
--
-- A segunda e a que mantem o principio: cada excecao vale para uma coisa so.
--
-- CREATE OR REPLACE com a MESMA assinatura preserva os privilegios concedidos
-- em 20260826160000 — por isso nao ha GRANT aqui. Trocar a assinatura exigiria
-- DROP, e ai o GRANT teria que voltar junto.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.can_delete_planning(
  _organization_id UUID,
  _user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_org_member(_organization_id, _user_id)
    AND (
      public.get_org_role(_organization_id, _user_id) IN ('owner', 'admin', 'manager')
      OR EXISTS (
        SELECT 1
        FROM public.team_member_functions mf
        JOIN public.team_function_tags t
          ON t.organization_id = mf.organization_id AND t.id = mf.tag_id
        WHERE mf.organization_id = _organization_id
          AND mf.user_id = _user_id
          AND (
            t.name ILIKE '%social%'
            OR t.name ILIKE '%mídia%'
            OR t.name ILIKE '%midia%'
            OR t.name ILIKE '%head%'
          )
      )
    )
$$;

COMMIT;
