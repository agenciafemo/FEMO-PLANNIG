
-- Team members table for collaborator access
CREATE TABLE public.team_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  email TEXT NOT NULL,
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(owner_id, email)
);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- Only the owner can manage their team members
CREATE POLICY "Owners manage team members"
ON public.team_members FOR ALL
USING (auth.uid() = owner_id);

-- Team members can see they belong to a team
CREATE POLICY "Members can see own membership"
ON public.team_members FOR SELECT
USING (auth.uid() = user_id);

-- Function to get all user_ids whose data I can access (my own + owners who added me as team member)
CREATE OR REPLACE FUNCTION public.get_accessible_user_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid()
  UNION
  SELECT owner_id FROM public.team_members WHERE user_id = auth.uid()
$$;

-- Update RLS on clients
DROP POLICY IF EXISTS "Users manage own clients" ON public.clients;
CREATE POLICY "Users manage own clients"
ON public.clients FOR ALL
USING (user_id IN (SELECT public.get_accessible_user_ids()));

-- Update RLS on plannings
DROP POLICY IF EXISTS "Users manage own plannings" ON public.plannings;
CREATE POLICY "Users manage own plannings"
ON public.plannings FOR ALL
USING (user_id IN (SELECT public.get_accessible_user_ids()));

-- Update RLS on posts
DROP POLICY IF EXISTS "Users manage posts via planning" ON public.posts;
CREATE POLICY "Users manage posts via planning"
ON public.posts FOR ALL
USING (EXISTS (
  SELECT 1 FROM plannings p
  WHERE p.id = posts.planning_id
  AND p.user_id IN (SELECT public.get_accessible_user_ids())
));

-- Update RLS on monthly_reports
DROP POLICY IF EXISTS "Users manage own reports" ON public.monthly_reports;
CREATE POLICY "Users manage own reports"
ON public.monthly_reports FOR ALL
USING (user_id IN (SELECT public.get_accessible_user_ids()));

-- Update RLS on client_documents
DROP POLICY IF EXISTS "Manager manages documents" ON public.client_documents;
CREATE POLICY "Manager manages documents"
ON public.client_documents FOR ALL
USING (user_id IN (SELECT public.get_accessible_user_ids()));

-- Update RLS on planning_templates
DROP POLICY IF EXISTS "Users manage own templates" ON public.planning_templates;
CREATE POLICY "Users manage own templates"
ON public.planning_templates FOR ALL
USING (user_id IN (SELECT public.get_accessible_user_ids()));

-- Update RLS on template_posts
DROP POLICY IF EXISTS "Users manage template posts via template" ON public.template_posts;
CREATE POLICY "Users manage template posts via template"
ON public.template_posts FOR ALL
USING (EXISTS (
  SELECT 1 FROM planning_templates t
  WHERE t.id = template_posts.template_id
  AND t.user_id IN (SELECT public.get_accessible_user_ids())
));
