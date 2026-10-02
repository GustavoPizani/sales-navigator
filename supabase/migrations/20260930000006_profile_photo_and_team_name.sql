-- Foto de perfil e nome da equipe do gestor.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
-- Nome exibido como "Equipe <team_name>" (sem valor, usa o nome do gestor).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS team_name TEXT;

-- Equipe do administrador atual.
UPDATE public.profiles SET team_name = 'Online P&G'
WHERE id = '23b88f56-a21e-4b68-a89d-8568401c9704' AND team_name IS NULL;

-- ── Bucket de fotos (leitura pública; cada usuário grava só na própria pasta) ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- caminho: <user_id>/<arquivo>
DROP POLICY IF EXISTS "avatars_own_insert" ON storage.objects;
CREATE POLICY "avatars_own_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_own_update" ON storage.objects;
CREATE POLICY "avatars_own_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_own_delete" ON storage.objects;
CREATE POLICY "avatars_own_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
