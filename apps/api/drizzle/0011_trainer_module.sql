-- TetherProof: the training provider module.
--
-- Written by hand like 0003–0010 and following their house style.
--
-- doc/02 Module 4 asks for two things: institutional milestone issuance and a
-- market demand dashboard. This migration adds the storage both need, and nothing
-- else. No existing object is altered and no row is written.
--
-- The design decision worth reading before the SQL is that a credential cannot be
-- final the moment an instructor signs it. doc/02 §5.1 calls a micro-credential
-- "dual-backed" without defining the second backing party, and the only reading
-- consistent with this platform's stated purpose is two independent parties: the
-- institute, and the student the credential is about. Every other proof here works
-- the same way — a worker's own claim is never sufficient on its own — and an
-- institute that could write straight to a student's capability graph would make
-- its own graduates the most credentialed people on the network, which is exactly
-- what an endorsement is supposed to mean something about.
--
-- So signing off produces `awaiting_student`, and only the student can move it.
-- That is why the status enum below has no "issued" value.
--
-- It is also why there is no "verified" value, and that is the more important
-- half. The student's agreement is consent to hold an endorsement, not evidence
-- that the skill was independently demonstrated. A bootcamp that issued to a
-- hundred students would otherwise look, on paper, like a hundred people whose
-- work was verified by real customers — when not one of them may have had a
-- customer. The two kinds of evidence stay in separate columns, are counted
-- separately, and are never summed; nothing derived from `work_proof_logs` reads
-- this table.

CREATE TYPE public.micro_credential_status AS ENUM (
  'awaiting_student',
  'accepted',
  'declined'
);

-- A student can only answer a credential they know exists. Issuing writes a
-- notification because there is no other route by which they would learn an
-- institute has signed off on them, and a credential nobody answers is a credential
-- that silently never counts.
--
-- Added rather than replaced, so the existing enum's ordering and every row already
-- written are untouched. PostgreSQL will not let a value be removed or reordered
-- from an enum that is in use, and neither is wanted here.
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'credential_issued';

-- One student's membership of one institute's roster.
--
-- Enrolment is something the student does, by redeeming a code the institute
-- published. The alternative — an institute typing student addresses into a form —
-- would have the platform collecting the personal details of people who never
-- asked to be on a roster.
--
-- Deliberately no email, phone, or location column. An institute needs a name to
-- put on a milestone and nothing more, and a roster is the kind of table that
-- quietly becomes a contact list.
CREATE TABLE IF NOT EXISTS public.trainer_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  enrolled_at timestamptz NOT NULL DEFAULT now()
);

-- Redeeming a code twice is a double tap, not a second enrolment. Without this a
-- student appears twice on the roster and every pending decision is ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS trainer_students_trainer_student_unique
  ON public.trainer_students (trainer_id, student_id);

-- The institute reads its roster in full, newest enrolments included.
CREATE INDEX IF NOT EXISTS trainer_students_trainer_id_idx
  ON public.trainer_students (trainer_id);

-- The student's own "which institutes am I with" view reads from this side.
CREATE INDEX IF NOT EXISTS trainer_students_student_id_idx
  ON public.trainer_students (student_id);

-- The institute's live enrolment code, stored only as a SHA-256 digest.
--
-- The raw code is returned exactly once, when it is created, and the institute
-- rotates it whenever it wants a fresh one. Rotating invalidates the previous code
-- but touches nobody already enrolled, because enrolment is a row and not a
-- property of the code — which is precisely what makes storing only the digest
-- workable. There is no reason for the value to outlive the moment it was shared,
-- so there is no reason to store it.
CREATE TABLE IF NOT EXISTS public.trainer_enrolment_codes (
  trainer_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Redemption looks the code up by digest, which is the only query this table serves.
CREATE INDEX IF NOT EXISTS trainer_enrolment_codes_hash_idx
  ON public.trainer_enrolment_codes (code_hash);

ALTER TABLE public.trainer_enrolment_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_enrolment_codes FORCE ROW LEVEL SECURITY;

-- No policy at all, deliberately. The API reaches this table with the service role
-- to resolve a code and to write a new one; there is no situation in which a
-- browser key should read it, and a table with RLS forced and no policy denies
-- every non-service reader rather than granting something by default.

-- An institute's credential: the skill, the practical, and whether the student has
-- answered it yet.
--
-- `student_id` is nullable and sets null rather than cascading, matching
-- `capability_blocks` and `work_proof_logs`. A student who has earned a credential
-- must still be able to delete their account: the two `ON DELETE restrict` keys
-- that once made that impossible are `doc/13` E-025, and adding a third would
-- repeat it. The row is retained and stamped so the skill and the institute keep
-- contributing to aggregate counts while the person does not.
--
-- `issued_by` also sets null. A credential is the institute's record, so one
-- instructor leaving must not erase what the institute signed. It is null in that
-- case rather than being credited to whoever happens to be signed in next: an
-- endorsement nobody can attribute is shown as unattributed.
--
-- Unlike every other name-bearing column in this schema, `issued_by` is read back
-- and shown — to the student, who is entitled to know who signed a record about
-- them. An endorsement with no name behind it is the exact kind of claim this
-- platform exists to make attributable, so the issuer is part of the evidence
-- rather than a detail withheld from it. It is shown to the student only: never to
-- another student, never to an employer, never to a different institute.
CREATE TABLE IF NOT EXISTS public.micro_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  trainer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  issued_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  capability_block_id uuid REFERENCES public.capability_blocks(id) ON DELETE SET NULL,
  skill_tag varchar(160) NOT NULL,
  skill_level integer NOT NULL DEFAULT 1,
  milestone_title varchar(200) NOT NULL,
  note text,
  status public.micro_credential_status NOT NULL DEFAULT 'awaiting_student',
  issued_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  anonymised_at timestamptz
);

CREATE INDEX IF NOT EXISTS micro_credentials_trainer_id_idx
  ON public.micro_credentials (trainer_id);

-- Deliberately not unique on (trainer_id, student_id, skill_tag): a student who
-- repeats a course earns a second credential for the same skill, and an institute
-- running two intakes of the same syllabus must be able to say which was which.
-- `milestone_title` and `issued_at` are what distinguish them.

CREATE INDEX IF NOT EXISTS micro_credentials_student_id_idx
  ON public.micro_credentials (student_id);

-- The institute's list is read newest first, and the student's own page reads both
-- of its buckets; every query in this module filters on one of these two.
CREATE INDEX IF NOT EXISTS micro_credentials_trainer_issued_idx
  ON public.micro_credentials (trainer_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS micro_credentials_student_status_idx
  ON public.micro_credentials (student_id, status);

-- RLS as in 0004 and 0010: enabled and forced, with select-only policies scoped to
-- the owner. The API reaches these tables with the service role and is unaffected.
--
-- The roster policy is scoped to the institute, so a student enrolled with one
-- institute is invisible to every other even if an `authenticated` grant were
-- mistakenly handed out.

ALTER TABLE public.trainer_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_students FORCE ROW LEVEL SECURITY;

CREATE POLICY trainer_students_select_own ON public.trainer_students
  FOR SELECT
  USING (trainer_id = auth.uid() OR student_id = auth.uid());

-- A credential is readable by the institute that issued it and by the student it
-- is about, and by nobody else. No employer is granted a path here at all: a
-- micro-credential is institutional evidence, not a client verification, and it
-- never reaches the fraud-scored proof count that employer search ranks on.
ALTER TABLE public.micro_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.micro_credentials FORCE ROW LEVEL SECURITY;

CREATE POLICY micro_credentials_select_participants ON public.micro_credentials
  FOR SELECT
  USING (trainer_id = auth.uid() OR student_id = auth.uid());

COMMENT ON TABLE public.trainer_students IS
  'Students a training provider has enrolled, by redeeming an institute code. Holds a name and nothing else: no email, phone, or location.';

COMMENT ON TABLE public.micro_credentials IS
  'Micro-credentials an institute has signed off. Dual-backed: signing off yields awaiting_student and only the student can accept or decline, so an institution cannot attach an endorsement to a record unaided. Institutional evidence, NOT a customer-verified work proof: never counted toward the fraud-scored verified total, and never readable by an employer.';

COMMENT ON COLUMN public.micro_credentials.status IS
  'No "issued" or "verified" value exists, deliberately. awaiting_student is what signing off produces, and accepted records only that the student agreed to hold the endorsement — not that the skill was independently demonstrated.';

COMMENT ON COLUMN public.micro_credentials.issued_by IS
  'The member of staff who signed off, shown to the student and to nobody else. Null means the account is gone; the credential is the institute''s record and survives.';

COMMENT ON TABLE public.trainer_enrolment_codes IS
  'One live enrolment code per institute, stored only as a SHA-256 digest. The raw value is returned once at creation; rotating it does not unenrol anybody.';
