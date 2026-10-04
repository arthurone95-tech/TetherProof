-- TetherProof: correct `public.sync_user_role`.
--
-- Two defects are fixed here.
--
-- 1. The original function assigned a `text` expression to the `user_role`
--    enum column. PL/pgSQL requires an explicit cast, so every new Auth user
--    failed with:
--      column "role" is of type public.user_role but expression is of type text
--    Supabase Auth reports that only as the opaque "Database error creating new
--    user" (500), which made registration impossible.
--
-- 2. The role is now also re-synced when `app_metadata` changes, so the
--    database copy cannot drift away from the token claim. The comparison lives
--    in the function body because PostgreSQL rejects `IS DISTINCT FROM` inside
--    a `CREATE TRIGGER ... WHEN` clause.
--
-- The mapping is explicit and fails safe: an unrecognised role claim becomes
-- `worker` rather than raising an error and blocking the sign-up.
CREATE OR REPLACE FUNCTION public.sync_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  resolved_role public.user_role;
BEGIN
  resolved_role := CASE COALESCE(NEW.raw_app_meta_data ->> 'role', 'worker')
    WHEN 'employer' THEN 'employer'::public.user_role
    WHEN 'training_provider' THEN 'training_provider'::public.user_role
    WHEN 'admin' THEN 'admin'::public.user_role
    ELSE 'worker'::public.user_role
  END;

  -- Ignore updates that did not actually change the role.
  IF TG_OP = 'UPDATE'
     AND (OLD.raw_app_meta_data ->> 'role')
         IS NOT DISTINCT FROM (NEW.raw_app_meta_data ->> 'role') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.users (id, role)
  VALUES (NEW.id, resolved_role)
  ON CONFLICT (id) DO UPDATE
    SET role = resolved_role,
        updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_role_changed ON auth.users;
CREATE TRIGGER on_auth_user_role_changed
  AFTER UPDATE OF raw_app_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_role();