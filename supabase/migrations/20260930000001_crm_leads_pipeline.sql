-- Mini CRM: funis, etapas, leads e anotações.
--
-- Visibilidade por hierarquia: cada usuário enxerga os próprios leads e os de
-- todos abaixo dele na cadeia profiles.manager_id (qualquer profundidade), então
-- novas camadas na hierarquia funcionam sem mudar políticas. Admin e diretor
-- enxergam tudo.

-- ── Helpers de hierarquia ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_is_global(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role IN ('admin', 'director') AND is_active = true
  );
$$;

-- true se _subordinate_id está abaixo de _manager_id na cadeia manager_id.
CREATE OR REPLACE FUNCTION public.crm_is_subordinate(_manager_id UUID, _subordinate_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE chain AS (
    SELECT p.id, p.manager_id, 1 AS depth FROM public.profiles p WHERE p.id = _subordinate_id
    UNION ALL
    SELECT p.id, p.manager_id, c.depth + 1
    FROM public.profiles p JOIN chain c ON p.id = c.manager_id
    WHERE c.depth < 10
  )
  SELECT EXISTS (SELECT 1 FROM chain WHERE manager_id = _manager_id);
$$;

-- Pode ver/editar dados do corretor _broker_id?
CREATE OR REPLACE FUNCTION public.crm_can_access_broker(_broker_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _broker_id = auth.uid()
      OR public.crm_is_global(auth.uid())
      OR public.crm_is_subordinate(auth.uid(), _broker_id);
$$;

REVOKE ALL ON FUNCTION public.crm_is_global(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_is_subordinate(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_can_access_broker(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_is_global(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_is_subordinate(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_can_access_broker(UUID) TO authenticated;

-- Gestores de várias camadas precisam enxergar nome/cor de quem está abaixo
-- deles (profiles_team_view só cobre subordinados diretos).
DROP POLICY IF EXISTS "profiles_hierarchy_view" ON public.profiles;
CREATE POLICY "profiles_hierarchy_view" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.crm_is_subordinate(auth.uid(), id));

-- ── Funis e etapas ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.funnels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- no máximo um funil padrão (entrada de leads sem funil definido)
CREATE UNIQUE INDEX IF NOT EXISTS funnels_single_default ON public.funnels (is_default) WHERE is_default;

CREATE TABLE IF NOT EXISTS public.funnel_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_id UUID NOT NULL REFERENCES public.funnels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#64748b',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (funnel_id, name)
);
CREATE INDEX IF NOT EXISTS funnel_stages_funnel_idx ON public.funnel_stages (funnel_id, sort_order);

ALTER TABLE public.funnels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "funnels_read" ON public.funnels;
CREATE POLICY "funnels_read" ON public.funnels FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "funnels_admin_write" ON public.funnels;
CREATE POLICY "funnels_admin_write" ON public.funnels FOR ALL TO authenticated
  USING (public.crm_is_global(auth.uid())) WITH CHECK (public.crm_is_global(auth.uid()));

DROP POLICY IF EXISTS "funnel_stages_read" ON public.funnel_stages;
CREATE POLICY "funnel_stages_read" ON public.funnel_stages FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "funnel_stages_admin_write" ON public.funnel_stages;
CREATE POLICY "funnel_stages_admin_write" ON public.funnel_stages FOR ALL TO authenticated
  USING (public.crm_is_global(auth.uid())) WITH CHECK (public.crm_is_global(auth.uid()));

-- ── Leads ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.lead_status AS ENUM ('active', 'won', 'lost');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  broker_id UUID NOT NULL REFERENCES public.profiles(id),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  funnel_id UUID NOT NULL REFERENCES public.funnels(id),
  stage_id UUID NOT NULL REFERENCES public.funnel_stages(id),
  status public.lead_status NOT NULL DEFAULT 'active',
  temperatura TEXT CHECK (temperatura IN ('Frio', 'Morno', 'Quente')),
  -- imóvel de interesse
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  -- origem: manual, meta, api, ...
  source TEXT NOT NULL DEFAULT 'manual',
  campaign TEXT,
  external_id TEXT UNIQUE,          -- ex.: id do lead no Meta Lead Ads (dedup)
  form_responses JSONB,
  roulette_id UUID,                 -- FK adicionada junto com a roleta
  won_value NUMERIC(15,2),
  won_at TIMESTAMPTZ,
  lost_reason TEXT,
  lost_at TIMESTAMPTZ,
  stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_broker_idx ON public.leads (broker_id);
CREATE INDEX IF NOT EXISTS leads_funnel_stage_idx ON public.leads (funnel_id, stage_id);
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON public.leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_email_idx ON public.leads (lower(email));
CREATE INDEX IF NOT EXISTS leads_phone8_idx ON public.leads (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8));

-- A etapa precisa pertencer ao funil do lead; mantém updated_at/stage_changed_at.
CREATE OR REPLACE FUNCTION public.leads_before_write()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.funnel_stages WHERE id = NEW.stage_id AND funnel_id = NEW.funnel_id) THEN
    RAISE EXCEPTION 'A etapa % não pertence ao funil %', NEW.stage_id, NEW.funnel_id;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN NEW.stage_changed_at := now(); END IF;
    IF NEW.status = 'won' AND OLD.status IS DISTINCT FROM 'won' AND NEW.won_at IS NULL THEN NEW.won_at := now(); END IF;
    IF NEW.status = 'lost' AND OLD.status IS DISTINCT FROM 'lost' AND NEW.lost_at IS NULL THEN NEW.lost_at := now(); END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS leads_before_write ON public.leads;
CREATE TRIGGER leads_before_write BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_before_write();

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_select" ON public.leads;
CREATE POLICY "leads_select" ON public.leads FOR SELECT TO authenticated
  USING (public.crm_can_access_broker(broker_id));

DROP POLICY IF EXISTS "leads_insert" ON public.leads;
CREATE POLICY "leads_insert" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (public.crm_can_access_broker(broker_id));

-- WITH CHECK impede passar o lead para alguém fora da sua hierarquia.
DROP POLICY IF EXISTS "leads_update" ON public.leads;
CREATE POLICY "leads_update" ON public.leads FOR UPDATE TO authenticated
  USING (public.crm_can_access_broker(broker_id))
  WITH CHECK (public.crm_can_access_broker(broker_id));

DROP POLICY IF EXISTS "leads_delete" ON public.leads;
CREATE POLICY "leads_delete" ON public.leads FOR DELETE TO authenticated
  USING (public.crm_is_global(auth.uid()));

-- ── Anotações ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- 'note' = escrita pelo usuário; 'system' = registro automático (mudança de etapa etc.)
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_notes_lead_idx ON public.lead_notes (lead_id, created_at DESC);

ALTER TABLE public.lead_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_notes_select" ON public.lead_notes;
CREATE POLICY "lead_notes_select" ON public.lead_notes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND public.crm_can_access_broker(l.broker_id)));

DROP POLICY IF EXISTS "lead_notes_insert" ON public.lead_notes;
CREATE POLICY "lead_notes_insert" ON public.lead_notes FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND public.crm_can_access_broker(l.broker_id))
  );

DROP POLICY IF EXISTS "lead_notes_update_own" ON public.lead_notes;
CREATE POLICY "lead_notes_update_own" ON public.lead_notes FOR UPDATE TO authenticated
  USING (author_id = auth.uid() AND kind = 'note') WITH CHECK (author_id = auth.uid() AND kind = 'note');

DROP POLICY IF EXISTS "lead_notes_delete_own" ON public.lead_notes;
CREATE POLICY "lead_notes_delete_own" ON public.lead_notes FOR DELETE TO authenticated
  USING ((author_id = auth.uid() AND kind = 'note') OR public.crm_is_global(auth.uid()));

-- Registro automático de mudança de etapa / ganho / perda no histórico.
CREATE OR REPLACE FUNCTION public.leads_log_changes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _msg TEXT;
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    SELECT format('Etapa alterada: %s → %s',
      (SELECT name FROM public.funnel_stages WHERE id = OLD.stage_id),
      (SELECT name FROM public.funnel_stages WHERE id = NEW.stage_id)) INTO _msg;
    INSERT INTO public.lead_notes (lead_id, author_id, kind, content) VALUES (NEW.id, auth.uid(), 'system', _msg);
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    _msg := CASE NEW.status
      WHEN 'won'  THEN 'Marcado como ganho' || coalesce(' — R$ ' || translate(to_char(NEW.won_value, 'FM999,999,999,990.00'), ',.', '.,'), '')
      WHEN 'lost' THEN 'Marcado como perdido' || coalesce(': ' || NEW.lost_reason, '')
      ELSE 'Reaberto'
    END;
    INSERT INTO public.lead_notes (lead_id, author_id, kind, content) VALUES (NEW.id, auth.uid(), 'system', _msg);
  END IF;
  IF NEW.broker_id IS DISTINCT FROM OLD.broker_id THEN
    INSERT INTO public.lead_notes (lead_id, author_id, kind, content)
    VALUES (NEW.id, auth.uid(), 'system', format('Lead transferido para %s', (SELECT full_name FROM public.profiles WHERE id = NEW.broker_id)));
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS leads_log_changes ON public.leads;
CREATE TRIGGER leads_log_changes AFTER UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_log_changes();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.funnels, public.funnel_stages, public.leads, public.lead_notes TO authenticated;
GRANT ALL ON public.funnels, public.funnel_stages, public.leads, public.lead_notes TO service_role;

-- ── Funil padrão (mesmas etapas do "funil 1" do Real Sales) ─────────────────
DO $$
DECLARE
  _funnel UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.funnels) THEN
    INSERT INTO public.funnels (name, is_default, sort_order) VALUES ('Funil Principal', true, 0) RETURNING id INTO _funnel;
    INSERT INTO public.funnel_stages (funnel_id, name, sort_order, color) VALUES
      (_funnel, 'Contato',      1, '#64748b'),
      (_funnel, 'Qualificação', 2, '#0891b2'),
      (_funnel, 'Agendamento',  3, '#2563eb'),
      (_funnel, 'Visita',       4, '#7c3aed'),
      (_funnel, 'Proposta',     5, '#d97706'),
      (_funnel, 'Venda',        6, '#16a34a');
  END IF;
END $$;
