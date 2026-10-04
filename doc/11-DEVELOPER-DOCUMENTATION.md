# 11-DEVELOPER-DOCUMENTATION.md

**Product:** TetherProof

## 1. Overview
This document provides technical instructions for developers and AI agents setting up, contributing to, and maintaining the codebase for the verified capability platform. It covers local environment configuration, dependency management, coding conventions, and testing guidelines.

---

## 2. Local Environment Setup

### A. Prerequisites
* **Node.js:** Node.js 22 or newer (the repository pins a version in `.nvmrc`).
* **Package Manager:** `npm`, matching the committed `package-lock.json`.
* **Backend Services:** A Supabase project providing PostgreSQL, Auth, and Storage. There is no local database to install.

### B. Installation & Configuration Steps
1. **Clone Repository:** Clone the project repository to your local machine.
2. **Install Dependencies:** Run `npm install`.
3. **Configure Environment Variables:**
   * Copy the template file: `cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`).
   * Fill in the Supabase values from **Settings → API** and **Settings → Database → Connection string**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `DATABASE_URL`.
   * Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the web app. The anon key is public configuration; the service-role key is server-only and must never be exposed to the browser or committed.
   * A single `.env` at the repository root serves every workspace; the API and Drizzle locate it automatically.
   * *Security Warning:* Never commit your active `.env` file to version control.
4. **Run Database Migrations:** Run `npm run db:migrate`. Migrations are plain SQL files in `apps/api/drizzle/`, reviewed in a pull request before being applied. Schema changes are made with `npm run db:generate` and never pushed directly.
5. **Create the Proof Bucket:** Run `npm run storage:ensure-bucket`. This creates the private `work-proofs` bucket and applies its size cap and MIME allow-list. The limits have to be written directly to `storage.buckets`, because Supabase's management API accepts them and then discards them without error (`doc/13` E-017). Re-run it against a new or reset project.
6. **Start Development Server:** Run `npm run dev` for the API and `npm run dev:web` for the web app.
7. **Verify the Setup:** Run `npm run build`, then `npm run smoke -- --live` (see section 4).

---

## 3. Code Conventions & Architecture Rules
* **Type Safety:** Use TypeScript across both frontend and backend modules to enforce strict type checking and minimize runtime errors.
* **Modular Structure:** Keep business logic separated into dedicated service modules (Auth, Telemetry, Anti-Fraud, Matching) rather than monolith route handlers.
* **Server-Side Validation:** All inputs, role checks, and authorization rules must be validated on the server side before persisting data.
* **Clean Code:** Avoid unnecessary abstractions or over-engineering. Follow existing file naming conventions and project structure strictly.

---

## 4. Testing & Verification Guidelines
* **Build and Types:** Run `npm run build` and `npm run typecheck`. Both must pass before a change is submitted.
* **Live Smoke Test:** Run `npm run build` first, then:
  * `npm run smoke -- --live` — API, database, Auth trigger, and Row Level Security.
  * `npm run smoke -- --live --web` — additionally the client confirmation page and the browser CORS path. Serves the web app on the origin listed in `CORS_ORIGINS`, so free that port first.
  * `--live` is mandatory and the script prompts before touching anything: it creates and deletes real accounts. Only ever point it at a development Supabase project, never production. In CI add `--yes`.
* **Unit Tests:** Execute unit and integration suites using the project test runner (`npm test`).
* **Media Scrubbing:** Run `npm run scrub-check`. It asserts the metadata scrubber against constructed fixtures rather than mocks and needs no server, database, or live project.
* **Manual Verification:** Before submitting changes, verify UI layouts across mobile and desktop breakpoints, and confirm the confirmation page in a real browser at a phone viewport.
* **Security Checks:** Ensure no private secrets, API keys, or unmasked database credentials are introduced into source files. Confirm `.env` remains untracked and the service-role key appears only in server-side code.

---

## 5. Git Workflow & Contribution Standards
* **Branching Strategy:** Work on dedicated feature branches off `staging`. Never commit directly to `staging` or `main`.
* **Commit Messages:** Use clear, concise commit summaries describing the changes made (e.g., `feat: add graph centrality filter rule`).
* **Pull Requests:** Submit pull requests with a clear technical description of changes, tests performed, and verification results.
