
-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Clients table
CREATE TABLE public.clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  logo_url TEXT,
  accent_color TEXT DEFAULT '#F97316',
  notes TEXT,
  public_link_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex') UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own clients" ON public.clients FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Public access via token" ON public.clients FOR SELECT USING (true);

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Planning templates
CREATE TABLE public.planning_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  default_post_count INT NOT NULL DEFAULT 8,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.planning_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own templates" ON public.planning_templates FOR ALL USING (auth.uid() = user_id);

CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON public.planning_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Template posts (for templates)
CREATE TABLE public.template_posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID REFERENCES public.planning_templates(id) ON DELETE CASCADE NOT NULL,
  position INT NOT NULL DEFAULT 0,
  content_type TEXT NOT NULL DEFAULT 'static' CHECK (content_type IN ('reels', 'static', 'carousel')),
  caption TEXT DEFAULT '',
  hashtags TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.template_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage template posts via template" ON public.template_posts FOR ALL
  USING (EXISTS (SELECT 1 FROM public.planning_templates t WHERE t.id = template_id AND t.user_id = auth.uid()));

-- Plannings
CREATE TABLE public.plannings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INT NOT NULL CHECK (year BETWEEN 2020 AND 2099),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, month, year)
);
ALTER TABLE public.plannings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own plannings" ON public.plannings FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Public access plannings via client" ON public.plannings FOR SELECT USING (true);

CREATE TRIGGER update_plannings_updated_at BEFORE UPDATE ON public.plannings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Posts
CREATE TABLE public.posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  planning_id UUID REFERENCES public.plannings(id) ON DELETE CASCADE NOT NULL,
  position INT NOT NULL DEFAULT 0,
  publish_date DATE,
  content_type TEXT NOT NULL DEFAULT 'static' CHECK (content_type IN ('reels', 'static', 'carousel')),
  cover_image_url TEXT,
  video_url TEXT,
  media_urls TEXT[] DEFAULT '{}',
  caption TEXT DEFAULT '',
  hashtags TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage posts via planning" ON public.posts FOR ALL
  USING (EXISTS (SELECT 1 FROM public.plannings p WHERE p.id = planning_id AND p.user_id = auth.uid()));
CREATE POLICY "Public access posts" ON public.posts FOR SELECT USING (true);

CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Post comments
CREATE TABLE public.post_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
  author_type TEXT NOT NULL CHECK (author_type IN ('client', 'manager')),
  author_name TEXT DEFAULT 'Cliente',
  text TEXT,
  audio_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view comments" ON public.post_comments FOR SELECT USING (true);
CREATE POLICY "Anyone can insert comments" ON public.post_comments FOR INSERT WITH CHECK (true);
CREATE POLICY "Managers can delete comments" ON public.post_comments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.posts po
    JOIN public.plannings pl ON pl.id = po.planning_id
    WHERE po.id = post_id AND pl.user_id = auth.uid()
  ));

-- Post edit suggestions
CREATE TABLE public.post_edit_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
  field_name TEXT NOT NULL,
  original_value TEXT,
  suggested_value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.post_edit_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view suggestions" ON public.post_edit_suggestions FOR SELECT USING (true);
CREATE POLICY "Anyone can insert suggestions" ON public.post_edit_suggestions FOR INSERT WITH CHECK (true);
CREATE POLICY "Managers can update suggestions" ON public.post_edit_suggestions FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.posts po
    JOIN public.plannings pl ON pl.id = po.planning_id
    WHERE po.id = post_id AND pl.user_id = auth.uid()
  ));

CREATE TRIGGER update_suggestions_updated_at BEFORE UPDATE ON public.post_edit_suggestions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Monthly reports
CREATE TABLE public.monthly_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INT NOT NULL CHECK (year BETWEEN 2020 AND 2099),
  pdf_url TEXT,
  summary_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, month, year)
);
ALTER TABLE public.monthly_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own reports" ON public.monthly_reports FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Public access reports" ON public.monthly_reports FOR SELECT USING (true);

CREATE TRIGGER update_reports_updated_at BEFORE UPDATE ON public.monthly_reports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('client-logos', 'client-logos', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('post-media', 'post-media', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('report-pdfs', 'report-pdfs', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('comment-audios', 'comment-audios', true);

-- Storage policies
CREATE POLICY "Public read logos" ON storage.objects FOR SELECT USING (bucket_id = 'client-logos');
CREATE POLICY "Auth upload logos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'client-logos' AND auth.role() = 'authenticated');
CREATE POLICY "Auth update logos" ON storage.objects FOR UPDATE USING (bucket_id = 'client-logos' AND auth.role() = 'authenticated');
CREATE POLICY "Auth delete logos" ON storage.objects FOR DELETE USING (bucket_id = 'client-logos' AND auth.role() = 'authenticated');

CREATE POLICY "Public read media" ON storage.objects FOR SELECT USING (bucket_id = 'post-media');
CREATE POLICY "Auth upload media" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'post-media' AND auth.role() = 'authenticated');
CREATE POLICY "Auth update media" ON storage.objects FOR UPDATE USING (bucket_id = 'post-media' AND auth.role() = 'authenticated');
CREATE POLICY "Auth delete media" ON storage.objects FOR DELETE USING (bucket_id = 'post-media' AND auth.role() = 'authenticated');

CREATE POLICY "Public read pdfs" ON storage.objects FOR SELECT USING (bucket_id = 'report-pdfs');
CREATE POLICY "Auth upload pdfs" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'report-pdfs' AND auth.role() = 'authenticated');

CREATE POLICY "Public read audios" ON storage.objects FOR SELECT USING (bucket_id = 'comment-audios');
CREATE POLICY "Anyone upload audios" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'comment-audios');
