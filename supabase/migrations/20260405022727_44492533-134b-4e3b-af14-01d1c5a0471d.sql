
-- 1. Add topic_brief to posts
ALTER TABLE posts ADD COLUMN topic_brief TEXT;

-- 2. Add ai_summary to monthly_reports
ALTER TABLE monthly_reports ADD COLUMN ai_summary TEXT;

-- 3. RLS: allow update on post_comments for valid posts
CREATE POLICY "Update comments on valid posts" ON post_comments
  FOR UPDATE TO public
  USING (EXISTS (SELECT 1 FROM posts WHERE posts.id = post_comments.post_id));

-- 4. RLS: allow delete on post_comments for valid posts  
CREATE POLICY "Delete comments on valid posts" ON post_comments
  FOR DELETE TO public
  USING (EXISTS (SELECT 1 FROM posts WHERE posts.id = post_comments.post_id));

-- 5. Create client_documents table
CREATE TABLE client_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  file_url TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'geral',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE client_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read documents" ON client_documents
  FOR SELECT TO public USING (true);

CREATE POLICY "Manager manages documents" ON client_documents
  FOR ALL TO public USING (auth.uid() = user_id);

-- 6. Create client-documents storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('client-documents', 'client-documents', true);

-- 7. Storage policy for client-documents
CREATE POLICY "Public read client-documents" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'client-documents');

CREATE POLICY "Auth upload client-documents" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'client-documents');

CREATE POLICY "Auth delete client-documents" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'client-documents');
