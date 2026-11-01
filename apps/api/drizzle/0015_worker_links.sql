-- TetherProof: addresses a worker attached to their account on Connect.
--
-- Written by hand like 0003–0014 and following their house style.
--
-- Connect lets a worker attach addresses to their account — a site, a channel, a
-- professional profile. Until now those addresses were held only on the screen
-- that collected them, so they vanished on refresh and could never reach an
-- employer. This table is what makes a link a durable part of the account.
--
-- It is deliberately just a name and an address. No credential is stored, no API
-- is called, and nothing is read from the source — the worker is vouching for the
-- address by pasting it, the same way they vouch for anything else they write on
-- their profile. That keeps the surface small: one row per link, owned by the
-- worker, removable by them at any time.
CREATE TABLE IF NOT EXISTS public.worker_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  url varchar(300) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS worker_links_user_idx ON public.worker_links (user_id);

COMMENT ON TABLE public.worker_links IS
  'Addresses a worker attached to their account on Connect. Stored only; nothing is read from the source. Owned by the worker and removable by them.';
