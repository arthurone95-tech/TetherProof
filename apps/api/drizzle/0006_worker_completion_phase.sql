-- TetherProof: worker completion phase — privacy controls, shareable capability
-- profile, notification feed, telemetry connectors, and voice transcripts.
--
-- This migration is written by hand like 0003–0005 and follows their house
-- style: envelope statements where PostgreSQL requires them, explanatory
-- comments where the rationale is load-bearing. It adds:
--
--   profiles.discoverable            whether employer search may surface the worker
--   profiles.public_profile          whether the shareable capability page answers
--   profiles.public_slug             the unguessable address of that page
--   profiles.invitation_preference   which employers may send invitations
--   work_proof_logs.transcript       speech-to-text of a voice recording, if captured
--   notifications                    the worker's in-app event feed
--   telemetry_connections            connected work-capture sources (GitHub scaffold)
--
-- Every privacy choice defaults to the open position for a network whose reason
-- to exist is being found: discoverable true, public page off until the worker
-- turns it on, invitations from everyone allowed. Turning any of them off is
-- enforced at the layer that matters (search aggregation, HTTP 404, invitation
-- creation), not merely displayed.

-- ---------------------------------------------------------------------------
-- 1. New enum types
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invitation_preference') THEN
    CREATE TYPE public.invitation_preference AS ENUM ('all', 'approved_only');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_kind') THEN
    CREATE TYPE public.notification_kind AS ENUM (
      'offer_received',
      'verification_confirmed',
      'verification_rejected',
      'link_expired',
      'link_expiring'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connection_provider') THEN
    CREATE TYPE public.connection_provider AS ENUM ('github');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connection_status') THEN
    CREATE TYPE public.connection_status AS ENUM ('connected', 'revoked');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Worker privacy and sharing state on profiles
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN discoverable boolean NOT NULL DEFAULT true;

ALTER TABLE public.profiles
  ADD COLUMN public_profile boolean NOT NULL DEFAULT false;

-- `public_slug` is deliberately *not* unique-nullable-and-unconstrained: it is
-- unique only while non-null, so a worker who turns the page off has the value
-- cleared and the slot freed rather than reserved forever.
ALTER TABLE public.profiles
  ADD COLUMN public_slug varchar(32);

ALTER TABLE public.profiles
  ADD COLUMN invitation_preference public.invitation_preference NOT NULL DEFAULT 'all';

CREATE UNIQUE INDEX profiles_public_slug_unique
  ON public.profiles (public_slug)
  WHERE public_slug IS NOT NULL;

COMMENT ON COLUMN public.profiles.discoverable IS
  'Whether this worker may appear in employer search. False is enforced at the aggregation layer, so a search token cannot be used to probe for a hidden worker.';
COMMENT ON COLUMN public.profiles.public_profile IS
  'Whether the shareable capability profile page answers. The page is public and exists only because the worker turned it on, so the default is false.';
COMMENT ON COLUMN public.profiles.public_slug IS
  'The unguessable address of the public capability profile. Generated once when the page is first enabled; cleared when it is disabled, so a disabled page has no lingering URL that 404s.';
COMMENT ON COLUMN public.profiles.invitation_preference IS
  'Which employers may send this worker an invitation. approved_only is enforced at invitation creation, not merely displayed.';

-- ---------------------------------------------------------------------------
-- 3. Voice transcripts on logs
-- ---------------------------------------------------------------------------
ALTER TABLE public.work_proof_logs
  ADD COLUMN transcript text;

COMMENT ON COLUMN public.work_proof_logs.transcript IS
  'Speech-to-text of a voice recording, when a transcription provider is configured and succeeded. Null means no provider ran or it failed; the recording itself remains the record.';

-- The anonymisation trigger must scrub the transcript along with the other
-- identifying text: it is worker-authored and can name people, places, and
-- clients. Recreated here (CREATE OR REPLACE) rather than edited in place
-- so the change ships as a migration like the original.
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
         transcript = NULL,
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

-- ---------------------------------------------------------------------------
-- 4. Notification feed
-- ---------------------------------------------------------------------------
--
-- Rows are written by the API at the moments that matter (an invitation
-- arriving, a verification coming back confirmed or rejected, a link running
-- out on resend). `link_expiring` is deliberately *not* written: expiry is a
-- moving target, so the feed synthesises those entries at read time from the
-- worker's own outstanding links. A written row can go stale; a computed one
-- cannot.
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind public.notification_kind NOT NULL,
  title varchar(160) NOT NULL,
  body varchar(280) NOT NULL,
  link varchar(512),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_id_idx ON public.notifications (user_id);
-- An invitation badge counts unread rows, so the read state has its own index
-- rather than piggybacking on the plain user index.
CREATE INDEX notifications_user_unread_idx
  ON public.notifications (user_id, read_at)
  WHERE read_at IS NULL;

COMMENT ON TABLE public.notifications IS
  'The worker''s in-app event feed. Rows are API-written; expiring-link notices are synthesized at read time and never stored.';

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;

-- The owner reads and marks their own rows. Writing happens only through the
-- API service role, which bypasses RLS by design.
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 5. Telemetry connections
-- ---------------------------------------------------------------------------
--
-- The scaffold records the *fact of a connection* and the provider-side
-- username. Tokens are deliberately absent: holding an OAuth credential is a
-- storage decision with its own security review, and nothing in this phase
-- needs one. `last_synced_at` is where the sync stamp lives once event
-- ingestion lands.
CREATE TABLE public.telemetry_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider public.connection_provider NOT NULL,
  external_username varchar(120),
  status public.connection_status NOT NULL DEFAULT 'connected',
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz
);

CREATE UNIQUE INDEX telemetry_connections_user_provider_unique
  ON public.telemetry_connections (user_id, provider);

CREATE INDEX telemetry_connections_provider_idx
  ON public.telemetry_connections (provider);

COMMENT ON TABLE public.telemetry_connections IS
  'Work-capture sources a worker connected. A scaffold: holds the connection and its sync state, not credentials.';

ALTER TABLE public.telemetry_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_connections FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telemetry_connections_select_own ON public.telemetry_connections;
CREATE POLICY telemetry_connections_select_own ON public.telemetry_connections
  FOR SELECT USING (auth.uid() = user_id);