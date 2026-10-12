# 06-DATABASE-DOCUMENTATION.md

**Product:** TetherProof

## 1. Overview
This document defines the relational database schema, tables, fields, and relationships for the verified capability platform. The schema is designed to support multi-role user management, immutable verification logging, zero-knowledge talent matching, and anti-fraud telemetry tracking.

---

## 2. Core Database Tables & Entities

### A. Users Table (`users`)
Application-level user records for all user types. Identity and credential data is **not** stored here: it lives in Supabase Auth (`auth.users`), and this table mirrors only that identity.
* `id` (UUID, Primary Key, Foreign Key referencing `auth.users.id`)
* `role` (ENUM: `worker`, `employer`, `training_provider`, `admin`)
* `created_at` (TIMESTAMP)
* `updated_at` (TIMESTAMP)

> **Supabase Auth model.** Email addresses, phone numbers, and password hashes are owned by `auth.users` and are deliberately not duplicated here, so identity data has exactly one source of truth. A database trigger on `auth.users` creates the row here and keeps `role` in step with the server-controlled `app_metadata.role` claim.

### B. Profiles Table (`profiles`)
Stores extended user details depending on their role.
* `id` (UUID, Primary Key)
* `user_id` (UUID, Foreign Key referencing `users.id`, Unique)
* `full_name` (VARCHAR)
* `location_city` (VARCHAR. **Always `NULL`** — no code path writes it, so every read returns
  nothing. Geocoding a coordinate to a place name needs either a third-party lookup or a
  bundled gazetteer, and neither was authorised. See `doc/13` E-024)
* `location_gps` (VARCHAR / POINT data for proximity checks)
* `organization_name` (VARCHAR, Optional, for employers/schools)
* `avatar_url` (VARCHAR)

`profiles` is **upserted, not updated**. Accounts provisioned outside `/auth/register` — by an
administrator, or by a service-role `createUser` — never pass through the registration
trigger, so they have no `profiles` row at all. A plain `UPDATE` against a row that does not
exist is a silent no-op returning 404, which is indistinguishable from "no such user" and sent
the profile page down the wrong path. See `doc/13` E-027.

### C. Capability Blocks Table (`capability_blocks`)
Stores the verifiable skills and execution milestones owned by workers.
* `id` (UUID, Primary Key)
* `worker_id` (UUID, **nullable**, Foreign Key referencing `users.id`, `ON DELETE set null`)
* `skill_tag` (VARCHAR, Indexed - e.g., `Refrigeration Repair`, `React State Management`)
* `skill_level` (INTEGER)
* `anonymised_at` (TIMESTAMP, **NULL** except on a block retained after its owner deleted their account)

`proof_count` and `last_verified_at` were dropped in migration `0004`. Both were dormant
columns that no code path ever incremented, so every read returned `0` and `NULL`. Nothing
displayed them, and search aggregated from `work_proof_logs` directly, which made them pure
surface area: a future developer could reasonably have sorted on `proof_count` and obtained a
correct-looking ranking of zeroes. Removing them was preferred to populating them, because a
stored aggregate has to be maintained in step with the rows it summarises and would need
repairing on every write path.

### D. Work Proof Logs Table (`work_proof_logs`)
Stores individual task completions, media proofs, and telemetry data.
* `id` (UUID, Primary Key)
* `worker_id` (UUID, **nullable**, Foreign Key referencing `users.id`, `ON DELETE set null`)
* `capability_block_id` (UUID, Foreign Key referencing `capability_blocks.id`)
* `description` (TEXT)
* `media_url` (VARCHAR, Secure object storage path with stripped PII)
* `anonymised_at` (TIMESTAMP, **NULL** except on a record retained after its owner deleted their account. Non-null means the row was scrubbed by the `0005` trigger, which is stated explicitly because inferring it from `worker_id IS NULL` would make an absence of evidence the evidence)
* `metadata_status` (ENUM: `pending`, `valid`, `flagged_ai_fake`. **Only `pending` is ever written.** The other two values exist in the type but no code path sets them, because detecting synthetic media is not implemented and is not claimed. The provenance signals below are consistency checks, not AI-generation detection)
* `media_signal_evaluated` (BOOLEAN, False when the file could not be examined for provenance)
* `media_has_camera_signature` (BOOLEAN, True when the discarded EXIF named a capture device)
* `media_timestamp_plausible` (BOOLEAN, True when the discarded capture time was consistent with the submission)
* `media_encoder_known` (BOOLEAN, True when the container is structurally what its declared type claims)
* `submission_gps` (VARCHAR)
* `verification_status` (ENUM: `pending`, `verified`, `rejected`, `flagged`, `fraud_blocked`)
* `flagged_at` (TIMESTAMP) — set on both `flagged` and `fraud_blocked`
* `flag_reason` (VARCHAR 400) — a plain sentence the worker may read; never a score or a threshold
* `review_status` (ENUM `proof_review_status`: `none`, `appealed`, `under_review`, `upheld`, `overturned`; default `none`)
* `reviewed_at` (TIMESTAMP), `reviewed_by` (UUID → `users.id`, `ON DELETE SET NULL`)
* `restored_at` (TIMESTAMP) — set when an overturned block returned the record to `verified`
* `created_at` (TIMESTAMP)

`flagged` and `fraud_blocked` are deliberately distinct states. "Something about this did not
add up" and "this was fraud" are different claims with very different consequences for the
person named on the record; collapsing them is how a heuristic becomes an accusation. Both
withhold the record from counting as proof — that is the whole protective effect — but only one
is a judgement about the worker, and only an administrator can make it.

`review_status` exists so that "an admin looked at this and agreed" and "nobody has looked at
this yet" are never indistinguishable on a worker's record. `upheld` and `overturned` are
terminal and both stored rather than inferred. An overturned review restores `verification_status`
to `verified` and stamps `restored_at`; it does **not** delete the engine's findings, which stay
on the verification row, because an appeal that erased the reason would let anyone clear a
genuine finding by objecting to it.

The four `media_*` columns are booleans only, derived from metadata the scrubber destroyed
before storage. There is deliberately no column anywhere for a camera make, model, serial
number, or capture time — that absence is what lets a provenance signal exist without
weakening the retention promise in the security documentation. A `NULL` means "not
applicable or not determinable", which is the correct value for audio; see `doc/13` E-019.

### E. Verifications Table (`verifications`)
Stores external client/supervisor confirmation records linked via SMS tokens.
* `id` (UUID, Primary Key)
* `work_proof_id` (UUID, Foreign Key referencing `work_proof_logs.id`)
* `verifier_phone_hash` (VARCHAR, Salted SHA-256 of the client's phone number. The number itself is never stored. Null when the worker supplied none, which the engine reads as identity-unknown and scores neutrally)
* `token_hash` (VARCHAR, Unique SHA-256 hash of the single-use verification token; the raw token is returned to the worker once at generation time and is never stored)
* `response` (ENUM: `none`, `confirmed`, `rejected`)
* `verifier_gps` (VARCHAR, Where the client was when they tapped; feeds the proximity check)
* `proximity_km` (FLOAT, Great-circle distance between the submission point and the tap. Null when either side supplied no location)
* `proximity_status` (ENUM: `within`, `outside`, `unavailable`)
* `fraud_score` (FLOAT, 0..1. Null for a rejection, which is not scored)
* `fraud_score_detail` (JSONB, Per-signal breakdown behind `fraud_score`, so a blocked proof is explainable from stored data rather than from server logs)
* `dispatch_status` (VARCHAR, `sent`, `failed`, or `not_attempted`)
* `dispatch_detail` (VARCHAR, Short non-identifying reason a dispatch did not succeed)
* `expires_at` (TIMESTAMP)
* `completed_at` (TIMESTAMP)

`unavailable` is an absence of evidence and is never scored as either a pass or a failure.
It is kept as a distinct enum value rather than folded into `outside` so that a client who
declined to share a location is never conflated with one at the job site.

### F. Employer Capability Specs Table (`employer_specs`)
Stores job requirements created by employers instead of traditional job descriptions.
* `id` (UUID, Primary Key)
* `employer_id` (UUID, Foreign Key referencing `users.id`)
* `required_skill` (VARCHAR)
* `min_proof_threshold` (INTEGER)
* `max_distance_km` (INTEGER)
* `is_active` (BOOLEAN)
* `created_at` (TIMESTAMP)

A spec is paused by clearing `is_active` rather than deleted, so an employer's saved
shortlists survive a change of mind. `min_proof_threshold` is bounded at 500 and
`max_distance_km` at 20,000, both enforced at creation: a filter above any threshold a worker
could realistically reach would match nothing, forever, and the employer who saved it would
have no way to tell that apart from "no candidates yet".

### G. Employer Approvals Table (`employer_approvals`)
Records the review decision that gates sending invitations.
* `employer_id` (UUID, Primary Key, Foreign Key referencing `users.id`)
* `status` (ENUM: `pending`, `approved`, `rejected`)
* `reviewed_by` (UUID, Foreign Key referencing `users.id`, `ON DELETE SET NULL`. Null means
  nobody has reviewed it)
* `reviewed_at` (TIMESTAMP)
* `note` (VARCHAR(200), Optional. Shown to the employer. Never holds a document reference or a
  contact detail)
* `created_at` (TIMESTAMP)

A row is created only when a decision is needed. **The absence of a row means pending**, which
behaves identically to an explicit `pending` row — so a newly registered employer needs no
setup step before they can search.

This is a table rather than a boolean column on `users` because a review needs a reviewer and
a time to be meaningful — a flag cannot record *who* decided or *when*, and "approved: yes"
becomes indistinguishable from "approved by a colleague last quarter". The employer is shown
the status and the note but never `reviewed_by`: knowing a decision was made and what it was
is the employer's business, and knowing which administrator made it is not.

### H. Candidate Handles Table (`candidate_handles`)
Resolves an opaque, employer-scoped value back to the worker a search result refers to.
* `id` (UUID, Primary Key)
* `employer_id` (UUID, Foreign Key referencing `users.id`)
* `worker_id` (UUID, Foreign Key referencing `users.id`)
* `handle` (VARCHAR(64), Unique. URL-safe, high-entropy, unguessable)
* `expires_at` (TIMESTAMP)
* `created_at` (TIMESTAMP)

A handle is issued per employer per worker (unique on both pairs), so a handle captured from
one employer's results is inert for every other employer: it resolves to nothing without the
caller's identity matching `employer_id`. The value is random rather than derived from the
worker id, because a derived value would be stable across employers and therefore
correlatable by anyone comparing two result sets — which is the tracking that masking exists to
prevent. Handles also expire: they are a short-lived capability to address one card, not a
durable pseudonymous identifier.

Nothing in this table is readable or writable by an employer through PostgREST — there is
deliberately **no INSERT or UPDATE policy** — because the API writes it with the service role,
and a search result is only meaningful server-side.

### I. Direct Offers Table (`direct_offers`)
Stores direct connection requests sent from employers to verified workers.
* `id` (UUID, Primary Key)
* `employer_id` (UUID, Foreign Key referencing `users.id`)
* `worker_id` (UUID, Foreign Key referencing `users.id`)
* `spec_id` (UUID, Foreign Key referencing `employer_specs.id`, `ON DELETE SET NULL`. Null when
  the invitation was sent straight from search rather than from a saved spec)
* `status` (ENUM: `pending`, `accepted`, `declined`)
* `note` (VARCHAR(500), Optional. The only employer-authored text a worker ever sees, always
  rendered as text rather than markup)
* `responded_at` (TIMESTAMP, Null while pending)
* `created_at`, `updated_at` (TIMESTAMP)

A unique index on `(employer_id, worker_id)` means one employer cannot open a second
invitation to the same worker, whether or not the first was answered. Without it the offer
list could fill with duplicates and the worker would face several identical requests to
answer independently.

---

## 3. Data Integrity & Security Rules
* **Row Level Security:** Enabled **and forced** on every table, so it applies to the table owner as well as to `anon` and `authenticated`. Because Supabase exposes the database to the browser through PostgREST, RLS is the boundary that keeps one user from reading another's data. Policies restrict each table to its owner (and, for direct offers, to both parties). Employers cannot read worker work proofs directly; that data is only reachable through the zero-knowledge search service. Neither `anon` nor `authenticated` holds any grant on these tables, so the API's service role is the real boundary and RLS is defence in depth behind it.
* **Foreign Key Constraints:** Cascading rules follow what each row *is*, not a single habit. Deleting an account cascades to `profiles`, `employer_specs`, `employer_approvals`, `candidate_handles`, and `direct_offers` - nothing derived from a user should outlive them. `capability_blocks.worker_id` and `work_proof_logs.worker_id` are `ON DELETE set null` (migration `0005`), which detaches the evidence from the person while keeping the record. They were `ON DELETE restrict` until then, which made any worker who had ever logged a job impossible to delete; that defect is `doc/13` E-025 and its resolution is E-029.
* **Anonymisation on deletion (`0005`):** A `BEFORE DELETE` trigger on `users`, named `users_anonymise_on_delete`, runs `anonymise_account_on_delete()`. It overwrites `description`, nulls `submission_gps` and `media_url` on the worker's proofs, nulls `verifier_gps` on their verifications, and stamps `anonymised_at` on both proof tables. It fires through the cascade from `auth.users`, which is the path the auth admin API takes - verified rather than assumed. The function is `SECURITY DEFINER` with a pinned `search_path` and `REVOKE ... FROM PUBLIC`; because it is a trigger function PostgreSQL will not allow it to be called directly, so it needs no grant and cannot be granted by mistake.
* **A nullable `worker_id` is not an oversight:** on a deliberately retained anonymised record, a non-null `worker_id` would be a contradiction. Code reading these tables must exclude `worker_id IS NULL` explicitly rather than rely on a join dropping the rows. `doc/13` E-029 records the two places that had to change - the candidate aggregate and the collusion graph - and both exclusions are deliberate rather than incidental.
* **`orphaned_proof_media`:** SQL cannot delete storage objects. `storage.protect_delete()` refuses it, verified against the live project, so the trigger records the bucket and path of every object still stored at deletion time, read back from `storage.objects` rather than assumed so the record survives a bucket rename. This is an auditable queue, not a record of what happened: the bytes are still there until something drains it. An object path is `<user_id>/<YYYY-MM-DD>/<uuid>.<ext>`, so the prefix still identifies the person who asked to be removed; holding that path is acceptable only because the row is written at deletion time, when the user id in the prefix has just been deleted from `auth.users`.
* **Encryption:** Sensitive personal data and authentication secrets must be encrypted at rest.
* **PII Isolation:** Verifier phone numbers and raw client details are isolated from public worker profiles to preserve privacy.
* **Token Hashing:** Verification links are the live capability to confirm work, so only a SHA-256 hash of the token is persisted. The raw token exists once, in the response that creates the record, and is never written to the database or to logs. Lookup by `token_hash` ensures a database disclosure is insufficient to forge a confirmation.
