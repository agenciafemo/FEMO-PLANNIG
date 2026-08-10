-- ============================================================================
-- DIRETORIO DE RESPONSAVEIS DO MODULO DE TAREFAS
--
-- Mantem nome/cargo no vinculo com a organizacao. O cargo e apenas informativo:
-- as permissoes continuam sendo controladas por organization_members.role.
-- Esta migration deve ser revisada e aplicada pelo usuario; nao aplicar daqui.
-- ============================================================================

BEGIN;

ALTER TABLE public.organization_members
  ADD COLUMN display_name TEXT,
  ADD COLUMN job_title TEXT,
  ADD CONSTRAINT organization_members_display_name_not_blank
    CHECK (display_name IS NULL OR btrim(display_name) <> ''),
  ADD CONSTRAINT organization_members_job_title_not_blank
    CHECK (job_title IS NULL OR btrim(job_title) <> '');

COMMENT ON COLUMN public.organization_members.display_name IS
  'Nome de exibicao do colaborador dentro da organizacao.';
COMMENT ON COLUMN public.organization_members.job_title IS
  'Cargo informativo do colaborador; nao concede nem remove permissoes.';

-- Cadastro inicial da equipe da Agencia Femo. O e-mail e usado somente neste
-- backfill server-side e nunca e retornado ao frontend.
UPDATE public.organization_members AS member
SET
  display_name = CASE lower(account.email)
    WHEN 'giuliaagcfemo@gmail.com' THEN 'Giu'
    WHEN 'eduardoagcfemo@gmail.com' THEN 'Edu'
    WHEN 'estrategistafemo@gmail.com' THEN 'Nanda'
    WHEN 'lucasagcfemo@gmail.com' THEN 'Lucas'
    WHEN 'ferlopesmoro@gmail.com' THEN 'Fer'
    WHEN 'joaoagcfemo@gmail.com' THEN 'João'
  END,
  job_title = CASE lower(account.email)
    WHEN 'giuliaagcfemo@gmail.com' THEN 'Social mídia'
    WHEN 'eduardoagcfemo@gmail.com' THEN 'Editor'
    WHEN 'estrategistafemo@gmail.com' THEN 'Social mídia'
    WHEN 'lucasagcfemo@gmail.com' THEN 'Gestor de tráfego'
    WHEN 'ferlopesmoro@gmail.com' THEN 'ADM'
    WHEN 'joaoagcfemo@gmail.com' THEN 'Head'
  END,
  updated_at = now()
FROM auth.users AS account
WHERE account.id = member.user_id
  AND lower(account.email) IN (
    'giuliaagcfemo@gmail.com',
    'eduardoagcfemo@gmail.com',
    'estrategistafemo@gmail.com',
    'lucasagcfemo@gmail.com',
    'ferlopesmoro@gmail.com',
    'joaoagcfemo@gmail.com'
  );

CREATE OR REPLACE FUNCTION public.get_task_assignees(_organization_id UUID)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  job_title TEXT,
  avatar_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    member.user_id,
    COALESCE(
      NULLIF(btrim(member.display_name), ''),
      NULLIF(btrim(profile.full_name), ''),
      'Usuário'
    ) AS display_name,
    NULLIF(btrim(member.job_title), '') AS job_title,
    NULLIF(btrim(profile.avatar_url), '') AS avatar_url
  FROM public.organization_members AS member
  LEFT JOIN public.profiles AS profile ON profile.id = member.user_id
  WHERE member.organization_id = _organization_id
    AND member.status = 'active'
    AND auth.uid() IS NOT NULL
    AND public.is_org_member(_organization_id, auth.uid())
  ORDER BY display_name, member.user_id;
$$;

COMMENT ON FUNCTION public.get_task_assignees(UUID) IS
  'Diretorio sanitizado de responsaveis ativos da organizacao; nao retorna email nem dados de autenticacao.';

REVOKE ALL ON FUNCTION public.get_task_assignees(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_task_assignees(UUID) TO authenticated;

COMMIT;
