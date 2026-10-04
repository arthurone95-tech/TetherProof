# 03-SYSTEM-ARCHITECTURE.md

**Product:** TetherProof

## 1. Overview
This document defines the high-level system architecture, component layout, data flow patterns, and integration boundaries for the verified capability platform. The architecture is designed to be lightweight, secure, and accessible via modern web browsers on both desktop and mobile devices.

---

## 2. High-Level Architecture Pattern
The application follows a modular monolith / decoupled client-server architecture:
* **Frontend:** Responsive Web Application optimized for mobile browsers (for trade workers and clients checking SMS links) and desktop browsers (for enterprise employers and training administrators).
* **Backend API Server:** Node.js / TypeScript API server handling business logic, role-based authorization, capability graph calculations, and matching algorithms.
* **Backend-as-a-Service:** Supabase provides the managed PostgreSQL database, Auth (user roles and sessions), and private Storage for media uploads with metadata scrubbing.
* **External Integration & Messaging Layer:** Handles OAuth connectors (GitHub/Jira), SMS/WhatsApp dispatch APIs, and AI metadata inspection services.

---

## 3. Core Component Layers

### A. Client Layer (Frontend)
* **Framework:** Next.js (React) with TypeScript, using `@supabase/ssr` so the session is carried in cookies and Row Level Security applies identically on the server and in the browser.
* **UI Toolkit:** Tailwind CSS with a small internal component set, mobile-first responsive layouts.
* **Key Views:** 
  * *Worker Dashboard:* Capability graph visualization, quick voice/photo log buttons, incoming offer inbox.
  * *Employer Dashboard:* Capability Spec builder, zero-knowledge candidate search, direct invite pipeline.
  * *Training Provider Dashboard:* Student roster management, milestone issuer, market demand insights chart.
  * *External Verification View:* Lightweight, zero-app mobile web page for clients (Mr. Mensah) to approve or reject work via SMS/WhatsApp links.

### B. Service & Business Logic Layer (Backend)
* **API Framework:** Express REST endpoints under `/api/v1`.
* **Core Modules:**
  * **Auth & RBAC:** Supabase Auth issues and validates sessions. The API reads the role from the server-controlled `app_metadata.role` claim and enforces role segregation (Worker, Employer, Training Provider, Admin) on every route.
  * **Telemetry & Ingestion Service:** Processes webhook events from developer tools and parses voice-to-text milestone submissions.
  * **Trust & Anti-Fraud Engine:** Executes graph centrality calculations, GPS/location proximity checks, and metadata/AI-fake validation rules.
  * **Matching Engine:** Computes zero-knowledge capability scores and filters candidates based on employer spec criteria.

### C. Data & Persistence Layer
* **Primary Database:** Supabase-managed PostgreSQL with strict ACID compliance for user records, capability blocks, verification logs, and enterprise transactions. Accessed by the API through a typed Drizzle ORM layer using parameterized queries.
* **Row Level Security:** Enabled on every application table so a compromised or careless client cannot read another user's data. The API connects with the service-role key and performs its own authorization; the browser only ever holds the public anon key.
* **Object Storage:** Supabase Storage private bucket for media assets (work completion photos) with automatic PII stripping and privacy blurring, served through short-lived signed URLs.

---

## 4. Data Flow & Security Boundaries

### Verification Flow (The SMS/WhatsApp Loop)
1. Worker submits task proof -> Backend generates a cryptographically signed, expiring token tied to a unique verification URL.
2. Twilio or SMS/WhatsApp provider delivers the text link to the client's phone number.
3. Client clicks the link on mobile browser -> Frontend renders lightweight confirmation page.
4. Client submits "Yes/No" -> Backend validates token, checks GPS/device telemetry parameters, updates the worker's verified capability score, and logs audit trails.

### Zero-Knowledge Search Flow
1. Employer creates Capability Spec (e.g., minimum skill level + verified count).
2. Employer queries matching API -> Backend runs secure filtering over capability graphs.
3. Database returns anonymized candidate tokens with aggregate proof scores.
4. Employer triggers direct invite -> System prompts worker to accept/reveal identity before establishing direct communication.

---

## 5. Security and Infrastructure Principles
* **Stateless API Authentication:** Token-based authentication securing all protected endpoints.
* **Server-Side Validation:** All role checks, permission validations, and fraud scoring occur strictly on the server side.
* **Data Privacy Isolation:** Personal identifying information (PII) is masked during public/zero-knowledge employer searches.
