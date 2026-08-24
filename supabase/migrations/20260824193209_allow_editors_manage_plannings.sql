BEGIN;

-- Social mídia, designer e editor usam organization_members.role = 'editor'.
-- Eles já podem criar/editar posts por can_edit_org_content, mas a policy de
-- plannings aceitava somente owner/admin/manager. A tela oferecia a ação e o
-- banco respondia com violação de RLS. Alinhamos o planejamento ao conteúdo.

DROP POLICY IF EXISTS "org_managers_insert_plannings" ON public.plannings;
DROP POLICY IF EXISTS "org_editors_insert_plannings" ON public.plannings;

CREATE POLICY "org_editors_insert_plannings"
ON public.plannings
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_edit_org_content(plannings.organization_id, auth.uid())
  AND plannings.created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.clients AS client
    WHERE client.id = plannings.client_id
      AND client.organization_id = plannings.organization_id
      AND public.is_org_member(client.organization_id, auth.uid())
  )
);

DROP POLICY IF EXISTS "org_managers_update_plannings" ON public.plannings;
DROP POLICY IF EXISTS "org_editors_update_plannings" ON public.plannings;

CREATE POLICY "org_editors_update_plannings"
ON public.plannings
FOR UPDATE
TO authenticated
USING (
  public.can_edit_org_content(plannings.organization_id, auth.uid())
)
WITH CHECK (
  public.can_edit_org_content(plannings.organization_id, auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.clients AS client
    WHERE client.id = plannings.client_id
      AND client.organization_id = plannings.organization_id
      AND public.is_org_member(client.organization_id, auth.uid())
  )
);

-- A exclusão permanece na policy org_managers_delete_plannings, restrita a
-- owner/admin/manager. A policy de leitura também permanece por organização.

COMMIT;
