-- TetherProof: flagged records, and a route back from an automated decision.
--
-- Written by hand like 0003–0007 and following their house style.
--
-- Phase 3 found that a proof marked `fraud_blocked` was a dead end. Nothing in
-- the system could move it back, the worker was never told it had happened, and
-- the only record of the reasoning was a score they could not see. A penalty with
-- no appeal and no explanation is not a trust signal, it is a reputational risk.
--
-- This adds:
--
--   verification_status 'flagged'   the record is withheld pending review, and is
--                                   explicitly *not* an accusation of fraud
--   work_proof_logs.flagged_at     when the platform raised it
--   work_proof_logs.flag_reason    a plain sentence the worker is allowed to read
--   work_proof_logs.review_status  whether a worker has appealed and where it stands
--   work_proof_logs.reviewed_at    when an admin last decided
--   work_proof_logs.reviewed_by    which admin, so a decision is attributable
--   work_proof_logs.restored_at    when an overturned block was restored
--
-- Deliberately **not** added:
--
--   * A second token or a second verification request type. Rule 8 is explicit
--     that ordinary sharing reuses the existing token, and an appeal is not a new
--     claim about the work — it is a request for a human to look at one that
--     already exists.
--   * Any change to `verifications` or the scoring weights. The signals are the
--     same signals; this migration changes what happens to a worker afterwards,
--     not how the decision is reached.
--
-- `flagged` is inserted *before* any write uses it. As in 0007, nothing here
-- writes a row, so the "new enum label cannot be used in the transaction that
-- adds it" rule is satisfied.
ALTER TYPE "public"."verification_status" ADD VALUE IF NOT EXISTS 'flagged';

-- The review lifecycle. `none` is the default and is also the state of every
-- existing row, so the migration is additive: no proof changes status here.
--
-- `upheld` means an admin agreed the block stands; `overturned` means the record
-- was restored. Both are terminal and both are recorded rather than inferred,
-- because "an admin looked at this and agreed" and "nobody has looked at this
-- yet" must never be indistinguishable on a worker's record.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'proof_review_status') THEN
    CREATE TYPE public.proof_review_status AS ENUM (
      'none',
      'appealed',
      'under_review',
      'upheld',
      'overturned'
    );
  END IF;
END $$;

ALTER TABLE public.work_proof_logs
  ADD COLUMN IF NOT EXISTS flagged_at timestamptz;

ALTER TABLE public.work_proof_logs
  ADD COLUMN IF NOT EXISTS flag_reason varchar(400);

ALTER TABLE public.work_proof_logs
  ADD COLUMN IF NOT EXISTS review_status public.proof_review_status NOT NULL DEFAULT 'none';

ALTER TABLE public.work_proof_logs
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE public.work_proof_logs
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.work_proof_logs
  ADD COLUMN IF NOT EXISTS restored_at timestamptz;

-- The appeal is written from the worker's own account, so the partial index is
-- on the appeal state rather than on an actor column that would not be set.
CREATE INDEX IF NOT EXISTS work_proof_logs_review_status_idx
  ON public.work_proof_logs (review_status)
  WHERE review_status <> 'none';

COMMENT ON TYPE public.proof_review_status IS
  'Where an automated integrity decision on a proof stands. none means no decision has been challenged; overturned means an admin restored the record; upheld means an admin agreed with it.';

COMMENT ON COLUMN public.work_proof_logs.flagged_at IS
  'When the platform withheld this record for review. Set on both flagged and fraud_blocked, so a worker can always tell when and why their record stopped counting.';

COMMENT ON COLUMN public.work_proof_logs.flag_reason IS
  'A plain-language summary of what raised this record, safe to show the worker. Deliberately not a score, a threshold, or any anti-fraud detail: those would describe the detector rather than help the worker respond.';

COMMENT ON COLUMN public.work_proof_logs.review_status IS
  'The appeal lifecycle for this record. Only a flagged or blocked proof can move out of none, and only an admin may move it to upheld or overturned.';

COMMENT ON COLUMN public.work_proof_logs.restored_at IS
  'When an overturned block returned this proof to verified. Kept separately from reviewed_at so the restore is legible on its own, because it is the moment a worker got their income back.';

COMMENT ON COLUMN public.work_proof_logs.verification_status IS
  'pending: awaiting an answer. verified: confirmed and not withheld. rejected: the client said it was not done. flagged: withheld pending human review — suspicious, NOT an accusation. fraud_blocked: withheld after an admin upheld it.';
