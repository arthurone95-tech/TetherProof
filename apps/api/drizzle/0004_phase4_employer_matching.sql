-- TetherProof: Phase 4 employer discovery and matching.
--
-- Three groups of change.
--
-- 1. `public.employer_approvals` gates the actions that can harm someone who
--    has not opted in. Anyone may register as an employer (frictionless signup is
--    a product requirement), but searching is read-only and harmless while
--    *sending* an unsolicited invitation is not. So approval gates sending, not
--    looking. The row is auditable rather than a boolean on `users`, because an
--    approval decision needs a reviewer and a timestamp to be defensible.
--
-- 2. `public.candidate_handles` is how a masked candidate card is addressed.
--    `direct_offers.worker_id` is a real foreign key, so an employer has to be
--    able to name a specific candidate, but Feature 4.2 promises not to reveal
--    who they are. A handle is a random token resolved by the server and scoped
--    to the employer who received it, so no worker id is ever returned by a
--    search and one employer's handles mean nothing to another.
--
--    Deliberately NO insert or update policy. A candidate must not be able to
--    mint a handle naming an arbitrary worker, and the API writes these rows
--    with the service role, which bypasses RLS.
--
-- 3. `public.direct_offers` gains the columns a pipeline actually needs:
--    a note, the spec it came from, and when the worker answered.

-- --------------------------------------------------------------------------
-- 1. Employer approval
-- --------------------------------------------------------------------------
CREATE TYPE public.employer_verification_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE public.employer_approvals (
  -- An employer has at most one approval record; changing the decision updates
  -- this row rather than accumulating history, and `reviewed_at` records when.
  employer_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  status public.employer_verification_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- Short reviewer note. Never holds a document reference or contact detail.
  note varchar(200),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.employer_approvals IS
  'Approval state for employer accounts. Absent row means pending, which is the same as an explicit pending row; searching is allowed either way and sending an offer is not.';
COMMENT ON COLUMN public.employer_approvals.status IS
  '''approved'' is the only state that permits sending an offer. ''rejected'' blocks it and is retained so a rejected account cannot simply re-apply.';

-- --------------------------------------------------------------------------
-- 2. Candidate handles
-- --------------------------------------------------------------------------
CREATE TABLE public.candidate_handles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Random, not derived from the worker id. A derived value would be stable
  -- across employers and therefore correlatable by anyone holding two results.
  handle varchar(64) NOT NULL,
  -- Handles are a temporary capability to address one card, not a durable
  -- pseudonymous identifier, so they expire.
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_handles_employer_worker_unique UNIQUE (employer_id, worker_id)
);

CREATE UNIQUE INDEX candidate_handles_handle_unique ON public.candidate_handles (handle);
CREATE INDEX candidate_handles_employer_idx ON public.candidate_handles (employer_id);
-- Supports the expiry sweep without scanning live handles.
CREATE INDEX candidate_handles_expires_at_idx ON public.candidate_handles (expires_at);

COMMENT ON TABLE public.candidate_handles IS
  'Employer-scoped opaque handles letting an employer act on a masked candidate card. Resolution requires matching employer_id, so a handle is useless to any other employer.';

-- --------------------------------------------------------------------------
-- 3. Offer pipeline columns
-- --------------------------------------------------------------------------
ALTER TABLE public.direct_offers
  ADD COLUMN note varchar(500),
  ADD COLUMN spec_id uuid REFERENCES public.employer_specs(id) ON DELETE SET NULL,
  ADD COLUMN responded_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.direct_offers.note IS
  'Free text from the employer, shown to the worker when they decide. Bounded, and rendered as text, never as markup.';
COMMENT ON COLUMN public.direct_offers.responded_at IS
  'When the worker accepted or declined. Null while pending.';

-- --------------------------------------------------------------------------
-- Row level security
--
-- Both new tables are FORCEd, matching `work_proof_logs` and `verifications`.
-- The `service_role` bypasses RLS entirely, so the API is the real boundary;
-- these policies exist so that a browser key holding an `authenticated` grant
-- could not read another employer's approvals or handles even if one were
-- mistakenly granted.
-- --------------------------------------------------------------------------
ALTER TABLE public.employer_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_handles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_handles FORCE ROW LEVEL SECURITY;

CREATE POLICY employer_approvals_select_own ON public.employer_approvals
  FOR SELECT
  USING (employer_id = auth.uid());

-- Select-only on purpose. See the note above the table.
CREATE POLICY candidate_handles_select_own ON public.candidate_handles
  FOR SELECT
  USING (employer_id = auth.uid());

-- --------------------------------------------------------------------------
-- Drop the dormant capability counters
--
-- `capability_blocks.proof_count` and `last_verified_at` have existed since the
-- first migration and no code path has ever written them. Zero-knowledge search
-- ranks on verified proof counts, so leaving them would mean either trusting a
-- number that is always zero or building a second, incrementing copy of a fact
-- that `work_proof_logs` already records authoritatively.
--
-- They are dropped rather than populated. Two sources of truth for one number
-- drift, and a column that looks meaningful while always reading zero is worse
-- than no column at all: it invites a future reader to trust it. This is the
-- same reasoning that removed the plaintext `verifier_phone` column in E-022.
--
-- Search aggregates from `work_proof_logs` at read time. At pre-launch volume
-- that is an indexed aggregate over a few thousand rows, and it cannot drift
-- out of step with the proofs it summarises.
-- --------------------------------------------------------------------------
ALTER TABLE public.capability_blocks
  DROP COLUMN proof_count,
  DROP COLUMN last_verified_at;