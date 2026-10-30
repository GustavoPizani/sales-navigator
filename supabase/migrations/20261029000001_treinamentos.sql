-- Treinamentos: cursos com aulas em vídeo (YouTube não listado) ou em PDF e o
-- progresso de cada usuário. Quem já está cadastrado no sistema assiste com o próprio login.
-- O ADM cria os cursos; cada curso pode ser para todos, só corretores ou só gestores.

CREATE TABLE IF NOT EXISTS public.training_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT,
  -- para quem o curso aparece: todos, só corretores (broker) ou só gestores (master)
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'broker', 'master')),
  published BOOLEAN NOT NULL DEFAULT false,
  position INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.training_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT,
  -- vídeo do YouTube ou PDF guardado no bucket training-docs
  kind TEXT NOT NULL DEFAULT 'video' CHECK (kind IN ('video', 'pdf')),
  -- só o código do vídeo no YouTube (ex.: dQw4w9WgXcQ)
  youtube_id TEXT CHECK (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  -- caminho do PDF no bucket: <id do curso>/<arquivo>.pdf
  pdf_path TEXT,
  duration_min INT CHECK (duration_min IS NULL OR duration_min >= 0),
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT training_lessons_conteudo CHECK (
    (kind = 'video' AND youtube_id IS NOT NULL) OR (kind = 'pdf' AND pdf_path IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS training_lessons_course_idx ON public.training_lessons (course_id, position);

CREATE TABLE IF NOT EXISTS public.training_progress (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.training_lessons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS training_progress_lesson_idx ON public.training_progress (lesson_id);

-- O curso aparece para o usuário? (publicado e do público dele; ADM vê tudo)
CREATE OR REPLACE FUNCTION public.training_course_visible(_course_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin(auth.uid()) OR EXISTS (
    SELECT 1
    FROM public.training_courses c
    JOIN public.profiles p ON p.id = auth.uid() AND p.is_active
    WHERE c.id = _course_id
      AND c.published
      AND (c.audience = 'all' OR c.audience = p.role::text)
  );
$$;
REVOKE ALL ON FUNCTION public.training_course_visible(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.training_course_visible(UUID) TO authenticated;

ALTER TABLE public.training_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "training_courses_read" ON public.training_courses;
CREATE POLICY "training_courses_read" ON public.training_courses FOR SELECT TO authenticated
  USING (public.training_course_visible(id));
DROP POLICY IF EXISTS "training_courses_admin_write" ON public.training_courses;
CREATE POLICY "training_courses_admin_write" ON public.training_courses FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "training_lessons_read" ON public.training_lessons;
CREATE POLICY "training_lessons_read" ON public.training_lessons FOR SELECT TO authenticated
  USING (public.training_course_visible(course_id));
DROP POLICY IF EXISTS "training_lessons_admin_write" ON public.training_lessons;
CREATE POLICY "training_lessons_admin_write" ON public.training_lessons FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- Progresso: cada um marca o seu; o ADM vê todos; o gestor vê a própria equipe.
DROP POLICY IF EXISTS "training_progress_read" ON public.training_progress;
CREATE POLICY "training_progress_read" ON public.training_progress FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = training_progress.user_id AND p.manager_id = auth.uid())
  );
DROP POLICY IF EXISTS "training_progress_own_insert" ON public.training_progress;
CREATE POLICY "training_progress_own_insert" ON public.training_progress FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "training_progress_own_delete" ON public.training_progress;
CREATE POLICY "training_progress_own_delete" ON public.training_progress FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_courses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_lessons TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.training_progress TO authenticated;

-- PDFs dos treinamentos: o ADM envia; só abre para quem pode ver o curso
-- (a primeira pasta do caminho é o id do curso).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('training-docs', 'training-docs', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "training_docs_admin_write" ON storage.objects;
CREATE POLICY "training_docs_admin_write" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'training-docs' AND public.is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'training-docs' AND public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "training_docs_read" ON storage.objects;
CREATE POLICY "training_docs_read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'training-docs'
    AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    AND public.training_course_visible(((storage.foldername(name))[1])::uuid)
  );

-- Módulo "Treinamentos" na matriz de permissões: gestores e corretores assistem;
-- RH fica oculto (o ADM pode mudar na tela de Permissões). O cargo ADM fica de
-- fora: tem sempre acesso total e a matriz não aceita linha para ele.
INSERT INTO public.cargo_permissions (cargo_id, module, level)
SELECT c.id, 'training',
       CASE c.base_role::text WHEN 'master' THEN 'view' WHEN 'broker' THEN 'view' ELSE 'hidden' END
FROM public.cargos c
WHERE c.base_role::text NOT IN ('admin', 'director')
ON CONFLICT (cargo_id, module) DO NOTHING;
