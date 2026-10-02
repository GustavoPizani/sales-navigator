-- Horário dos turnos (Manhã, Tarde, Noite) configurável pelo admin nas
-- regras de check-in. Vale para a escala, as vagas e o check-in da roleta.

ALTER TABLE public.roulette_settings
  ADD COLUMN IF NOT EXISTS manha_start TIME NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS manha_end   TIME NOT NULL DEFAULT '14:00',
  ADD COLUMN IF NOT EXISTS tarde_start TIME NOT NULL DEFAULT '14:00',
  ADD COLUMN IF NOT EXISTS tarde_end   TIME NOT NULL DEFAULT '19:00',
  ADD COLUMN IF NOT EXISTS noite_start TIME NOT NULL DEFAULT '19:00',
  ADD COLUMN IF NOT EXISTS noite_end   TIME NOT NULL DEFAULT '23:00';

ALTER TABLE public.roulette_settings DROP CONSTRAINT IF EXISTS roulette_settings_periods_valid;
ALTER TABLE public.roulette_settings ADD CONSTRAINT roulette_settings_periods_valid
  CHECK (manha_start < manha_end AND tarde_start < tarde_end AND noite_start < noite_end
         AND manha_start < tarde_start AND tarde_start < noite_start);

-- Ao mudar o horário de um turno, as vagas e os plantões já lançados dos
-- próximos dias acompanham (hoje e o passado ficam como estavam).
CREATE OR REPLACE FUNCTION public.roulette_settings_sync_periods()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _p RECORD;
BEGIN
  FOR _p IN
    SELECT * FROM (VALUES
      ('Manhã', OLD.manha_start, OLD.manha_end, NEW.manha_start, NEW.manha_end),
      ('Tarde', OLD.tarde_start, OLD.tarde_end, NEW.tarde_start, NEW.tarde_end),
      ('Noite', OLD.noite_start, OLD.noite_end, NEW.noite_start, NEW.noite_end)
    ) AS v(period, old_start, old_end, new_start, new_end)
    WHERE v.old_start <> v.new_start OR v.old_end <> v.new_end
  LOOP
    UPDATE public.shifts sh
       SET start_time = _p.new_start, end_time = _p.new_end
      FROM public.shift_slots ss
     WHERE sh.slot_id = ss.id AND ss.period = _p.period AND ss.date > _today;
    UPDATE public.shift_slots
       SET start_time = _p.new_start, end_time = _p.new_end
     WHERE period = _p.period AND date > _today;
  END LOOP;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS roulette_settings_sync_periods ON public.roulette_settings;
CREATE TRIGGER roulette_settings_sync_periods AFTER UPDATE ON public.roulette_settings
  FOR EACH ROW EXECUTE FUNCTION public.roulette_settings_sync_periods();
