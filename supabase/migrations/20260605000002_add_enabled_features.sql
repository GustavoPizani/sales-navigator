-- Add enabled_features JSONB column to profiles for modular feature control.
-- Admins store their team's feature config here; brokers inherit from their manager.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS enabled_features JSONB NOT NULL DEFAULT
    '{"schedule":true,"agendamentos":true,"projects":true,"team":true}'::jsonb;
