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

### Status as of 2026-10-05

The Employer module is complete. The Training Provider module is **not started** and is
deliberately deferred to its own pass, so Phase 4 is half delivered.

| Task | State |
| --- | --- |
| Employer dashboard | **Complete.** Profile form, spec builder, search, and sent invitations. Verified in a real browser end to end: signed in through the sign-in form, ran a search from the shareable result URL, sent an invitation, signed in as the worker, accepted it, and confirmed the identity reveal on the employer's side. |
| Zero-knowledge search | **Complete.** Returns proof counts, trust score, distance, and last-verified time. No endpoint returns a worker id, name, contact detail, or coordinate. Cards carry an employer-scoped expiring handle that resolves to nothing for any other employer. |
| Capability spec builder | **Complete.** Create, pause, update, delete. A paused spec keeps the employer's saved shortlists; an invitation already sent keeps a null reference to its spec. |
| Direct invitation pipeline | **Complete.** Approval-gated send, single outstanding invitation per employer/worker pair, one final worker answer. Identity reveal is deliberately one-directional: masked until accepted, then visible on the employer side only. |
| Employer approval | **Complete.** A review row with reviewer and timestamp, not a flag on the user. Search is open to unapproved accounts; only sending is gated. Self-registration stays open so there is somebody to approve. |
| Admin approval UI | **Not built.** The API endpoint exists and is exercised by the smoke suite, but there is no page. An administrator approving an employer today needs a tool call. |
| Training provider module | **Not started.** No roster, milestone issuer, or demand insights. |
| Automated browser tests | **Not built.** The flows were walked by hand in a real browser. There is no test that would fail if the dashboard regressed. |

**Two defects were found and fixed during this phase.** The registration endpoint accepted
`admin` as a self-declared role, which is a full privilege escalation — an anonymous caller
could register as an administrator, approve their own employer account, and send invitations.
`admin` is now excluded from the roles the endpoint will accept, verified live. Separately,
accounts provisioned outside registration had no `profiles` row, so their profile read and
write both returned 404; the update is now an upsert. Both are recorded in `doc/13` (E-024,
E-026).

**A third, found while closing E-025, changed the schema.** Deleting an account that had logged
work was impossible: two foreign keys were `ON DELETE restrict`, so the delete aborted and
Supabase reported a generic `Database error deleting user` that named neither the table nor the
constraint. Deletion now anonymises rather than destroying — the person is removed and the
evidence is detached and retained, because an aggregate spans many people and deleting one
worker's rows would destroy a different worker's trust score. Enforced by a `BEFORE DELETE`
trigger in the database rather than in a service, since a service can be bypassed by the
dashboard, a migration, or the smoke suite. The one thing it cannot do is delete the stored
media, which SQL refuses; those paths are recorded in `orphaned_proof_media` so the gap is
auditable rather than silent. Recorded as `doc/13` E-025 and E-029, and documented in `doc/08`.

**Still open and worth naming before this phase is called done:** deletion is self-service only —
`DELETE /api/v1/auth/account` is built, documented, and covered by the smoke suite, but there is no
admin route for handling a deletion request on somebody's behalf.

**Outstanding before Phase 4 can be called done:** the Training Provider module, an admin
approval page, and an automated browser test for the employer flow.

---

---

## 6. Phase 5: Testing, Security Review & Production Launch (Weeks 9 - 10)
* **Goal:** Ensure system stability, security compliance, and production deployment readiness.
* **Key Tasks:**
  * Conduct end-to-end testing across desktop and mobile-web viewports.
  * Perform security audit of API endpoints, authentication flows, and data privacy isolation.
  * Configure production hosting environment (Vercel/Netlify frontend, managed database backend, environment variable secrets).
  * Deploy to production and initialize live system monitoring.

**Completed:** end-to-end testing at phone and desktop widths in a real browser (the desktop
navigation is the same-origin 1000px frame because no wide viewport is available here); the security
audit, which covered the endpoint/role matrix, anonymous and cross-role access, the rate-limit
buckets, the CORS origin policy in both development and production mode, response headers on both
applications, a secrets scan of every tracked file, and an audit of every environment key the code
reads against `.env.example`; and production configuration — `.github/workflows/ci.yml`, the CI and
checklist sections added to `doc/09` §3.1 and §4.2, and start-up refusal and health behaviour probed
directly against the production build. Errors found along the way are logged through `doc/13`
E-039; the smoke suite asserts 257 checks, including response headers.

**What remains, and why it is not a code change:** choosing the hosting platforms and creating the
staging/production Supabase projects, injecting their secrets, enabling repository branch
protection, wiring an error tracker and an uptime monitor, and the deployment itself. Each needs
the owner's accounts and explicit authorisation, so none of them can be completed from inside the
repository. No `Dockerfile` or platform manifest was written either: the runtime target has not
been chosen, and this machine has no container tooling with which to verify one — an unverifiable
deployment file would be worse than none.

**Still open from earlier phases:** the Twilio account behind `doc/13` E-027 (Phase 3), the
Training Provider module and admin approval page (Phase 4), and the missing ESLint and unit-test
runners (E-010), which is also why the CI workflow has no lint or unit-test job.
