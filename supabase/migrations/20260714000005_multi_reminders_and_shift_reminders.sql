-- Allows managers to configure MULTIPLE reminder lead times per appointment
-- (e.g. 1 day before + 30 min before) instead of a single value, and adds a
-- separate "escala" (shift) reminder the day before, at a manager-configured
-- time of day.

-- reminder_minutes becomes an array. Existing single values are preserved
-- as a one-item array.
ALTER TABLE public.profiles
  ALTER COLUMN reminder_minutes DROP DEFAULT;
ALTER TABLE public.profiles
  ALTER COLUMN reminder_minutes TYPE INTEGER[] USING ARRAY[reminder_minutes];
ALTER TABLE public.profiles
  ALTER COLUMN reminder_minutes SET DEFAULT '{30}';

-- Tracks which lead times have already fired for a given appointment, so
-- each configured reminder only ever fires once.
ALTER TABLE public.appointments
  DROP COLUMN IF EXISTS reminder_sent_at;
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS reminder_sent_minutes INTEGER[] NOT NULL DEFAULT '{}';

-- Manager-configured time of day (local, America/Sao_Paulo) at which
-- brokers get a reminder about the next day's shift. NULL disables it.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS shift_reminder_time TIME;

-- Marks when the day-before shift reminder was sent for a given shift, so
-- it's never sent twice.
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
