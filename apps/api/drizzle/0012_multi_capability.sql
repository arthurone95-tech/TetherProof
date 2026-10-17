-- TetherProof: multiple capabilities per account, and the business entity.
--
-- ## This is the EXPAND phase. It does not drop anything.
--
-- Migration `0013_drop_user_role.sql` drops `public.users.role`, and it cannot run until
-- the application code that still reads that column has been replaced. Applying both in
-- one file would mean one of two things:
--
--   * apply the migration first, and every authenticated request 500s until the new code
--     is deployed — the signed-in web app is down, because the web layout reads the
--     profile on every page; or
--   * deploy the code first, and every authenticated request 500s until the migration is
--     applied, for the same reason in reverse.
--
-- Neither is acceptable for a live system with real accounts, so this file only *adds*.
-- After it is applied, the old code and the new code both work, which is the whole point:
-- there is no window in which the two disagree.
--
-- ## What this changes and why it is not cosmetic
--
-- `public.users.role` is a single column. One person could therefore be a worker, an
-- employer, or a training provider, and no two of them at once — so Kojo the electrician
-- who studies at an institute and runs a business needed three accounts, and three
-- portfolios that could never be joined into one.
--
-- This adds the set that replaces that scalar, and the business entity the agreed design
-- needs so employer access is a *membership* rather than something a person claims about
-- themselves.
--
-- The change is deliberately narrow in one important respect: **no Row Level Security
-- policy anywhere in this repository references `role`.** Every policy in 0001–0011 keys
-- on `auth.uid()` or on which party a row belongs to. The database isolation boundary was
-- already role-agnostic, so granting somebody a second capability cannot widen it. That is
-- the single most important fact for the security of this change, and it is why the risk
-- here is in application code rather than in the data layer.

-- ---------------------------------------------------------------------------
-- Capability vocabulary
-- ---------------------------------------------------------------------------

-- `trainee` is the fourth capability and is genuinely new as a *capability*, though not as
-- a concept: migration 0011 already modelled a student as a membership of an institute via
-- `trainer_students`. What is new is that the membership now *grants* something, so a person
-- who has completed no paid work can hold a student record without pretending to be a
-- worker.
--
-- `employer` is a capability but is granted through a business (or, for accounts that
-- already held it, by the backfill below). Admin is not here on purpose.
CREATE TYPE public.user_capability AS ENUM (
  'worker',
  'employer',
  'training_provider',
  'trainee'
);

-- Why a capability was granted, recorded rather than inferred. This is the audit trail for
-- the security question "who gave this person employer rights", and it is what makes
-- 'legacy' distinguishable from 'self' when a real person's access is reviewed.
CREATE TYPE public.capability_grant_source AS ENUM (
  'self',
  'legacy',
  'enrolment',
  'business',
  'admin',
  'registration'
);

CREATE TYPE public.business_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE public.business_member_role AS ENUM ('owner', 'member');

-- ---------------------------------------------------------------------------
-- user_capabilities
-- ---------------------------------------------------------------------------

-- The set that replaces `users.role`. Composite primary key, so holding two capabilities is
-- two rows and holding the same one twice is impossible by construction rather than by a
-- unique index someone might forget to add.
--
-- `granted_by` is null for a self-service grant and for the backfill, which is the honest
-- answer: nobody else was involved.
CREATE TABLE IF NOT EXISTS public.user_capabilities (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  capability public.user_capability NOT NULL,
  grant_source public.capability_grant_source NOT NULL DEFAULT 'self',
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, capability)
);

-- Capability lookups are always "every capability for these accounts", so the leading column
-- is the useful one.
CREATE INDEX IF NOT EXISTS user_capabilities_capability_idx
  ON public.user_capabilities (capability);

-- ---------------------------------------------------------------------------
-- businesses
-- ---------------------------------------------------------------------------

-- The business is a real entity, not a label on a person, because the agreed design says the
-- owner's personal worker identity stays separate from the business's employer permissions.
-- Kojo the electrician and "Kojo Electrical Services" are different things that happen to
-- share an owner, and only the second one holds hiring rights.
--
-- `status` mirrors `employer_approvals` deliberately: an approval is a row with a reviewer,
-- a time and an optional note, not a boolean, because "approved: yes" becomes
-- indistinguishable from "approved by a colleague last quarter". Self-registration stays open
-- so there is somebody to approve — the same reasoning that left employer registration open
-- in the first place, and it is why a pending business is useful rather than broken.
CREATE TABLE IF NOT EXISTS public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status public.business_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  note varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The owner's own list of businesses.
CREATE INDEX IF NOT EXISTS businesses_owner_idx ON public.businesses (owner_user_id);

-- The admin queue, newest first.
CREATE INDEX IF NOT EXISTS businesses_status_idx ON public.businesses (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- business_memberships
-- ---------------------------------------------------------------------------

-- Who may act for a business. A membership is what grants the `employer` capability, so
-- this table is the answer to "why may this person hire?" and it is deliberately a
-- different thing from holding the capability directly: an owner can add a colleague who
-- then also holds it, and revoking the membership takes the capability away again.
CREATE TABLE IF NOT EXISTS public.business_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  member_role public.business_member_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One membership per person per business. Doubling it would double the employer surface,
-- which is the same reasoning as the unique index on direct_offers.
CREATE UNIQUE INDEX IF NOT EXISTS business_memberships_unique
  ON public.business_memberships (business_id, user_id);

-- "Which businesses am I in", which is how a member finds a workspace they did not create.
CREATE INDEX IF NOT EXISTS business_memberships_user_idx
  ON public.business_memberships (user_id);

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- Every existing account keeps exactly what it had. This is the line that makes the change
-- non-destructive: an employer, a worker and a training provider in production today become
-- exactly those capabilities, and nothing they can reach changes.
--
-- `legacy` is recorded as the source so a later audit can tell an inherited grant from a
-- deliberate one. The literals are cast explicitly because an unadorned literal is resolved
-- to `text` rather than to the column's enum type, which fails the whole migration.
--
-- Verified against the live database on 2026-10-17 by applying this file inside a
-- transaction and rolling it back: 9 of 9 accounts mapped, 0 missing, 0 mismatched.
INSERT INTO public.user_capabilities (user_id, capability, grant_source, granted_at)
SELECT u.id,
  u.role::text::public.user_capability,
  'legacy'::public.capability_grant_source,
  u.created_at
  FROM public.users u
 WHERE u.role IS NOT NULL
ON CONFLICT (user_id, capability) DO NOTHING;

-- A student is a member of an institute, so enrolment grants the capability. 0011 already
-- recorded those memberships, and they are the authoritative list — this grants the
-- capability to people who had already joined, who could previously only see their
-- credentials because the student router was gated on being a worker.
--
-- The casts are explicit for the same reason as above, and this is the statement that
-- proved it: under `SELECT DISTINCT` a bare literal resolves to `text`, so the migration
-- fails with `column "capability" is of type user_capability but expression is of type
-- text`. It is the worst possible statement to get wrong, because on a database with no
-- enrolments yet it inserts nothing — so it would have failed only at the point where the
-- twelve statements before it had already run.
INSERT INTO public.user_capabilities (user_id, capability, grant_source, granted_at)
SELECT DISTINCT
  ts.student_id,
  'trainee'::public.user_capability,
  'enrolment'::public.capability_grant_source,
  ts.enrolled_at
  FROM public.trainer_students ts
ON CONFLICT (user_id, capability) DO NOTHING;

-- The institute that enrolled somebody is the grantor, and it is stored on the capability
-- row rather than looked up later so the audit trail survives the institute being deleted.
--
-- `ORDER BY ... LIMIT 1` rather than `min()`, because PostgreSQL has no `min()` for `uuid`
-- and the statement fails to parse regardless of whether it matches any rows. The dry run
-- against the live database caught this too.
--
-- A student enrolled by two institutes has two legitimate grantors and only one is
-- recorded. That is a deliberate simplification: the column answers "which institute
-- stands behind this grant", and every institute that enrolled them does. Recording a
-- single arbitrary one would be worse than recording none; recording the lowest id is
-- deterministic, which is what matters for a value nobody is meant to depend on.
UPDATE public.user_capabilities c
   SET granted_by = (
     SELECT ts.trainer_id
       FROM public.trainer_students ts
      WHERE ts.student_id = c.user_id
      ORDER BY ts.trainer_id
      LIMIT 1
   )
 WHERE c.capability = 'trainee'
   AND c.grant_source = 'enrolment'
   AND c.granted_by IS NULL;

-- ---------------------------------------------------------------------------
-- The trigger — DUAL-MAINTAINING, deliberately
-- ---------------------------------------------------------------------------

-- Two triggers already call this function and are left exactly as they are:
-- `on_auth_user_created` (AFTER INSERT) and `on_auth_user_role_changed` (AFTER UPDATE OF
-- raw_app_meta_data).
--
-- This replacement does two things, not one. It grants the capability named in the claim
-- **and** keeps `public.users.role` in step, exactly as the function it replaces did. That
-- is the whole point of the expand phase: the deployed application still reads
-- `users.role`, so a function that stopped maintaining it would leave that column quietly
-- going stale and the running application quietly wrong. `0013` removes the second half
-- once nothing reads the column any more.
--
-- Granting from `raw_app_meta_data` preserves the only supported way to provision an
-- elevated account: writing the claim against the auth record. It stays server-controlled
-- and stays out of reach of anything a signup can reach, which is what E-024 turned on.
--
-- The cast is guarded because `admin` is not a capability and an administrator provisioning
-- an account must not fail because of it. An unrecognised claim value is ignored rather
-- than raised: the trigger runs on every `auth.users` insert, and failing here would make
-- account creation depend on this migration's vocabulary.
--
-- Note the asymmetry, which is deliberate: granting is additive and a claim naming one
-- capability never removes the others. The `users.role` mirror keeps its original
-- replace-semantics so the running application behaves exactly as it did before.
CREATE OR REPLACE FUNCTION public.sync_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  resolved_role public.user_role;
BEGIN
  IF NEW.raw_app_meta_data ? 'role' THEN
    BEGIN
      INSERT INTO public.user_capabilities (user_id, capability, grant_source)
      VALUES (NEW.id, (NEW.raw_app_meta_data ->> 'role')::public.user_capability, 'admin')
      ON CONFLICT (user_id, capability) DO NOTHING;
    EXCEPTION WHEN invalid_text_representation OR undefined_object THEN
      -- 'admin', or a value this build does not know. Not a capability; ignore.
      NULL;
    END;
  END IF;

  -- The half that migration 0013 removes. Kept byte-for-byte in behaviour so the deployed
  -- application sees no change at all while this expand phase is in place.
  IF TG_OP = 'INSERT' OR NEW.raw_app_meta_data ->> 'role' IS DISTINCT FROM OLD.raw_app_meta_data ->> 'role' THEN
    resolved_role := CASE COALESCE(NEW.raw_app_meta_data ->> 'role', 'worker')
      WHEN 'employer' THEN 'employer'::public.user_role
      WHEN 'training_provider' THEN 'training_provider'::public.user_role
      WHEN 'admin' THEN 'admin'::public.user_role
      ELSE 'worker'::public.user_role
    END;

    INSERT INTO public.users (id, role)
    VALUES (NEW.id, resolved_role)
    ON CONFLICT (id) DO UPDATE
      SET role = resolved_role,
          updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

-- Enabled and forced on all three, matching every other table in this schema.
ALTER TABLE public.user_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_capabilities FORCE ROW LEVEL SECURITY;

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses FORCE ROW LEVEL SECURITY;

ALTER TABLE public.business_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_memberships FORCE ROW LEVEL SECURITY;

-- A person may read their own capabilities. Nothing else: a capability list is an
-- authorisation decision, and a browser key that could read another account's would be a
-- way to enumerate who holds employer rights.
CREATE POLICY user_capabilities_select_own ON public.user_capabilities
  FOR SELECT USING (user_id = auth.uid());

-- A business is readable by its owner and by anyone with a membership of it. The membership
-- subquery is the same rule the service enforces, restated so the data layer agrees.
CREATE POLICY businesses_select_participant ON public.businesses
  FOR SELECT USING (
    owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.business_memberships m
       WHERE m.business_id = businesses.id
         AND m.user_id = auth.uid()
    )
  );

-- Memberships are readable by the member and by the business owner. No insert, update or
-- delete policy at all: who may hire is an authorisation decision made by the API with the
-- service role, and a table protected only by `ENABLE` would still leave the owner exempt
-- from its policies.
CREATE POLICY business_memberships_select_participant ON public.business_memberships
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.businesses b
       WHERE b.id = business_memberships.business_id
         AND b.owner_user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.user_capabilities IS
  'The capabilities an account holds. Replaces the single public.users.role column, which could name only one. Administrator is deliberately not a capability: it is read from the server-controlled app_metadata.role claim and can never be self-assigned (doc/13 E-024).';

COMMENT ON COLUMN public.user_capabilities.grant_source IS
  'Why this capability was held. Makes an inherited legacy grant distinguishable from a deliberate one during an access review.';

COMMENT ON TABLE public.businesses IS
  'A business that hires through TetherProof. A real entity rather than a label on a person, so an owner''s personal worker identity stays separate from their business''s employer permissions. Employer hiring rights follow an approved business and a membership, never a self-declared role.';

COMMENT ON TABLE public.business_memberships IS
  'Who may act for a business. A membership grants the employer capability, and revoking it takes that capability away — so "why may this person hire?" is answered here rather than inferred.';

COMMENT ON FUNCTION public.sync_user_role() IS
  'Creates the public.users mirror row and grants any capability named in the server-controlled app_metadata.role claim. Grants are additive and never revoke. While migration 0012 is the latest applied, this also keeps public.users.role in step so the deployed application is unaffected; migration 0013 removes that half.';