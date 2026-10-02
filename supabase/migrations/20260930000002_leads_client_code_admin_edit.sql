-- ID do cliente no lead, vínculo agendamento → lead e trava de edição dos
-- dados pessoais do lead (somente admin).

-- ── ID do cliente (código informado pelo gestor/corretor) ──────────────────
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS client_code TEXT;
CREATE INDEX IF NOT EXISTS leads_client_code_idx ON public.leads (client_code);

-- ── Agendamento vinculado ao lead ──────────────────────────────────────────
-- client_id continua guardando o ID do cliente (texto livre, como antes);
-- lead_id é o vínculo com o CRM.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS appointments_lead_idx ON public.appointments (lead_id);

-- ── Somente admin altera nome, telefone, e-mail e ID do cliente ────────────
-- Etapa, temperatura, imóvel, anotações etc. seguem as políticas de leads.
-- Sem usuário autenticado (service role: captação de leads, rotinas) é liberado.
CREATE OR REPLACE FUNCTION public.leads_protect_personal_data()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NEW.full_name, NEW.email, NEW.phone, NEW.client_code)
         IS DISTINCT FROM (OLD.full_name, OLD.email, OLD.phone, OLD.client_code)
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_active = true
     )
  THEN
    RAISE EXCEPTION 'Somente o administrador pode alterar os dados do lead.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS leads_protect_personal_data ON public.leads;
CREATE TRIGGER leads_protect_personal_data BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_protect_personal_data();
