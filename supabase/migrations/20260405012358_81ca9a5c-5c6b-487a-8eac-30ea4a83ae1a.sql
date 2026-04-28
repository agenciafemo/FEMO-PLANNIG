
-- Fix overly permissive INSERT on post_comments
DROP POLICY "Anyone can insert comments" ON public.post_comments;
CREATE POLICY "Insert comments on valid posts" ON public.post_comments FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.posts WHERE id = post_id));

-- Fix overly permissive INSERT on post_edit_suggestions  
DROP POLICY "Anyone can insert suggestions" ON public.post_edit_suggestions;
CREATE POLICY "Insert suggestions on valid posts" ON public.post_edit_suggestions FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.posts WHERE id = post_id));
