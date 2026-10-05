-- TetherProof: E-025 — account deletion by anonymisation, not refusal.
--
-- `capability_blocks.worker_id` and `work_proof_logs.worker_id` were
-- `ON DELETE restrict`, which made any account that had ever logged work
-- impossible to delete. Deleting a worker aborted the whole cascade from
-- `auth.users` and Supabase reported it as:
--
--     AuthRetryableFetchError: Database error deleting user
--
-- which names neither the table nor the constraint and claims to be retryable
-- when four retries failed identically. doc/13 E-025.
--
-- The fix is not cascade. Cascading would delete verified work history, and
-- because search aggregates count proofs across many people, it would also
-- destroy a *different* worker's trust score. The authorised outcome is
-- anonymisation: keep the records, sever the link to the person, keep the totals.
--
-- What actually identifies a worker across the proof chain:
--
--   work_proof_logs.worker_id        the foreign key
--   work_proof_logs.description      free text the worker wrote
--   work_proof_logs.submission_gps   where they were when they logged it
--   work_proof_logs.media_url        path of the stored object, which begins
--                                    with the worker's own user id
--   verifications.verifier_gps       a precise coordinate, on a retained row
--   capability_blocks.worker_id      the foreign key
--
-- What identifies nobody, and is what employers actually consume:
--
--   the skill tag, the verification outcome, the fraud score, the timestamps,
--   and the counts derived from them.
--
-- So the foreign keys become nullable and are nulled on delete, and the
-- identifying text and coordinates are overwritten. The rows survive, which is
-- the whole point: an aggregate that has been quietly decremented is a count
-- that lies, and a network whose numbers move because someone exercised a
-- privacy right is not one anyone should trust.
--
-- --------------------------------------------------------------------------
-- 1. Let the rows outlive their owner
-- --------------------------------------------------------------------------
--
-- `anonymised_at` is deliberately separate from `worker_id is null`. A null
-- foreign key is an absence, and absences are ambiguous: it cannot say whether
-- the worker deleted their account or a write went wrong. E-025 was itself
-- misdiagnosed twice from readings that treated an absent measurement as a
-- measurement of zero, so the anonymised state is marked positively and
-- distinguishably instead of inferred from silence.
ALTER TABLE public.capability_blocks
  ALTER COLUMN worker_id DROP NOT NULL;

ALTER TABLE public.work_proof_logs
  ALTER COLUMN worker_id DROP NOT NULL;

ALTER TABLE public.capability_blocks
  ADD COLUMN anonymised_at timestamptz;

ALTER TABLE public.work_proof_logs
  ADD COLUMN anonymised_at timestamptz;

COMMENT ON COLUMN public.work_proof_logs.anonymised_at IS
  'When this record was detached from the worker who submitted it. Non-null only after an account deletion; the row itself is retained so aggregate proof counts stay true.';
COMMENT ON COLUMN public.work_proof_logs.worker_id IS
  'Null only for an anonymised record whose worker deleted their account. A non-null value always refers to a live account.';
COMMENT ON COLUMN public.capability_blocks.worker_id IS
  'Null only for an anonymised block whose worker deleted their account. The skill tag and level are retained so the block keeps contributing to aggregate counts.';

-- --------------------------------------------------------------------------
-- 2. Swap restrict for set null
-- --------------------------------------------------------------------------
--
-- `SET NULL` rather than `CASCADE` is the whole mechanism: the parent row goes,
-- the evidence stays, and the foreign key empties itself. Doing this in the
-- database rather than in a service is deliberate — a service can be bypassed by
-- the Supabase dashboard, by a migration, or by the smoke suite, and a privacy
-- guarantee that only holds on the path someone remembered to use is not a
-- guarantee.
--
-- `capability_blocks_worker_skill_unique` is on (worker_id, skill_tag). Once
-- worker_id can be null, PostgreSQL treats nulls as distinct, so two anonymised
-- blocks for the same skill are permitted. That is correct: they belong to
-- different deleted people, and collapsing them would destroy a count.
--
-- Note that `work_proof_logs.capability_block_id` keeps pointing at the
-- anonymised block. Severing it as well would strip the skill tag from the proof
-- row and silently remove both records from every aggregate — the exact
-- falsification this migration exists to avoid.
ALTER TABLE public.capability_blocks
  DROP CONSTRAINT capability_blocks_worker_id_users_id_fk;

ALTER TABLE public.capability_blocks
  ADD CONSTRAINT capability_blocks_worker_id_users_id_fk
  FOREIGN KEY (worker_id) REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE public.work_proof_logs
  DROP CONSTRAINT work_proof_logs_worker_id_users_id_fk;

ALTER TABLE public.work_proof_logs
  ADD CONSTRAINT work_proof_logs_worker_id_users_id_fk
  FOREIGN KEY (worker_id) REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE NO ACTION;

-- --------------------------------------------------------------------------
-- 3. Paths that still need a byte-level delete
-- --------------------------------------------------------------------------
--
-- The database cannot remove the stored object. Verified rather than assumed:
--
--   delete from storage.objects  ->  42501, "Direct deletion from storage tables
--   is not allowed. Use the Storage API instead.", raised by
--   storage.protect_delete() even with the row present and even as the table
--   owner. Removing the object through the Storage API works, after which a
--   signed URL for it is refused.
--
-- So a trigger cannot finish the job. A deletion that does not go through
-- application code leaves an object behind whose path still begins with the
-- deleted worker's user id, which re-identifies them through the prefix alone.
--
-- This table makes that gap auditable instead of silent: every object path that
-- is still stored when an account is deleted is recorded here, so it can be
-- removed rather than forgotten. An untracked object is indistinguishable from
-- one that was never created.
--
-- Holding a path here is not a new retention liability. The row is only ever
-- written at deletion time, when the user id in the prefix has just been deleted
-- from `auth.users` and therefore identifies nobody. It identifies the record to
-- delete, and must be deleted itself once that happens.
CREATE TABLE public.orphaned_proof_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL,
  path text NOT NULL,
  -- Retained for audit: which proof the object belonged to. `SET NULL` rather
  -- than cascade, since the proof row outlives the account.
  work_proof_id uuid REFERENCES public.work_proof_logs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX orphaned_proof_media_path_unique ON public.orphaned_proof_media (bucket, path);
CREATE INDEX orphaned_proof_media_work_proof_idx ON public.orphaned_proof_media (work_proof_id)
  WHERE work_proof_id IS NOT NULL;

COMMENT ON TABLE public.orphaned_proof_media IS
  'Stored proof objects still awaiting removal after their account was deleted. Populated by the anonymisation trigger because storage refuses SQL deletion. Remove the object through the Storage API, then delete the row here.';

ALTER TABLE public.orphaned_proof_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orphaned_proof_media FORCE ROW LEVEL SECURITY;

-- No policies at all, by design. Nothing reaches this table over PostgREST; it is
-- written by a trigger and read by the service role only.

-- --------------------------------------------------------------------------
-- 4. The anonymisation itself
-- --------------------------------------------------------------------------
--
-- BEFORE DELETE on `public.users`, so `worker_id` is still set and the rows can
-- be found. A referential action fires as an AFTER trigger on the parent, so
-- this runs first and the FK's own `SET NULL` does the detaching afterwards.
-- A BEFORE DELETE trigger also fires for rows deleted by the cascade from
-- `auth.users`, which is how Supabase's `deleteUser` deletes them.
--
-- SECURITY DEFINER because the deleting role must not need UPDATE on the proof
-- tables in order to scrub them. It is a trigger function and so cannot be
-- invoked directly from SQL at all, which is why it needs no grant and cannot
-- be granted by mistake.
--
-- `verifier_phone_hash` is deliberately retained. It is a salted hash of a
-- *third party's* number, not the worker's, and it is what lets the collusion
-- filter still recognise one client approving many proofs. Scrubbing it would
-- make every verifier look new and silently disable a fraud check. The
-- coordinate beside it is retained by no such argument and is nulled.
CREATE OR REPLACE FUNCTION public.anonymise_account_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Anything still stored is recorded for removal before the pointer is dropped.
  --
  -- The bucket is read back from `storage.objects` rather than assumed, so this
  -- stays correct if `STORAGE_PROOFS_BUCKET` is ever pointed at a different
  -- bucket: a recorded path with the wrong bucket name cannot be removed. The
  -- literal is only the fallback for an object that is somehow recorded but
  -- absent from `storage.objects`, and it must be kept in step with
  -- `STORAGE_PROOFS_BUCKET` in `apps/api/src/config/env.ts`.
  INSERT INTO public.orphaned_proof_media (bucket, path, work_proof_id)
  SELECT coalesce(
           (SELECT s.bucket_id FROM storage.objects s WHERE s.name = w.media_url LIMIT 1),
           'work-proofs'
         ),
         w.media_url,
         w.id
  FROM public.work_proof_logs w
  WHERE w.worker_id = OLD.id AND w.media_url IS NOT NULL
  ON CONFLICT DO NOTHING;

  UPDATE public.verifications
     SET verifier_gps = NULL
   WHERE work_proof_id IN (
     SELECT w.id FROM public.work_proof_logs w WHERE w.worker_id = OLD.id
   );

  UPDATE public.work_proof_logs
     SET description = 'Description removed when the account was deleted.',
         submission_gps = NULL,
         media_url = NULL,
         anonymised_at = now()
   WHERE worker_id = OLD.id
     AND anonymised_at IS NULL;

  UPDATE public.capability_blocks
     SET anonymised_at = now()
   WHERE worker_id = OLD.id
     AND anonymised_at IS NULL;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymise_account_on_delete() FROM PUBLIC;

CREATE TRIGGER users_anonymise_on_delete
  BEFORE DELETE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.anonymise_account_on_delete();
