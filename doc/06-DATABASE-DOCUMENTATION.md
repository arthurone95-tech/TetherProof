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
* `user_id` (UUID, Foreign Key referencing `users.id`)
* `full_name` (VARCHAR)
* `location_city` (VARCHAR)
* `location_gps` (VARCHAR / POINT data for proximity checks)
* `organization_name` (VARCHAR, Optional, for employers/schools)
* `avatar_url` (VARCHAR)

### C. Capability Blocks Table (`capability_blocks`)
Stores the verifiable skills and execution milestones owned by workers.
* `id` (UUID, Primary Key)
* `worker_id` (UUID, Foreign Key referencing `users.id`)
* `skill_tag` (VARCHAR, Indexed - e.g., `Refrigeration Repair`, `React State Management`)
* `skill_level` (INTEGER)
* `proof_count` (INTEGER, Default: 0)
* `last_verified_at` (TIMESTAMP)

### D. Work Proof Logs Table (`work_proof_logs`)
Stores individual task completions, media proofs, and telemetry data.
* `id` (UUID, Primary Key)
* `worker_id` (UUID, Foreign Key referencing `users.id`)
* `capability_block_id` (UUID, Foreign Key referencing `capability_blocks.id`)
* `description` (TEXT)
* `media_url` (VARCHAR, Secure object storage path with stripped PII)
* `metadata_status` (ENUM: `pending`, `valid`, `flagged_ai_fake`. **Only `pending` is ever written.** The other two values exist in the type but no code path sets them, because detecting synthetic media is not implemented and is not claimed. The provenance signals below are consistency checks, not AI-generation detection)
* `media_signal_evaluated` (BOOLEAN, False when the file could not be examined for provenance)
* `media_has_camera_signature` (BOOLEAN, True when the discarded EXIF named a capture device)
* `media_timestamp_plausible` (BOOLEAN, True when the discarded capture time was consistent with the submission)
* `media_encoder_known` (BOOLEAN, True when the container is structurally what its declared type claims)
* `submission_gps` (VARCHAR)
* `verification_status` (ENUM: `pending`, `verified`, `rejected`, `fraud_blocked`)
* `created_at` (TIMESTAMP)

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

### G. Direct Offers Table (`direct_offers`)
Stores direct connection requests sent from employers to verified workers.
* `id` (UUID, Primary Key)
* `employer_id` (UUID, Foreign Key referencing `users.id`)
* `worker_id` (UUID, Foreign Key referencing `users.id`)
* `status` (ENUM: `pending`, `accepted`, `declined`)
* `created_at` (TIMESTAMP)

---

## 3. Data Integrity & Security Rules
* **Row Level Security:** Enabled on every table. Because Supabase exposes the database to the browser through PostgREST, RLS is the boundary that keeps one user from reading another's data. Policies restrict each table to its owner (and, for direct offers, to both parties). Employers cannot read worker work proofs directly; that data is only reachable through the zero-knowledge search service.
* **Foreign Key Constraints:** Strict cascading rules on user deletion to preserve audit history and prevent orphaned verification records. Deleting an account cascades to profiles and specs but is restricted on the proof and verification tables.
* **Encryption:** Sensitive personal data and authentication secrets must be encrypted at rest.
* **PII Isolation:** Verifier phone numbers and raw client details are isolated from public worker profiles to preserve privacy.
* **Token Hashing:** Verification links are the live capability to confirm work, so only a SHA-256 hash of the token is persisted. The raw token exists once, in the response that creates the record, and is never written to the database or to logs. Lookup by `token_hash` ensures a database disclosure is insufficient to forge a confirmation.
