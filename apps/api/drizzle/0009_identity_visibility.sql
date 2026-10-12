-- TetherProof: who a worker is shown as.
--
-- Written by hand like 0003–0008 and following their house style.
--
-- Employer search has always been zero-knowledge: a card carried a handle, a
-- skill, three aggregates and a distance, and a worker's identity was released
-- only once they accepted an invitation. That left an employer unable to tell
-- one anonymous worker from another while deciding who to invite.
--
-- The search side of this needs no schema change. `profiles.discoverable`
-- already answers "may this worker appear in employer search", and it is enforced
-- at the aggregation layer, so the name and photo that now ride along on the card
-- are already gated by it. Adding a second flag there would be a second switch
-- for a worker to reason about, guarding the same population.
--
-- The verification page is different, and this is the column that matters. That
-- page is reached by a bearer link which is forwardable by nature: anyone the
-- worker sends it to can pass it on. Naming the worker there therefore discloses
-- who they work with to whoever ends up holding the link, which is why the page
-- was deliberately anonymous until now.
--
-- So the verification page gets an explicit switch, defaulting to true. The
-- default is what makes the feature work for a worker who has done nothing but
-- sign up, and the column is what lets the one who needs it turn it off without
-- leaving employer search — where they have already chosen `discoverable` — and
-- without editing a row by hand.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_name_on_verification_link boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.show_name_on_verification_link IS
  'Whether this worker is named, with an optional photo, on the customer verification page reached by a confirmation link. Defaults to true. Separated from discoverable because the two expose this worker to different audiences: discoverable governs employer search, while this governs whoever ends up holding a forwardable link.';
