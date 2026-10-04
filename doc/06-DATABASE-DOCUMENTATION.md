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
* `metadata_status` (ENUM: `pending`, `valid`, `flagged_ai_fake`)
* `submission_gps` (VARCHAR)
* `verification_status` (ENUM: `pending`, `verified`, `rejected`, `fraud_blocked`)
* `created_at` (TIMESTAMP)

### E. Verifications Table (`verifications`)
Stores external client/supervisor confirmation records linked via SMS/WhatsApp tokens.
* `id` (UUID, Primary Key)
* `work_proof_id` (UUID, Foreign Key referencing `work_proof_logs.id`)
* `verifier_phone` (VARCHAR)
* `token_hash` (VARCHAR, Unique SHA-256 hash of the single-use verification token; the raw token is returned to the worker once at generation time and is never stored)
* `response` (ENUM: `none`, `confirmed`, `rejected`)
* `verifier_gps` (VARCHAR, For location proximity check)
* `fraud_score` (FLOAT, Calculated by graph centrality engine)
* `completed_at` (TIMESTAMP)

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
