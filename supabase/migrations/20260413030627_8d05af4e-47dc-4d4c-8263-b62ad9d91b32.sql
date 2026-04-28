
-- Tabela de roteiros de vídeo
CREATE TABLE public.video_scripts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  planning_id UUID NOT NULL REFERENCES public.plannings(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  spoken_text TEXT DEFAULT '',
  editing_instructions TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.video_scripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read video scripts" ON public.video_scripts
  FOR SELECT USING (true);

CREATE POLICY "Managers manage video scripts" ON public.video_scripts
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM plannings p
      WHERE p.id = video_scripts.planning_id
      AND p.user_id IN (SELECT get_accessible_user_ids())
    )
  );

CREATE TRIGGER update_video_scripts_updated_at
  BEFORE UPDATE ON public.video_scripts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela de comentários de relatórios
CREATE TABLE public.report_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES public.monthly_reports(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL,
  author_name TEXT DEFAULT 'Cliente',
  text TEXT,
  audio_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.report_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view report comments" ON public.report_comments
  FOR SELECT USING (true);

CREATE POLICY "Insert comments on valid reports" ON public.report_comments
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM monthly_reports WHERE id = report_comments.report_id)
  );

CREATE POLICY "Managers can delete report comments" ON public.report_comments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM monthly_reports mr
      WHERE mr.id = report_comments.report_id
      AND mr.user_id = auth.uid()
    )
  );
