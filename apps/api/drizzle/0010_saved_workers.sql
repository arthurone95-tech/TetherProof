-- TetherProof: an employer's saved workers.
--
-- Written by hand like 0003–0009 and following their house style.
--
-- Employer search has always been zero-knowledge: a card carries a handle, a
-- skill, aggregates and a distance, and no worker id. That shape is unchanged
-- here. What this table adds is somewhere for an employer to keep the workers
-- they mean to come back to, which search deliberately cannot do on its own
-- because it re-issues handles that expire.
--
-- Two things this table is careful about.
--
-- The first is that saving a worker creates, for the first time, a durable record
-- that a particular employer was interested in a particular person. Search is
-- stateless by design precisely so that no such record accumulates. This is
-- accepted deliberately and narrowly: the row is scoped to the employer who
-- wrote it, is never exposed to the worker, and is never returned to another
-- employer. An employer saving a candidate is a statement about their own
-- intentions, and there is no product reason to hide that from them.
--
-- The second is that the worker is referenced by account id, which is the
-- identifier search refuses to emit. That is fine here because the row is never
-- read by anything but the owning employer's own request: the API resolves the
-- handle to a worker on save, and hands back a freshly issued handle on read so
-- the client never sees the id it stored.
--
-- Deleting an account removes the row by cascade from either side. A worker who
-- deletes their account therefore disappears from saved lists without the
-- employer being told anything, which is the same treatment every other surface
-- gives an anonymised record.
CREATE TABLE IF NOT EXISTS public.employer_saved_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  skill_tag varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One entry per employer, worker and skill. Saving the same worker twice under
-- the same skill is a double tap, not a second intention.
CREATE UNIQUE INDEX IF NOT EXISTS employer_saved_workers_unique
  ON public.employer_saved_workers (employer_id, worker_id, skill_tag);

-- The list is read in full for one employer, newest first.
CREATE INDEX IF NOT EXISTS employer_saved_workers_employer_idx
  ON public.employer_saved_workers (employer_id, created_at DESC);

-- The worker side exists only so the cascade has something to reference.
CREATE INDEX IF NOT EXISTS employer_saved_workers_worker_idx
  ON public.employer_saved_workers (worker_id);

-- RLS as in 0004: enabled and forced, with a select-only policy scoped to the
-- owner. The API reaches the table with the service role and is unaffected; a
-- browser key holding an `authenticated` grant could not read another employer's
-- saved workers even if one were mistakenly granted.
ALTER TABLE public.employer_saved_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_saved_workers FORCE ROW LEVEL SECURITY;

CREATE POLICY employer_saved_workers_select_own ON public.employer_saved_workers
  FOR SELECT
  USING (employer_id = auth.uid());

COMMENT ON TABLE public.employer_saved_workers IS
  'Workers an employer has chosen to keep. Scoped to the employer who saved them, never surfaced to the worker or to another employer, and removed by cascade when either account is deleted.';
