-- TetherProof: backfill employer_approvals into the business entity.
--
-- Migration 0012 made public.businesses the vehicle for employer rights, and
-- setBusinessStatus grants or revokes the employer capability from an approved
-- business. This migration copies each account's employer_approvals decision onto
-- a business so there is a single source of truth for "may this employer send
-- invitations".
--
-- For every user with an employer_approvals row:
--   * create one business owned by them, named from profiles.organization_name
--     (fallback "Business"), carrying status, reviewed_by, reviewed_at and note;
--   * enrol the owner as a member;
--   * grant the employer capability with source 'legacy' if missing.
--
-- Safe to run twice: a business is created only when the account has none, the
-- membership insert is on-conflict no-op, and the capability grant is
-- on-conflict no-op.

-- One business per employer that has an approval record and no business yet.
INSERT INTO public.businesses (
  id, name, owner_user_id, status, reviewed_by, reviewed_at, note,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  coalesce(nullif(btrim(p.organization_name), ''), 'Business'),
  ea.employer_id,
  ea.status::text::public.business_status,
  ea.reviewed_by,
  ea.reviewed_at,
  ea.note,
  coalesce(ea.reviewed_at, now()),
  coalesce(ea.reviewed_at, now())
FROM public.employer_approvals ea
LEFT JOIN public.profiles p ON p.user_id = ea.employer_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.businesses b WHERE b.owner_user_id = ea.employer_id
);

-- Enrol the owner as a member of each backfilled business.
INSERT INTO public.business_memberships (business_id, user_id, member_role)
SELECT b.id, b.owner_user_id, 'owner'::public.business_member_role
FROM public.businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM public.business_memberships m
  WHERE m.business_id = b.id AND m.user_id = b.owner_user_id
)
ON CONFLICT (business_id, user_id) DO NOTHING;

-- Grant the employer capability with source 'legacy' where it is missing.
INSERT INTO public.user_capabilities (user_id, capability, grant_source, granted_by)
SELECT ea.employer_id, 'employer'::public.user_capability, 'legacy'::public.capability_grant_source, NULL
FROM public.employer_approvals ea
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_capabilities c
  WHERE c.user_id = ea.employer_id AND c.capability = 'employer'::public.user_capability
)
ON CONFLICT (user_id, capability) DO NOTHING;
