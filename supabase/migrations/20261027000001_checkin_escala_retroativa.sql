-- Escala feita depois do check-in.
-- Quem chega sem estar escalado faz check-in como stand-by. Se depois alguém
-- escala essa pessoa no mesmo dia e turno (escala retroativa), o plantão novo
-- ficava "Pendente" ao lado do check-in do stand-by, ocupando vaga duas vezes.
--   1. crm_vincular_checkin_plantao: liga o check-in já feito (sem plantão) ao
--      plantão do mesmo corretor, dia e horário, como check-in de escalado.
--   2. Gatilho em shifts: toda escala nova faz essa ligação na hora.
--   3. Corrige os casos de outubro (26 e 27/10: 8 check-ins).
-- O log de check-ins não muda (é imutável): os registros de stand-by e
-- substituição continuam lá; a presença já estava registrada.
-- Pode rodar de novo sem erro.

BEGIN;

CREATE OR REPLACE FUNCTION public.crm_vincular_checkin_plantao(_shift public.shifts)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.roulette_checkins rc
     SET shift_id = _shift.id,
         kind = 'scheduled',
         status = 'validated',
         slot_id = coalesce(_shift.slot_id, rc.slot_id)
   WHERE rc.id = (
     SELECT x.id FROM public.roulette_checkins x
      WHERE x.broker_id = _shift.broker_id
        AND x.turn_date = _shift.date
        AND x.start_time = _shift.start_time
        AND x.shift_id IS NULL
        AND x.status IN ('validated', 'standby', 'allocated', 'waiting_admin', 'not_allocated')
      ORDER BY x.created_at
      LIMIT 1);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_vincular_checkin_plantao(public.shifts) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.shifts_vincular_checkin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.crm_vincular_checkin_plantao(NEW);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.shifts_vincular_checkin() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS shifts_vincular_checkin ON public.shifts;
CREATE TRIGGER shifts_vincular_checkin AFTER INSERT ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_vincular_checkin();

-- casos já existentes
SELECT public.crm_vincular_checkin_plantao(sh)
  FROM public.shifts sh
 WHERE EXISTS (SELECT 1 FROM public.roulette_checkins x
                WHERE x.broker_id = sh.broker_id AND x.turn_date = sh.date AND x.start_time = sh.start_time
                  AND x.shift_id IS NULL
                  AND x.status IN ('validated', 'standby', 'allocated', 'waiting_admin', 'not_allocated'));

COMMIT;

-- Conferência: deve dar 0 (nenhum check-in sem plantão quando o plantão existe)
SELECT count(*) AS checkins_sem_plantao
  FROM public.roulette_checkins x
  JOIN public.shifts sh ON sh.broker_id = x.broker_id AND sh.date = x.turn_date AND sh.start_time = x.start_time
 WHERE x.shift_id IS NULL;
