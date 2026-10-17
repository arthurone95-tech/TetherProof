# 06-DATABASE-DOCUMENTATION.md

**Product:** TetherProof

## 1. Overview
This document defines the relational database schema, tables, fields, and relationships for the verified capability platform. The schema is designed to support multi-role user management, immutable verification logging, zero-knowledge talent matching, and anti-fraud telemetry tracking.

---

## 2. Core Database Tables & Entities

### A. Users Table (`users`)
Application-level user records for all user types. Identity and credential data is **not** stored here: it lives in Supabase Auth (`auth.users`), and this table mirrors only that identity.
* `id` (UUID, Primary Key, Foreign Key referencing `auth.users.id`)
* `created_at` (TIMESTAMP)
* `updated_at` (TIMESTAMP)

> **The `role` column was removed by migration `0013_drop_user_role.sql`.** It held a single
> value, so a person could be a worker, a student at an institute, and the owner of a
> business that hires — but only one of them at a time. That is three accounts and three
> portfolios that could never be joined. Authorisation now reads `user_capabilities` (section
> A2), and the column was dropped rather than deprecated so there is no second source of
> truth that could be wrong for exactly the people this change exists to serve.
>
> The removal is deliberately separated in time from the migration that introduces
> `user_capabilities`. `0012_multi_capability.sql` only **adds** — it leaves `users.role` and
> the half of `sync_user_role()` that maintains it in place, so the application running at the
> time is entirely unaffected. `0013_drop_user_role.sql` removes both, and must not run until
> the multi-capability code is deployed. See `doc/13` E-062 for why there is no other safe
> ordering.
>
> The `user_role` PostgreSQL enum type still exists — dropping an enum is a separate and
> riskier operation, and it is referenced by the historical migrations that produced
> today's data — but nothing reads from or writes to it.

> **Supabase Auth model.** Email addresses, phone numbers, and password hashes are owned by `auth.users` and are deliberately not duplicated here, so identity data has exactly one source of truth. A database trigger on `auth.users` creates the row here and grants whatever capability is named in the server-controlled `app_metadata.role` claim. It **grants only** — it never revokes — because a claim naming one capability must not silently strip the others a person holds.
>
> Two triggers call it and neither is ever changed: `on_auth_user_created` (AFTER INSERT) and `on_auth_user_role_changed` (AFTER UPDATE OF `raw_app_meta_data`). The second is why the trigger grants rather than sets: it fires whenever an administrator edits any part of the claim metadata, and a replace-semantics function would strip capabilities the claim does not mention.

### A2. User Capabilities Table (`user_capabilities`)
What one account is authorised to do. Replaces the `users.role` column.
* `user_id` (UUID, Foreign Key referencing `users.id`, **On Delete Cascade**, Primary Key part)
* `capability` (ENUM: `worker`, `employer`, `training_provider`, `trainee`, Primary Key part)
* `grant_source` (ENUM: `self`, `legacy`, `enrolment`, `business`, `admin`, `registration`)
* `granted_at` (TIMESTAMP)
* `granted_by` (UUID, Foreign Key referencing `users.id`, **On Delete Set Null**, Nullable)

The composite primary key `(user_id, capability)` makes holding two capabilities two rows and
holding the same one twice impossible by construction rather than by a unique index somebody
could forget to add.

**`admin` is deliberately not a capability.** It is a platform role rather than something a
person does, it is read from the server-controlled `app_metadata.role` claim, and it has never
been self-assignable — `doc/13` E-024 is the record of what happens when that boundary is
crossed. Because it is not in this table there is no row anybody could insert and no request
body that could name it.

`grant_source` is recorded rather than inferred so an access review can tell an inherited grant
from a deliberate one. `legacy` is the `0012` backfill: an account that already held a role
keeps exactly what it had, and saying so is more honest than implying somebody granted it.

Row Level Security: enabled **and forced**; the only policy is `SELECT` scoped to
`user_id = auth.uid()`. A capability list is an authorisation decision, and a browser key that
could read another account's would be a way to enumerate who holds employer rights. There is no
INSERT policy at all — granting is a service-role operation.

### A3. Businesses Table (`businesses`)
A business that hires through TetherProof.
* `id` (UUID, Primary Key)
* `name` (VARCHAR(200))
* `owner_user_id` (UUID, Foreign Key referencing `users.id`, **On Delete Cascade**)
* `status` (ENUM: `pending`, `approved`, `rejected`, Default: `pending`)
* `reviewed_by` (UUID, Foreign Key referencing `users.id`, **On Delete Set Null**, Nullable)
* `reviewed_at` (TIMESTAMP, Nullable)
* `note` (VARCHAR(200), Nullable — shown to the owner; never a contact detail)
* `created_at`, `updated_at` (TIMESTAMP)

A real entity rather than a label on a person, because the owner's personal worker identity
stays separate from the business's hiring permissions. Kojo the electrician and "Kojo Electrical
Services" are different things that share an owner, and only the second one carries hiring
rights.

`status` mirrors `employer_approvals` deliberately: an approval is a row with a reviewer, a time
and an optional note, not a boolean, because "approved: yes" becomes indistinguishable from
"approved by a colleague last quarter". Creating a business is open to any account so there is
somebody able to approve — the same reasoning that left employer self-registration open, and why
a pending business is a real state rather than a broken one.

Row Level Security: enabled **and forced**; `SELECT` for the owner and for anyone holding a
membership. No INSERT/UPDATE policy — that is the API's decision, made with the service role.

### A4. Business Memberships Table (`business_memberships`)
Who may act for a business.
* `id` (UUID, Primary Key)
* `business_id` (UUID, Foreign Key referencing `businesses.id`, **On Delete Cascade**)
* `user_id` (UUID, Foreign Key referencing `users.id`, **On Delete Cascade**)
* `member_role` (ENUM: `owner`, `member`, Default: `member`)
* `created_at` (TIMESTAMP)

Unique on `(business_id, user_id)`. Doubling a membership would double the employer surface,
the same reasoning as the unique index on `direct_offers`.

A membership is what grants the `employer` capability, so this table is the answer to "why may
this person hire?" — and revoking a membership takes the capability away again, which is why it
is a row rather than a flag on the business.

Row Level Security: enabled **and forced**; `SELECT` for the member and for the business owner.
No INSERT/UPDATE/DELETE policy at all, so the table is service-role-only by construction.

> **Stated boundary (`doc/13` E-056).** Business *records* — job specs, saved candidates,
> invitations — are still keyed on the person rather than the business. Somebody running two
> businesses sees one set of employer records. Threading `business_id` through those tables is a
> larger change to a working, tested module and was judged out of scope for the "simple
> business workspace" the design asked for. The business is the authorisation vehicle and the
> display identity; if two-business separation is needed it is a migration on top of this one,
> not a rewrite of it.

### B. Profiles Table (`profiles`)
Stores extended user details. Which sections appear is decided by the capability set, not by a
single role.
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

### I2. Training Provider Tables (migration `0011_trainer_module`)

#### `trainer_students`
A student enrolled with one institute.
* `id` (UUID, Primary Key)
* `trainer_id` (UUID, Foreign Key referencing `users.id`, `ON DELETE CASCADE`)
* `student_id` (UUID, Foreign Key referencing `users.id`, `ON DELETE CASCADE`)
* `enrolled_at` (TIMESTAMP)

**Deliberately holds no email, phone, or location column.** Enrolment is a code the student
redeems, so the platform never handles a list of addresses an institute compiled. A unique index
on `(trainer_id, student_id)` makes redeeming twice a no-op rather than a duplicate roster
entry and a duplicated pending decision.

#### `trainer_enrolment_codes`
The institute's one live enrolment code, stored only as a digest.
* `trainer_id` (UUID, Primary Key, Foreign Key referencing `users.id`, `ON DELETE CASCADE`)
* `code_hash` (VARCHAR(64), SHA-256)
* `created_at` (TIMESTAMP)

The raw code exists exactly once, in the response that creates it — the same treatment a
confirmation link gets, and for the same reason: a stored capability is one a database
disclosure can hand to an attacker. Rotating replaces the digest and invalidates the previous
code without unenrolling anybody, because enrolment is a row rather than a property of the
code. That is what makes storing only the digest workable. RLS is enabled and forced with **no
policy at all**, so the table is service-role-only by construction.

#### `micro_credentials`
A milestone an institute has signed off.
* `id` (UUID, Primary Key)
* `student_id` (UUID, **nullable**, Foreign Key referencing `users.id`, `ON DELETE SET NULL`)
* `trainer_id` (UUID, Foreign Key referencing `users.id`, `ON DELETE CASCADE`)
* `issued_by` (UUID, **nullable**, Foreign Key referencing `users.id`, `ON DELETE SET NULL`)
* `capability_block_id` (UUID, **nullable**, Foreign Key referencing `capability_blocks.id`, `ON DELETE SET NULL`)
* `skill_tag` (VARCHAR(160))
* `skill_level` (INTEGER)
* `milestone_title` (VARCHAR(200))
* `note` (TEXT, Optional. The instructor's words, rendered as text only)
* `status` (ENUM `micro_credential_status`: `awaiting_student`, `accepted`, `declined`)
* `issued_at` (TIMESTAMP), `answered_at` (TIMESTAMP, null while awaiting)
* `anonymised_at` (TIMESTAMP, **NULL** except on a record retained after its owner deleted their account)

**There is deliberately no `issued` and no `verified` value in the enum.** `doc/02` §5.1 calls a
micro-credential "dual-backed" without defining the second backing party; the only reading
consistent with this platform's purpose is two independent parties, the institute and the
student, so signing off can only ever produce `awaiting_student`. An institute that could
attach an endorsement to a record unaided would make its own graduates the most credentialed
people on the network, which is exactly what an endorsement should be worth something about.

**A credential is not a verified proof, and this is enforced structurally rather than by
convention.** `verifiedProofs`, `verifiedTotal`, and every employer-search aggregate derive
from `work_proof_logs` and a confirmation row; none of them reads this table. A credential says
an institution stands behind a skill. A verified proof says a customer watched the work happen.
Summing them would let a bootcamp that issued to a hundred students look like a hundred people
whose work was verified by real employers, when none of them may have had a customer at all.

`student_id` is nullable and sets null rather than cascading, matching `capability_blocks` and
`work_proof_logs`. A student who has earned a credential must still be able to delete their
account: the two `ON DELETE restrict` keys that once made that impossible are `doc/13` E-025,
and a third would repeat it. The row is retained and stamped, so the skill and the institute
keep contributing to aggregate counts while the person does not.

`issued_by` is the one name on this schema that is read back and shown, unlike every other. An
endorsement with nobody's name on it is the kind of claim this platform exists to make
attributable, so the issuer is part of the evidence rather than a detail withheld from it —
shown to the student, and to nobody else. It sets null rather than cascading, because a
credential is the institute's record: one instructor leaving must not erase what the institute
signed.

**No unique index on `(trainer_id, student_id, skill_tag)`**, deliberately. A student who
repeats a course earns a second credential for the same skill, and an institute running two
intakes of the same syllabus must be able to say which was which. `milestone_title` and
`issued_at` are what distinguish them.

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
* **PII Isolation:** Verifier phone numbers and raw client details are isolated from public worker profiles to preserve privacy. The same applies to a training provider's roster: `trainer_students` has no email, phone, or location column, and no `/trainers` endpoint can return one, so an institute holds a name and nothing more. A student joins by redeeming a code the institute published, so the platform never handles a list of addresses an institute compiled.
* **Token Hashing:** Verification links are the live capability to confirm work, so only a SHA-256 hash of the token is persisted. The raw token exists once, in the response that creates the record, and is never written to the database or to logs. Lookup by `token_hash` ensures a database disclosure is insufficient to forge a confirmation.
