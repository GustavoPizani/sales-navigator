-- Biblioteca dos Treinamentos: PDFs de treinamento de produto e livros, como a
-- biblioteca do Conx Academy. O ADM envia; cada material pode ser para todos,
-- só corretores ou só gestores. A capa é a primeira página do PDF (imagem gerada
-- no envio). Roda depois de 20261029000001_treinamentos.sql.

CREATE TABLE IF NOT EXISTS public.training_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT,
  category TEXT NOT NULL DEFAULT 'treinamento' CHECK (category IN ('treinamento', 'livro')),
  -- empreendimento do treinamento (nome do cadastro de Imóveis); vazio nos livros
  product_name TEXT,
  -- caminhos no bucket training-docs: materiais/<id>.pdf e materiais/<id>.jpg
  pdf_path TEXT NOT NULL,
  cover_path TEXT,
  pages INT CHECK (pages IS NULL OR pages > 0),
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'broker', 'master')),
  published BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O material aparece para o usuário? (publicado e do público dele; ADM vê tudo)
CREATE OR REPLACE FUNCTION public.training_material_visible(_audience TEXT, _published BOOLEAN)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin(auth.uid()) OR (
    _published AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_active AND (_audience = 'all' OR _audience = p.role::text)
    )
  );
$$;
REVOKE ALL ON FUNCTION public.training_material_visible(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.training_material_visible(TEXT, BOOLEAN) TO authenticated;

ALTER TABLE public.training_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "training_materials_read" ON public.training_materials;
CREATE POLICY "training_materials_read" ON public.training_materials FOR SELECT TO authenticated
  USING (public.training_material_visible(audience, published));
DROP POLICY IF EXISTS "training_materials_admin_write" ON public.training_materials;
CREATE POLICY "training_materials_admin_write" ON public.training_materials FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_materials TO authenticated;

-- O bucket passa a aceitar também a imagem da capa (gerada ou enviada pelo ADM).
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
       file_size_limit = 52428800
 WHERE id = 'training-docs';

-- Leitura do arquivo: o ADM sempre; os demais só o PDF e a capa de um material
-- que podem ver.
DROP POLICY IF EXISTS "training_docs_read" ON storage.objects;
CREATE POLICY "training_docs_read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'training-docs'
    AND (
      public.is_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.training_materials m
        WHERE (m.pdf_path = storage.objects.name OR m.cover_path = storage.objects.name)
          AND public.training_material_visible(m.audience, m.published)
      )
    )
  );
