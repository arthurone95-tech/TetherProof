# 04-TECHNICAL-DOCUMENTATION.md

**Product:** TetherProof

## 1. Overview
This document outlines the technical guidelines, coding standards, API design patterns, and system integration protocols for the verified capability platform. It serves as a technical reference for developers and AI agents building and maintaining the codebase.

---

## 2. Technology Stack Standards
* **Frontend:** Next.js with TypeScript for type safety and robust component structuring. Tailwind CSS, mobile-responsive and optimized for low-bandwidth mobile browsers. Sessions are handled with `@supabase/ssr`.
* **Backend:** Node.js / TypeScript API server (Express) in a lightweight, secure runtime environment.
* **Database & ORM:** Supabase-managed PostgreSQL accessed through Drizzle ORM with a type-safe schema, so every query is parameterized and validated against a strict schema definition.
* **Backend-as-a-Service:** Supabase provides Auth (user roles and sessions) and private Storage buckets for media uploads with EXIF stripping.
* **External Integrations:** 
  * SMS/WhatsApp Messaging Gateway (e.g., Twilio or equivalent) for verification links.
  * OAuth2 clients for developer telemetry connectors (GitHub, Jira).
  * Media inspection utility for metadata and file validation.

---

## 3. API Design Principles
* **RESTful Architecture:** Clear, resource-oriented endpoint naming conventions (e.g., `/api/v1/workers`, `/api/v1/verifications`, `/api/v1/employers/specs`).
* **Stateless Authentication:** Supabase access tokens (JWT) are required for all protected user endpoints and are sent as `Authorization: Bearer <token>`. Public verification endpoints use short-lived single-use tokens whose SHA-256 hash is the only stored value.
* **Input Validation & Sanitization:** All incoming request bodies, route parameters, and query parameters must be validated server-side using Zod schemas before any handler logic runs.
* **Error Handling:** Standardized JSON error responses containing an error code, human-readable message, and appropriate HTTP status codes (400, 401, 403, 404, 409, 410, 429, 500) without leaking internal stack traces, SQL, or third-party service details.

---

## 4. Core Service Modules & Logic

### A. Authentication Service
* Delegates credential storage, password hashing, token issuance, and session refresh to Supabase Auth.
* Writes the account role into the server-controlled `app_metadata.role` claim at registration, so the role cannot be altered by the account holder.
* Enforces role-based access control (RBAC) middleware on all routes. Workers cannot access employer search management or training provider tools, and employers cannot modify worker capability proof logs.

### B. Telemetry & Ingestion Service
* Processes automated webhook payloads from developer tools and parses voice-to-text inputs into standardized skill tag objects.
* Ensures raw data is sanitized and stripped of proprietary source code or sensitive enterprise credentials before storing capability proof blocks.

### C. Trust & Anti-Fraud Engine
* **Graph Centrality Check:** Evaluates incoming verifications against the historical interaction graph to penalize closed-loop endorsement rings.
* **Proximity Validation:** Compares worker submission GPS coordinates with client verification confirmation timestamps and device signatures.
* **Metadata Scrubber:** Inspects uploaded image/video files for valid camera signatures, rejecting synthetic media or scraped assets.

### D. Matching Engine
* Executes zero-knowledge filtering queries over worker capability graphs.
* Strips PII from search result payloads, returning only aggregated proof counts, skill tiers, and anonymized candidate tokens until an explicit offer is accepted.

---

## 5. Security & Data Handling Standards
* **Secrets Management:** All API keys, database credentials, and third-party service tokens must be loaded via environment variables. Never hardcode credentials in source code.
* **Database Security:** Parameterized queries and ORM abstractions must be used exclusively to protect against SQL injection.
* **File Upload Security:** Uploaded files must be validated for MIME type and file size, renamed with unpredictable cryptographic hashes, and stored in isolated object storage buckets.
