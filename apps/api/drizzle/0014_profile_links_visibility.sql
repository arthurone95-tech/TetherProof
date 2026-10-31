-- TetherProof: whether a worker's own links are shown with their profile.
--
-- Written by hand like 0003–0013 and following their house style.
--
-- Connect lets a worker attach addresses to their account — a site, a channel,
-- a professional profile. Those addresses describe the worker, so the natural
-- place for an employer to meet them is the worker's own card. That is a
-- disclosure the worker should choose, not one the platform makes for them:
-- the same person who is happy to be found in search may not want every address
-- they have linked travelling with the card.
--
-- So the choice gets an explicit switch next to the other privacy choices on
-- the settings page, defaulting to true. The default is the ordinary case — a
-- link is added precisely in order to be seen — and the column is what lets a
-- worker who added links for their own reference turn the display off without
-- touching `discoverable`, which governs a different question.
--
-- Separate from `public_profile` because the audiences differ again: the
-- capability page is an address the worker shares, while this governs what
-- rides along on the profile inside employer search.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_links_on_profile boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.show_links_on_profile IS
  'Whether the links a worker has connected are shown with their profile where it is read, such as employer search results. Defaults to true. Separate from discoverable, which governs whether the worker appears at all, and from public_profile, which governs a page the worker shares by address.';
