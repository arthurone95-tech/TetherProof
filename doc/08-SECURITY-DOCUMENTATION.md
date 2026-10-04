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
* **Identity Data Ownership:** Credentials, email addresses, and phone numbers live in Supabase Auth and are not duplicated into application tables, which keeps identity data in one auditable place. The one derived value the application needs for the collusion filter is a salted hash of a client's phone number, never the number itself; see §4.
* **Storage Encryption:** All sensitive user records and transactional database entries must be encrypted at rest.
* **Media Sanitization:** Uploaded work proof images and audio files are stored in a private Supabase Storage bucket with EXIF location metadata and private organizational logos stripped before storage. Buckets are never public; access is granted through short-lived signed URLs, and object paths use unpredictable random identifiers. Uploaded content is restricted to an explicit type allow-list and a size cap, enforced in the API before any bytes are transmitted and again at the bucket itself.

---

## 4. Anti-Fraud & Trust Protocol Security
* **Graph Centrality Engine:** Detects and mitigates closed-loop collusion (e.g., users mutually verifying friends). Verifications from isolated or repeated two-way connections are automatically down-weighted.
* **Verifier Identity Is Minimised:** Identifying a verifier well enough to detect a ring requires recognising repeat confirmations, but that does not require keeping the number. `verifications` holds only a salted SHA-256 of the normalised phone number, used exclusively to recognise that the same party confirmed several proofs. The number exists in memory for the length of one dispatch and is never written to any table or log. The salt lives in `VERIFIER_PHONE_SALT` and is required in production, because phone numbers have too little entropy for an unsalted digest to be protective. See `doc/13` E-022.
* **Location & Proximity Telemetry:** Compares the GPS coordinates logged by the worker during task submission with the GPS telemetry of the client device when confirming via the verification link, so a remote sign-off is recorded as such. A party who shares no location is scored **neutral**, never as a pass and never as a failure — otherwise the check could be switched off by withholding data, and privacy-respecting users would be penalised for declining.
* **Location Metadata Removal:** Uploaded proof media is scrubbed of EXIF, ICC, and embedded GPS data by the API before it reaches storage, so a photo cannot reveal where a worker or client was. Audio tag containers are stripped the same way. The worker's submitted coordinates are the only trusted location for a proof.
* **Media Provenance Signals:** Three booleans — whether a capture device was identified, whether the capture time was consistent with the submission, and whether the container matches its declared type — are derived from the metadata **while it exists**, then the metadata is destroyed and only the conclusions are kept. No make, model, serial number, or timestamp is retained anywhere, so the privacy guarantee is unchanged by the fraud signal existing at all.
* **Synthetic-Media Detection (not implemented, and not claimed):** Rejecting AI-generated or scraped media is not implemented. No metadata check can reliably distinguish a generated image from a real one, and nothing in the system asserts that it can. The provenance signals above are consistency checks, scored as weak evidence that can only *lower* a score — never raise it above neutral — and no upload is ever refused on their basis, because a heuristic that vetoes an honest worker's photo is worse than an honest `pending` status. Every proof records `metadata_status = 'pending'` and `flagged_ai_fake` is written nowhere. See `doc/13` E-019.
* **Explainable Decisions:** The per-signal breakdown behind every `fraud_score` is persisted in `fraud_score_detail`, so a blocked proof can be explained from stored data rather than from server logs. A score a worker cannot interrogate is not defensible.
* **Rejections Are Never Punitive:** A client reporting that work did not happen is recorded as `rejected` and is never scored or marked `fraud_blocked`, however adverse the other signals look. Scoring rejections would let colluding clients manufacture free disputes against real workers.

---

## 5. Environment Variables & Secrets Management
* **No Hardcoded Secrets:** Private API keys, database credentials, and third-party service tokens (e.g., Twilio, payment gateways) must never be hardcoded in source files.
* **Environment Strategy:** All credentials must be loaded via secure environment variables (`.env`). The actual `.env` file must be excluded from version control via `.gitignore`.
