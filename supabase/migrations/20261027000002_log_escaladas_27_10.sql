-- Correção pontual do log de check-ins (pedido do ADM, 27/10/2026).
-- Duas corretoras entraram no log de 27/10 (turno 09:00) como stand-by que
-- assumiu vaga: a escala delas foi lançada depois do check-in. Elas eram
-- escaladas da vaga; o log passa a mostrar isso:
--   - o registro "standby" vira "checkin" (escalada), ligado ao plantão;
--   - o registro "substituicao" das 08:55 sai (não houve substituição).
-- O log é imutável: o gatilho de proteção é desligado só dentro desta
-- transação e religado antes do COMMIT. Pode rodar de novo sem erro.

BEGIN;

ALTER TABLE public.checkin_log DISABLE TRIGGER checkin_log_immutable;

UPDATE public.checkin_log l
   SET event = 'checkin',
       shift_id = rc.shift_id,
       slot_team_name = NULL,
       replaced_names = NULL
  FROM public.roulette_checkins rc
 WHERE l.checkin_id = rc.id
   AND rc.id IN ('3771343d-b132-47bd-8921-467e16888d76',
                 '03f460cb-dee7-488d-b225-50a13fe82f15')
   AND l.event = 'standby';

DELETE FROM public.checkin_log
 WHERE checkin_id IN ('3771343d-b132-47bd-8921-467e16888d76', '03f460cb-dee7-488d-b225-50a13fe82f15')
   AND event = 'substituicao';

ALTER TABLE public.checkin_log ENABLE TRIGGER checkin_log_immutable;

COMMIT;

-- Conferência: um registro "checkin" para cada uma, com o plantão preenchido
SELECT user_name, event, occurred_at AT TIME ZONE 'America/Sao_Paulo' AS horario, shift_id IS NOT NULL AS com_plantao
  FROM public.checkin_log
 WHERE checkin_id IN ('3771343d-b132-47bd-8921-467e16888d76', '03f460cb-dee7-488d-b225-50a13fe82f15')
 ORDER BY occurred_at;
