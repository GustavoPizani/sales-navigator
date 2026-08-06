-- The old (Lovable) project has a `setor` column on profiles that was added
-- directly on the database and never captured in a tracked migration —
-- brokers are classified as 'Online' or 'Salão', already relied on by the
-- app (useAuth.tsx's Profile type, team.tsx, dashboard.tsx, useBrokers.ts).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS setor TEXT NOT NULL DEFAULT 'Online'
  CHECK (setor IN ('Online', 'Salão'));
