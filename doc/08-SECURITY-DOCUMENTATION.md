# 08-SECURITY-DOCUMENTATION.md

**Product:** TetherProof

## 1. Overview
This document outlines the security architecture, threat model mitigations, data privacy rules, and anti-fraud protocols for the verified capability platform. Security must be enforced rigorously at both the application and infrastructure layers.

---

## 2. Authentication & Authorization Security
* **Token Management:** Supabase Auth issues short-lived access tokens for session maintenance. Tokens are transmitted exclusively over HTTPS and are never written to logs.
* **Server-Controlled Roles:** The account role is written into the `app_metadata.role` claim at registration. `user_metadata` is editable by the account holder and therefore never carries an authorization decision.
* **Role-Based Access Control (RBAC):** Every API endpoint must enforce server-side role checks. 
  * `worker` roles cannot access employer search management or training provider tools.
  * `employer` roles cannot access or modify worker capability proof logs directly.
  * `training_provider` roles are restricted to institutional milestone issuance and demand analytics.
* **Row Level Security:** Enabled on all application tables as a second, independent boundary. The browser only ever holds the public anon key, so a modified or careless client cannot read data belonging to another user. The API server holds the service-role key and is responsible for its own authorization.
* **Public Verification Tokens:** SMS and WhatsApp verification links use single-use tokens with short expiration windows to prevent replay attacks. Only a SHA-256 hash of the token is stored, so a leaked database row cannot be replayed.

---

## 3. Data Protection & PII Privacy
* **Zero-Knowledge Principle:** Employer candidate searches return anonymized tokens, aggregate proof counts, and trust scores. Personal Identifying Information (PII) such as full names, phone numbers, and direct contact details are strictly masked until a direct offer is mutually accepted.
* **Identity Data Ownership:** Credentials, email addresses, and phone numbers live in Supabase Auth and are not duplicated into application tables, which keeps identity data in one auditable place.
* **Storage Encryption:** All sensitive user records and transactional database entries must be encrypted at rest.
* **Media Sanitization:** Uploaded work proof images and audio files are stored in a private Supabase Storage bucket with EXIF location metadata and private organizational logos stripped before storage. Buckets are never public; access is granted through short-lived signed URLs, and object paths use unpredictable random identifiers.

---

## 4. Anti-Fraud & Trust Protocol Security
* **Graph Centrality Engine:** Detects and mitigates closed-loop collusion (e.g., users mutually verifying friends). Verifications from isolated two-way loops are automatically down-weighted or discounted.
* **Location & Proximity Telemetry:** Compares the GPS coordinates logged by the worker during task submission with the GPS telemetry of the client device when confirming via the verification link, preventing remote fake sign-offs.
* **AI-Fake Media Scrubber:** Scans uploaded images and videos for synthetic generation signatures or scraped web assets, rejecting unverified media files instantly.

---

## 5. Environment Variables & Secrets Management
* **No Hardcoded Secrets:** Private API keys, database credentials, and third-party service tokens (e.g., Twilio, payment gateways) must never be hardcoded in source files.
* **Environment Strategy:** All credentials must be loaded via secure environment variables (`.env`). The actual `.env` file must be excluded from version control via `.gitignore`.
