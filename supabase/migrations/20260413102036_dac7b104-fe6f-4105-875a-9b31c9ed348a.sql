
-- Fix client_documents: allow collaborators (not just owner) to manage
DROP POLICY IF EXISTS "Manager manages documents" ON public.client_documents;
CREATE POLICY "Managers manage documents" ON public.client_documents
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_documents.client_id
      AND c.user_id IN (SELECT get_accessible_user_ids())
    )
  );

-- Allow public insert on client_documents (client portal uploads)
CREATE POLICY "Public insert documents" ON public.client_documents
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM clients WHERE id = client_documents.client_id)
  );

-- Fix monthly_reports: allow collaborators to manage
DROP POLICY IF EXISTS "Users manage own reports" ON public.monthly_reports;
CREATE POLICY "Managers manage reports" ON public.monthly_reports
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = monthly_reports.client_id
      AND c.user_id IN (SELECT get_accessible_user_ids())
    )
  );

-- Allow public insert on report_comments (already exists but let's make sure update works too)
CREATE POLICY "Anyone can update report comments" ON public.report_comments
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM monthly_reports WHERE id = report_comments.report_id)
  );

-- Allow collaborators to delete report comments
DROP POLICY IF EXISTS "Managers can delete report comments" ON public.report_comments;
CREATE POLICY "Managers can delete report comments" ON public.report_comments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM monthly_reports mr
      JOIN clients c ON c.id = mr.client_id
      WHERE mr.id = report_comments.report_id
      AND c.user_id IN (SELECT get_accessible_user_ids())
    )
  );

-- Storage: allow upload to report-pdfs without auth (for client portal)
CREATE POLICY "Anyone upload pdfs" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'report-pdfs');
DROP POLICY IF EXISTS "Auth upload pdfs" ON storage.objects;

-- Storage: allow delete on report-pdfs for authenticated users  
CREATE POLICY "Auth delete pdfs" ON storage.objects
  FOR DELETE USING (bucket_id = 'report-pdfs' AND auth.role() = 'authenticated');
