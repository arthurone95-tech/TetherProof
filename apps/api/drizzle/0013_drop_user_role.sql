-- TetherProof: CONTRACT phase. Removes the scalar that migration 0012 superseded.
--
-- ## Do not run this until the multi-capability code is deployed
--
-- `0012_multi_capability.sql` deliberately left `public.users.role` in place, because the
-- application running at the time still read it in five places:
--
--   * `auth/service.ts`      — `GET /auth/me`, which the web layout reads on every
--                              signed-in page, so removing the column under the running
--                              application takes the whole signed-in site down
--   * `proofs/service.ts`    — the public capability profile, i.e. public portfolios
--   * `employers/service.ts` — the admin employer queue and the approval self-check
--   * `trainers/service.ts`  — market demand totals
--
-- This file removes that column and the half of the trigger that maintained it. It is
-- safe only once nothing reads the column.
--
-- ## Why the column is dropped rather than kept
--
-- Leaving it would leave two sources of truth: a set of capabilities and a single role
-- that can only ever name one of them. For a person holding worker and employer, that
-- column would be *wrong*, and a future reader would reasonably believe it. Every read site
-- is changed by the code deployed before this migration, so it is removed rather than
-- deprecated. A check in the live suite fails if anything reads it again.

-- ---------------------------------------------------------------------------
-- The trigger, reduced to the part that remains
-- ---------------------------------------------------------------------------

-- The same function, minus the `users.role` mirror. Everything else is unchanged: the
-- capability named in the claim is still granted, and grants are still additive.
--
-- There are two triggers on `auth.users` and both call this function:
-- `on_auth_user_created` (AFTER INSERT) and `on_auth_user_role_changed` (AFTER UPDATE OF
-- raw_app_meta_data). Neither definition references the dropped column, so neither needs
-- changing here — and leaving them alone means account creation and claim-driven
-- provisioning keep working exactly as they did.
CREATE OR REPLACE FUNCTION public.sync_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;

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

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Drop the scalar
-- ---------------------------------------------------------------------------

-- The index goes with the column.
--
-- No policy anywhere in 0001–0012 references `role` (verified across all of them: every
-- policy keys on `auth.uid()` or on which party a row belongs to), so nothing at the data
-- layer is affected by removing it.
--
-- `DROP COLUMN IF EXISTS` rather than a guarded block: if this file is re-run after a
-- partial failure the statement is a no-op instead of an error, and `drizzle` will not
-- replay it anyway once it is journalled.
DROP INDEX IF EXISTS public.users_role_idx;

ALTER TABLE public.users DROP COLUMN IF EXISTS role;

-- ---------------------------------------------------------------------------
-- Documentation in the database itself
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.users IS
  'Identity mirror of auth.users. The former role column is gone as of migration 0013: one account may hold several capabilities, and a single column could only name one of them, so it would have been wrong for exactly the people this change exists to serve. Authorisation reads public.user_capabilities.';

-- The PostgreSQL `user_role` enum type is intentionally left in place. Dropping an enum
-- type is a separate and riskier operation, it is referenced by the historical migrations
-- that produced today's data, and nothing reads from or writes to it. Leaving an unused
-- type costs nothing; removing one that a historical migration depends on could.
COMMENT ON TYPE public.user_role IS
  'Unused since migration 0013. Retained because migrations 0001 and 0002 reference it, and dropping an enum type is a separate, riskier operation. Nothing writes to it or reads from it.';

COMMENT ON FUNCTION public.sync_user_role() IS
  'Creates the public.users mirror row and grants any capability named in the server-controlled app_metadata.role claim. Grants are additive and never revoke: a claim naming one capability must not silently strip the others a person holds. Administrator is not a capability and is ignored here.';