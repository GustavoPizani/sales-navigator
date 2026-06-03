-- Create project-docs bucket for tabelas and books
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-docs',
  'project-docs',
  false,
  52428800,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Admins can upload, update, and delete documents
CREATE POLICY "project_docs_admin_write" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'project-docs' AND public.is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'project-docs' AND public.is_admin(auth.uid()));

-- All authenticated users (including brokers) can read and download documents
CREATE POLICY "project_docs_read_authenticated" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'project-docs');
