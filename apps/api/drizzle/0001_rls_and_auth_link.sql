-- TetherProof: link the application profile to Supabase Auth and enforce
-- Row Level Security.
--
-- Supabase exposes the database directly to the browser through PostgREST, so
-- RLS is the boundary that keeps one user from reading another user's data.
-- The API server connects with the service-role key and performs its own
-- authorization; every other client is subject to the policies below.

-- ---------------------------------------------------------------------------
-- Link public.users to auth.users
-- ---------------------------------------------------------------------------
-- public.users holds application data only. Credentials, email, and phone stay
-- in auth.users, so identity data has exactly one source of truth.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_id_auth_fkey'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_id_auth_fkey
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Mirror the role assigned at registration into public.users. The API writes
-- app_metadata.role first, so the database copy is always server-controlled.
CREATE OR REPLACE FUNCTION public.sync_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, role)
  VALUES (NEW.id, COALESCE(NEW.raw_app_meta_data ->> 'role', 'worker'))
  ON CONFLICT (id) DO UPDATE
    SET role = COALESCE(NEW.raw_app_meta_data ->> 'role', 'worker'),
        updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_role();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_proof_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_offers ENABLE ROW LEVEL SECURITY;

-- The API uses the service-role key, which bypasses RLS by design. Force RLS
-- on the table owner as well so a stray owner connection cannot read every
-- worker's proofs.
ALTER TABLE public.work_proof_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.verifications FORCE ROW LEVEL SECURITY;

-- Users may read and update only their own row.
DROP POLICY IF EXISTS users_select_own ON public.users;
CREATE POLICY users_select_own ON public.users
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS users_update_own ON public.users;
CREATE POLICY users_update_own ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- Profiles are visible to their owner. Employer-facing reads must go through
-- the zero-knowledge search service, never through direct table access.
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- Capability blocks belong to the worker who earned them.
DROP POLICY IF EXISTS capability_blocks_select_own ON public.capability_blocks;
CREATE POLICY capability_blocks_select_own ON public.capability_blocks
  FOR SELECT USING (auth.uid() = worker_id);

DROP POLICY IF EXISTS capability_blocks_insert_own ON public.capability_blocks;
CREATE POLICY capability_blocks_insert_own ON public.capability_blocks
  FOR INSERT WITH CHECK (auth.uid() = worker_id);

DROP POLICY IF EXISTS capability_blocks_update_own ON public.capability_blocks;
CREATE POLICY capability_blocks_update_own ON public.capability_blocks
  FOR UPDATE USING (auth.uid() = worker_id);

-- Work proofs are private to the worker. Employers must not read them directly.
DROP POLICY IF EXISTS work_proof_logs_select_own ON public.work_proof_logs;
CREATE POLICY work_proof_logs_select_own ON public.work_proof_logs
  FOR SELECT USING (auth.uid() = worker_id);

DROP POLICY IF EXISTS work_proof_logs_insert_own ON public.work_proof_logs;
CREATE POLICY work_proof_logs_insert_own ON public.work_proof_logs
  FOR INSERT WITH CHECK (auth.uid() = worker_id);

DROP POLICY IF EXISTS work_proof_logs_update_own ON public.work_proof_logs;
CREATE POLICY work_proof_logs_update_own ON public.work_proof_logs
  FOR UPDATE USING (auth.uid() = worker_id);

-- Verification records hold verifier phone numbers, which are PII. They are
-- reachable only through the API's public token flow.
DROP POLICY IF EXISTS verifications_select_own ON public.verifications;
CREATE POLICY verifications_select_own ON public.verifications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.work_proof_logs w
      WHERE w.id = verifications.work_proof_id
        AND w.worker_id = auth.uid()
    )
  );

-- Employers manage their own capability specs.
DROP POLICY IF EXISTS employer_specs_select_own ON public.employer_specs;
CREATE POLICY employer_specs_select_own ON public.employer_specs
  FOR SELECT USING (auth.uid() = employer_id);

DROP POLICY IF EXISTS employer_specs_insert_own ON public.employer_specs;
CREATE POLICY employer_specs_insert_own ON public.employer_specs
  FOR INSERT WITH CHECK (auth.uid() = employer_id);

DROP POLICY IF EXISTS employer_specs_update_own ON public.employer_specs;
CREATE POLICY employer_specs_update_own ON public.employer_specs
  FOR UPDATE USING (auth.uid() = employer_id);

DROP POLICY IF EXISTS employer_specs_delete_own ON public.employer_specs;
CREATE POLICY employer_specs_delete_own ON public.employer_specs
  FOR DELETE USING (auth.uid() = employer_id);

-- A direct offer is visible to both parties.
DROP POLICY IF EXISTS direct_offers_select_party ON public.direct_offers;
CREATE POLICY direct_offers_select_party ON public.direct_offers
  FOR SELECT USING (auth.uid() = employer_id OR auth.uid() = worker_id);

DROP POLICY IF EXISTS direct_offers_insert_employer ON public.direct_offers;
CREATE POLICY direct_offers_insert_employer ON public.direct_offers
  FOR INSERT WITH CHECK (auth.uid() = employer_id);

DROP POLICY IF EXISTS direct_offers_update_party ON public.direct_offers;
CREATE POLICY direct_offers_update_party ON public.direct_offers
  FOR UPDATE USING (auth.uid() = employer_id OR auth.uid() = worker_id);
