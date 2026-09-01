-- ============================================================================
-- Primeira familia de policies a usar has_permission(): planejamento.
--
-- Escolhida de proposito para abrir a fila: e a que mais doeu esta semana, e
-- e pequena o bastante para provar o caminho inteiro sem mexer na RLS toda.
-- As outras 33 verificacoes de papel seguem como estao ate serem migradas uma
-- familia por vez.
--
-- NINGUEM PODE PERDER ACESSO NESTA VIRADA.
-- Antes de trocar as policies, quem hoje passa pela excecao por NOME DE TAG
-- (ILIKE '%social%' / '%head%') recebe uma permissao explicita de pessoa. A
-- excecao deixa de depender de como a tag foi escrita e passa a ser um
-- registro que da para ver e editar na tela.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Preserva quem so tinha acesso pela tag.
--
-- So quem NAO seria coberto pelo cargo entra aqui — quem ja e admin/manager
-- nao precisa de excecao, e criar uma so poluiria a tela.
-- ---------------------------------------------------------------------------
INSERT INTO public.organization_member_permissions
  (organization_id, user_id, permission_key, allowed)
SELECT DISTINCT
  m.organization_id,
  m.user_id,
  'plannings.delete',
  TRUE
FROM public.organization_members m
JOIN public.team_member_functions mf
  ON mf.organization_id = m.organization_id AND mf.user_id = m.user_id
JOIN public.team_function_tags t
  ON t.organization_id = mf.organization_id AND t.id = mf.tag_id
WHERE m.status = 'active'
  AND m.role::TEXT NOT IN ('owner', 'admin', 'manager')
  AND (
    t.name ILIKE '%social%'
    OR t.name ILIKE '%mídia%'
    OR t.name ILIKE '%midia%'
    OR t.name ILIKE '%head%'
  )
ON CONFLICT (organization_id, user_id, permission_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. As policies passam a perguntar ao sistema de permissoes.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "org_delete_plannings" ON public.plannings;
DROP POLICY IF EXISTS "org_managers_delete_plannings" ON public.plannings;

CREATE POLICY "org_delete_plannings" ON public.plannings
  FOR DELETE TO authenticated
  USING (public.has_permission(organization_id, 'plannings.delete'));

DROP POLICY IF EXISTS "org_editors_insert_plannings" ON public.plannings;
DROP POLICY IF EXISTS "org_managers_insert_plannings" ON public.plannings;

-- As condicoes extras da policy original continuam: quem cria e o dono do
-- registro, e o cliente tem que ser da mesma organizacao. A permissao troca
-- apenas a checagem de CARGO, nao as regras de integridade.
CREATE POLICY "org_insert_plannings" ON public.plannings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission(plannings.organization_id, 'plannings.create')
    AND plannings.created_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.clients AS client
      WHERE client.id = plannings.client_id
        AND public.is_org_member(client.organization_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "org_editors_update_plannings" ON public.plannings;
DROP POLICY IF EXISTS "org_managers_update_plannings" ON public.plannings;

CREATE POLICY "org_update_plannings" ON public.plannings
  FOR UPDATE TO authenticated
  USING (public.has_permission(organization_id, 'plannings.update'))
  WITH CHECK (public.has_permission(organization_id, 'plannings.update'));

-- ---------------------------------------------------------------------------
-- 3. Sai a funcao que casava por nome de tag: duas fontes de verdade para a
--    mesma decisao e como o bug volta.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.can_delete_planning(UUID, UUID);

-- ---------------------------------------------------------------------------
-- Conferencia: quem pode excluir planejamento agora, e por que.
-- ---------------------------------------------------------------------------
SELECT
  COALESCE(m.display_name, '(sem nome)') AS pessoa,
  m.job_title                            AS cargo,
  m.role                                 AS papel,
  CASE
    WHEN m.role::TEXT = 'owner' THEN 'dono'
    WHEN EXISTS (
      SELECT 1 FROM public.organization_member_permissions mp
       WHERE mp.organization_id = m.organization_id
         AND mp.user_id = m.user_id
         AND mp.permission_key = 'plannings.delete'
    ) THEN 'excecao da pessoa'
    ELSE 'padrao do cargo'
  END                                    AS origem,
  public.has_permission(m.organization_id, 'plannings.delete', m.user_id) AS pode_excluir
FROM public.organization_members m
WHERE m.status = 'active'
ORDER BY pode_excluir DESC, cargo NULLS LAST, pessoa;

COMMIT;
