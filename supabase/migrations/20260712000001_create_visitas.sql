-- Histórico de visitas realizadas. Cada registro é um evento imutável (uma
-- visita), independente de quantas vezes o mesmo cliente já tenha sido
-- registrado em atendimentos — resolve o problema de "visita realizada" ser
-- apenas um boolean que se sobrescreve quando o cliente visita mais de uma vez.
CREATE TABLE IF NOT EXISTS public.visitas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atendimento_id UUID REFERENCES public.atendimentos(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  broker_id UUID NOT NULL REFERENCES public.profiles(id),
  id_cliente TEXT,
  nome_cliente TEXT,
  produto TEXT,
  data_visita DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.visitas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "visitas_broker_own" ON public.visitas;
CREATE POLICY "visitas_broker_own" ON public.visitas
  FOR ALL TO authenticated
  USING (broker_id = auth.uid())
  WITH CHECK (broker_id = auth.uid());

DROP POLICY IF EXISTS "visitas_admin_all" ON public.visitas;
CREATE POLICY "visitas_admin_all" ON public.visitas
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'master', 'director') AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'master', 'director') AND is_active = true
    )
  );

CREATE INDEX IF NOT EXISTS visitas_broker_id_idx ON public.visitas (broker_id);
CREATE INDEX IF NOT EXISTS visitas_data_visita_idx ON public.visitas (data_visita);
CREATE INDEX IF NOT EXISTS visitas_id_cliente_idx ON public.visitas (id_cliente);
CREATE INDEX IF NOT EXISTS visitas_appointment_id_idx ON public.visitas (appointment_id);
