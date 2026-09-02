-- ============================================================================
-- Permissao cirurgica: quem tem a funcao de trabalho "Social Midia" pode
-- EXCLUIR planejamento — sem ganhar acesso de manager em nada mais.
--
-- POR QUE NAO PROMOVER A PESSOA A MANAGER:
-- O papel manager nao libera so a exclusao. Ele da, entre outras coisas, o
-- PONTO DE TODA A EQUIPE: ver os registros, aprovar ajustes, aprovar abonos e
-- abrir os anexos. Dar isso a quem so precisa apagar um planejamento seria
-- entregar dado de RH junto.
--
-- POR QUE NAO LIBERAR PARA TODO 'editor':
-- Social midia, designer e editor de video compartilham o mesmo papel 'editor'
-- (ver 20260824193209_allow_editors_manage_plannings.sql). Liberar por papel
-- daria a exclusao aos tres — e apagar planejamento CASCATEIA para posts,
-- roteiros, itens de producao e respostas de NPS.
--
-- Este e o mesmo desenho ja usado em 20260820140000_meta_traffic_manager_
-- permission.sql, onde a funcao "Trafego Pago" ganhou o direito de gerenciar
-- conexoes Meta sem virar manager. As funcoes da equipe continuam, por padrao,
-- sem conceder acesso; estas sao as excecoes, e cada uma vale para uma coisa.
--
-- DEPOIS DE APLICAR: e preciso criar a tag de funcao "Social Midia" em
-- Equipe > Colaboradores e atribui-la a quem deve poder excluir. Sem a tag
-- atribuida, nada muda para ninguem.
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
          AND (t.name ILIKE '%social%' OR t.name ILIKE '%mídia%' OR t.name ILIKE '%midia%')
      )
    )
$$;

-- Funcao NOVA: precisa conceder EXECUTE explicitamente. A policy e avaliada
-- com o papel de quem consulta, entao 'authenticated' tem que poder chamar.
-- (Recriar funcao descarta privilegios — foi o que derrubou o OAuth da Meta
-- em 26/08. Aqui o GRANT vem junto de proposito.)
REVOKE ALL ON FUNCTION public.can_delete_planning(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_delete_planning(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "org_managers_delete_plannings" ON public.plannings;
DROP POLICY IF EXISTS "org_delete_plannings" ON public.plannings;

CREATE POLICY "org_delete_plannings" ON public.plannings
  FOR DELETE TO authenticated
  USING (public.can_delete_planning(organization_id));

COMMIT;
