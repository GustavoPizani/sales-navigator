-- Step 1: Extend the app_role enum with new values.
-- Run THIS FILE FIRST in Supabase SQL Editor, then run 20260519200001_schema_updates.sql
-- (ALTER TYPE ADD VALUE cannot be used in the same transaction as code that reads the new values)

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'director';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'master';
