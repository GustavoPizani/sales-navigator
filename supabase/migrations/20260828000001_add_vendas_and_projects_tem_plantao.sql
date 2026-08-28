-- Backfills schema that existed in the production database (Lovable Cloud)
-- but was never captured as a migration in this repo.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS tem_plantao boolean DEFAULT false;

CREATE TABLE IF NOT EXISTS public.vendas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    atendimento_id uuid NOT NULL,
    broker_id uuid NOT NULL,
    data_venda date NOT NULL,
    produto text,
    unidade text,
    valor numeric,
    status text DEFAULT 'approved'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejected_reason text,
    CONSTRAINT vendas_pkey PRIMARY KEY (id),
    CONSTRAINT vendas_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id),
    CONSTRAINT vendas_atendimento_id_fkey FOREIGN KEY (atendimento_id) REFERENCES public.atendimentos(id) ON DELETE CASCADE,
    CONSTRAINT vendas_broker_id_fkey FOREIGN KEY (broker_id) REFERENCES public.profiles(id)
);

ALTER TABLE public.vendas ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendas_delete ON public.vendas FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.app_role, 'master'::public.app_role, 'director'::public.app_role]))))));

CREATE POLICY vendas_insert ON public.vendas FOR INSERT TO authenticated WITH CHECK (((broker_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.app_role, 'master'::public.app_role, 'director'::public.app_role]))))) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = vendas.broker_id) AND (p.manager_id = auth.uid()))))));

CREATE POLICY vendas_select ON public.vendas FOR SELECT TO authenticated USING (((broker_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.app_role, 'master'::public.app_role, 'director'::public.app_role]))))) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = vendas.broker_id) AND (p.manager_id = auth.uid()))))));

CREATE POLICY vendas_update ON public.vendas FOR UPDATE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::public.app_role, 'master'::public.app_role, 'director'::public.app_role]))))) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = vendas.broker_id) AND (p.manager_id = auth.uid()))))));

GRANT ALL ON TABLE public.vendas TO anon;
GRANT ALL ON TABLE public.vendas TO authenticated;
GRANT ALL ON TABLE public.vendas TO service_role;
