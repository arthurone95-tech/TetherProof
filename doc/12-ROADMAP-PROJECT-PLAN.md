# 12-ROADMAP-PROJECT-PLAN.md

**Product:** TetherProof

## 1. Overview
This document defines the phased development plan, milestones, and delivery timeline for building, testing, and launching the verified capability platform. The roadmap is structured to prioritize foundational architecture, core anti-fraud verification loops, user interfaces, and final production readiness.

---

## 2. Phase 1: Foundation & Core Infrastructure (Weeks 1 - 2)
* **Goal:** Establish project repository, database schemas, and authentication scaffolding.
* **Key Tasks:**
  * Initialize repository structure following governance guidelines (`AGENT_CAPABILITIES.md`, `AGENT_WORKFLOW.md`, `AGENTS.md`, `AUTOMATION_WORKFLOW.md`).
  * Set up Next.js / TypeScript frontend framework and Express / Node.js backend API server in an npm workspace monorepo.
  * Provision the Supabase project and apply initial Drizzle migrations covering the seven core tables, Row Level Security policies, and the `auth.users` link (`06-DATABASE-DOCUMENTATION.md`).
  * Implement authentication via Supabase Auth with server-controlled Role-Based Access Control (Worker, Employer, Training Provider, Admin).
  * Create `.gitignore` and `.env.example`, keeping the service-role key server-only.

---

## 3. Phase 2: Worker Module & Proof Ingestion (Weeks 3 - 4)
* **Goal:** Build worker profiles and multi-channel work proof ingestion.
* **Key Tasks:**
  * Develop worker dashboard UI (mobile-optimized profile view and quick log bars).
  * Build telemetry ingestion backend for digital connectors (GitHub/Jira) and voice/photo milestone uploads.
  * Implement secure object storage integration with metadata stripping and privacy scrubbing.

---

## 4. Phase 3: Verification & Anti-Fraud Engine (Weeks 5 - 6)
* **Goal:** Implement the frictionless external verification loop and trust protections.
* **Key Tasks:**
  * Integrate SMS/WhatsApp messaging gateway (e.g., Twilio) for dispatching verification request links.
  * Build lightweight mobile web client verification page ("Yes/No" confirmation page).
  * Implement the Trust & Anti-Fraud Engine: Graph Centrality collusion filter, GPS proximity checks, and AI-fake media detection.

### Status as of 2026-10-04

| Task | State |
| --- | --- |
| Mobile web confirmation page | **Complete.** `/verify/[token]`, verified through SSR and browser-equivalent HTTP. Not yet clicked in a real browser — no headless browser in this environment. |
| Graph centrality collusion filter | **Complete.** Verifier identified by salted phone hash; network-diversity weighting with concentration and mutual-endorsement findings. Exercised live: five endorsements build a history, a sixth off-site confirmation is independently blocked. |
| GPS proximity checks | **Complete.** Haversine distance with `within` / `outside` / `unavailable`. A missing location is scored neutral, never as a failure, so withholding data cannot defeat the check. |
| Media detection | **Delivered as provenance signals, not AI-fake detection.** See below. |
| Twilio dispatch | **Adapter built, not yet run against Twilio.** Implemented with `fetch` against the Messages REST API — no vendor SDK added. The provider interface, the log adapter, and the full dispatch path are verified live; no Twilio account exists yet, so the Twilio adapter itself is unexercised. WhatsApp was dropped: Twilio reaches WhatsApp through the same Messages endpoint, so a second channel would add no capability. |

**AI-fake media detection was deliberately not implemented as specified.** The specification asks a
detector to read camera signatures and timestamps from files that Phase 2 exists to destroy, and
no metadata check can reliably distinguish a generated image from a real one. What is delivered is
three provenance booleans derived while the metadata still exists, then discarded — no make, model,
serial, or timestamp is retained. The full reasoning, and why the specification had to be
corrected in `doc/01` and `doc/02`, is recorded in `doc/13` E-019. `metadata_status` remains
`pending` and `flagged_ai_fake` is written nowhere.

**Outstanding before Phase 3 can be called done:** a Twilio account and credentials, verified
end-to-end for a real delivered SMS.

---

## 5. Phase 4: Employer & Training Provider Modules (Weeks 7 - 8)
* **Goal:** Build enterprise talent matching and educational micro-credentialing tools.
* **Key Tasks:**
  * Develop Employer Dashboard: Capability Spec builder and zero-knowledge talent search.
  * Implement direct invitation pipeline and offer management.
  * Develop Training Provider Dashboard: Student roster management, milestone issuer, and market demand insights dashboard.

---

## 6. Phase 5: Testing, Security Review & Production Launch (Weeks 9 - 10)
* **Goal:** Ensure system stability, security compliance, and production deployment readiness.
* **Key Tasks:**
  * Conduct end-to-end testing across desktop and mobile-web viewports.
  * Perform security audit of API endpoints, authentication flows, and data privacy isolation.
  * Configure production hosting environment (Vercel/Netlify frontend, managed database backend, environment variable secrets).
  * Deploy to production and initialize live system monitoring.
