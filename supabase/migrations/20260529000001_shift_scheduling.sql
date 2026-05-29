-- Shift scheduling tables and functions

-- shift_configs
CREATE TABLE IF NOT EXISTS public.shift_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  modality TEXT NOT NULL DEFAULT 'online',
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  link_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shift_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shift_configs_admin_all" ON public.shift_configs;
CREATE POLICY "shift_configs_admin_all" ON public.shift_configs
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- shift_slots
CREATE TABLE IF NOT EXISTS public.shift_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES public.shift_configs(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  period TEXT NOT NULL,
  capacity INT NOT NULL DEFAULT 1,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shift_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shift_slots_admin_all" ON public.shift_slots;
CREATE POLICY "shift_slots_admin_all" ON public.shift_slots
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "shift_slots_broker_read" ON public.shift_slots;
CREATE POLICY "shift_slots_broker_read" ON public.shift_slots
  FOR SELECT TO authenticated USING (true);

-- slot_id em shifts
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS slot_id UUID REFERENCES public.shift_slots(id) ON DELETE SET NULL;

-- Permite corretores atualizarem seus próprios plantões
DROP POLICY IF EXISTS "shifts_broker_update_own" ON public.shifts;
CREATE POLICY "shifts_broker_update_own" ON public.shifts
  FOR UPDATE TO authenticated
  USING (broker_id = auth.uid())
  WITH CHECK (broker_id = auth.uid());

-- Drop funções existentes para permitir recriar com assinatura correta
DROP FUNCTION IF EXISTS public.get_shift_config_by_token(TEXT);
DROP FUNCTION IF EXISTS public.claim_shift_slot(UUID, UUID);

-- RPC: retorna config + vagas pelo token
CREATE OR REPLACE FUNCTION public.get_shift_config_by_token(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'id', sc.id,
    'week_start_date', sc.week_start_date,
    'modality', sc.modality,
    'link_token', sc.link_token,
    'slots', COALESCE((
      SELECT json_agg(
        json_build_object(
          'id', ss.id,
          'date', ss.date,
          'period', ss.period,
          'capacity', ss.capacity,
          'start_time', ss.start_time,
          'end_time', ss.end_time,
          'claimed_count', (
            SELECT COUNT(*) FROM public.shifts sh WHERE sh.slot_id = ss.id
          )
        ) ORDER BY ss.date, ss.start_time
      )
      FROM public.shift_slots ss
      WHERE ss.config_id = sc.id
    ), '[]'::json)
  )
  INTO v_result
  FROM public.shift_configs sc
  WHERE sc.link_token = p_token;

  RETURN v_result;
END;
$$;

-- RPC: reserva uma vaga atomicamente
CREATE OR REPLACE FUNCTION public.claim_shift_slot(p_slot_id UUID, p_broker_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_slot  public.shift_slots%ROWTYPE;
  v_count INT;
  v_mgr   UUID;
BEGIN
  SELECT * INTO v_slot FROM public.shift_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vaga não encontrada.';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.shifts WHERE slot_id = p_slot_id AND broker_id = p_broker_id;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Você já garantiu esta vaga.';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.shifts WHERE slot_id = p_slot_id;
  IF v_count >= v_slot.capacity THEN
    RAISE EXCEPTION 'Vaga esgotada.';
  END IF;

  SELECT manager_id INTO v_mgr FROM public.shift_configs WHERE id = v_slot.config_id;

  INSERT INTO public.shifts (broker_id, manager_id, date, start_time, end_time, slot_id)
  VALUES (p_broker_id, v_mgr, v_slot.date, v_slot.start_time, v_slot.end_time, p_slot_id);
END;
$$;
