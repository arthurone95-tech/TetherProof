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
