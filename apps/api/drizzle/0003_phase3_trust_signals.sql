-- TetherProof: Phase 3 trust signals.
--
-- Four changes, all in service of the anti-fraud engine.
--
-- 1. `public.work_proof_logs` gains media provenance signals.
--    Feature 2.4 asks for an "AI-fake image detector" that inspects file
--    metadata. The Phase 2 scrubber deletes exactly that metadata before
--    storage, so the detector cannot read it after the fact. The way out is to
--    derive the answer while the metadata still exists, then persist only the
--    conclusion. Every column here is a boolean: no make, no model, no
--    timestamp, no serial number, and no location is retained.
--
-- 2. `public.verifications.verifier_phone_hash` replaces the plaintext column.
--    Collusion detection needs to recognise that two proofs were confirmed by
--    the same party. A salted hash is enough for that and is not reversible to
--    the number, so a database disclosure no longer exposes client phone
--    numbers. The salt lives in the API environment, never here.
--
-- 3. Proximity columns. `proximity_status` is an enum rather than a boolean so
--    that "the client declined to share a location" is recorded as its own
--    outcome and is never confused with "the client was in the next county".
--
-- 4. `public.verifications.fraud_score_detail` records why a verification was
--    scored the way it was. A score a worker cannot interrogate is not
--    defensible, and a dispute about why a proof was blocked has to be
--    answerable from data rather than from logs.

CREATE TYPE public.proximity_status AS ENUM ('within', 'outside', 'unavailable');

ALTER TABLE public.work_proof_logs
  ADD COLUMN media_signal_evaluated boolean NOT NULL DEFAULT false,
  ADD COLUMN media_has_camera_signature boolean,
  ADD COLUMN media_timestamp_plausible boolean,
  ADD COLUMN media_encoder_known boolean;

COMMENT ON COLUMN public.work_proof_logs.media_signal_evaluated IS
  'False when the file could not be examined for provenance signals. A null in any of the three signal columns means "not applicable to this format", which is honest for audio.';
COMMENT ON COLUMN public.work_proof_logs.media_has_camera_signature IS
  'True when the discarded EXIF identified a capture device. Retained as a boolean only; the make, model, and serial numbers are not stored anywhere.';
COMMENT ON COLUMN public.work_proof_logs.media_timestamp_plausible IS
  'True when the discarded capture time was internally consistent with the submission. The timestamp itself is not stored.';
COMMENT ON COLUMN public.work_proof_logs.media_encoder_known IS
  'True when the container is structurally what its declared type claims. Catches hand-assembled files, not AI generation.';

-- The hash column is added before the plaintext column is dropped so the change
-- is order-safe, but the plaintext is deliberately NOT carried across.
--
-- A correct backfill needs the same operator-held salt the API uses, which does
-- not belong in a migration. Hashing here without it would write a weak digest:
-- phone numbers have so little entropy that an unsalted SHA-256 of one can be
-- reversed by brute force over the reachable number space in minutes. Writing
-- that into a column named `verifier_phone_hash` would be worse than the
-- plaintext it replaces, because it would look protected.
--
-- Pre-existing rows therefore lose the number and are read as identity-unknown,
-- which the engine scores as neutral rather than suspicious. At the time of
-- writing the table is empty outside test data, so nothing real is lost.
ALTER TABLE public.verifications
  ADD COLUMN verifier_phone_hash varchar(64),
  ADD COLUMN proximity_km real,
  ADD COLUMN proximity_status public.proximity_status,
  ADD COLUMN fraud_score_detail jsonb,
  ADD COLUMN dispatch_status varchar(32),
  ADD COLUMN dispatch_detail varchar(200);

COMMENT ON COLUMN public.verifications.dispatch_status IS
  '''sent'', ''failed'', or ''not_attempted''. Recorded so a worker whose link never arrived is visible rather than mysterious. Never holds a provider response body, which can echo the recipient number.';
COMMENT ON COLUMN public.verifications.dispatch_detail IS
  'Short, non-identifying reason a dispatch did not succeed.';

ALTER TABLE public.verifications
  DROP COLUMN verifier_phone;

COMMENT ON COLUMN public.verifications.verifier_phone_hash IS
  'Salted SHA-256 of the verifier phone number, used only to recognise repeat verifications of the same party. Not reversible to the number.';
COMMENT ON COLUMN public.verifications.proximity_km IS
  'Great-circle distance in kilometres between the worker submission point and the client tap. Null when either side supplied no location.';
COMMENT ON COLUMN public.verifications.proximity_status IS
  '''unavailable'' means a location was not available on one or both sides. That is an absence of evidence and is never scored as a pass or a failure.';
COMMENT ON COLUMN public.verifications.fraud_score_detail IS
  'Per-signal breakdown behind fraud_score, so a disputed decision can be explained from stored data rather than from server logs.';

CREATE INDEX verifications_verifier_phone_hash_idx
  ON public.verifications (verifier_phone_hash)
  WHERE verifier_phone_hash IS NOT NULL;

CREATE INDEX verifications_proximity_status_idx
  ON public.verifications (proximity_status)
  WHERE proximity_status IS NOT NULL;

CREATE INDEX work_proof_logs_media_signal_idx
  ON public.work_proof_logs (media_signal_evaluated)
  WHERE media_signal_evaluated = true;

-- `verification_status` already carries `fraud_blocked`, so the engine needs no
-- enum change to block a proof.