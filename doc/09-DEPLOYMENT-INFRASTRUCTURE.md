# 09-DEPLOYMENT-INFRASTRUCTURE.md

**Product:** TetherProof

## 1. Overview
This document outlines the cloud hosting environment, infrastructure topology, deployment pipelines, and production readiness standards for the verified capability platform. The infrastructure is designed to be scalable, secure, and cost-effective for both desktop and mobile-web users.

---

## 2. Infrastructure Architecture & Hosting Stack
* **Frontend Hosting:** Modern edge-optimized static hosting platform (e.g., Vercel or Netlify) providing fast global content delivery for the React/Next.js client application.
* **Backend API Hosting:** Secure containerized or managed Node.js runtime environment (e.g., Railway, Render, or AWS ECS) capable of handling real-time telemetry processing and anti-fraud computations.
* **Database & Storage:** 
  * *Primary Database:* Supabase-managed PostgreSQL (Auth, Database, and Storage) with automated daily backups and SSL encryption in transit.
  * *Object Storage:* Supabase Storage private bucket for media uploads. The bucket is created private by `apps/api/scripts/ensure-proof-bucket.ts` (`npm run storage:ensure-bucket`); public buckets are prohibited. PII scrubbing is performed by the API before upload, not by Storage. The bucket also carries a `file_size_limit` and an `allowed_mime_types` allow-list as a second layer. Supabase's management API accepts both settings and then silently discards them, so the script writes them directly to `storage.buckets` and verifies they persisted (`doc/13` E-017). The API's own type allow-list and size cap remain the first line, because they reject a bad upload before any bytes are transmitted.
* **Messaging & Communication Gateway:** External third-party API integration (e.g., Twilio or local gateway) for dispatching SMS and WhatsApp verification links.

---

## 3. Deployment Pipeline & CI/CD
* **Version Control & Branching:** GitHub repository structure featuring protected `main` (production) and `staging` branches. Direct commits to `main` are strictly prohibited.
* **Automated Checks (CI):** Every pull request automatically triggers GitHub Actions to run:
  * TypeScript type checking and syntax validation.
  * Linting and code formatting checks.
  * Automated unit and integration test suites.
* **Continuous Deployment (CD):** Merges into the `staging` branch deploy automatically to the staging environment for QA testing. Merging into `main` after approval triggers production deployment.

---

## 4. Environment Configuration & Secret Management
* **Environment Segregation:** Separate Supabase projects (or at minimum separate configuration profiles) for `development`, `staging`, and `production`.
* **Secret Storage:** All production API keys, database connection strings, the Supabase service-role key, and messaging gateway tokens must be injected via the hosting provider's secure environment variable settings. 
* **Prohibition:** Never hardcode sensitive secrets in configuration files or commit `.env` files to version control.
* **Key Separation:** The Supabase anon key is public configuration and may be shipped to the browser. The service-role key bypasses Row Level Security and must exist only in the API server environment, never in the client bundle.

### 4.1 Trust engine and messaging variables

| Variable | Required | Notes |
| --- | --- | --- |
| `VERIFIER_PHONE_SALT` | **Yes, in production** | Salt for the verifier phone hash. At least 16 characters. The process **refuses to start** without it when `NODE_ENV=production`, because a generated salt would change on every restart and previously hashed numbers would stop matching — quietly resetting the collusion history with nothing in the logs to say why. Outside production a random per-process salt is used with a warning. A default is deliberately not provided: a committed salt is a published salt, and phone numbers have too little entropy for an unsalted digest to be protective. |
| `WEB_BASE_URL` | For SMS dispatch | Public origin of the web client, used to build the link a client taps. Left unset, dispatch is skipped and the worker receives the link in the API response instead. |
| `FRAUD_PROXIMITY_KM` | No (default `2`) | Distance still treated as the same site. |
| `FRAUD_BLOCK_BELOW` | No (default `0.25`) | Score at or below which a confirmed proof is marked `fraud_blocked`. Validated at startup to fall strictly between 0 and 1. |
| `MESSAGING_PROVIDER` | No (default `log`) | `twilio` sends real SMS. `log` writes the link to the server log and sends nothing, which is the safe default. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | If `twilio` | Setting `MESSAGING_PROVIDER=twilio` without all three **refuses to start**, rather than looking healthy while quietly never sending. |

Keep `FRAUD_BLOCK_BELOW` generous. A false block costs an honest worker a real verification, which
is a worse outcome than letting a mediocre case through; the gate should only fire when several
signals agree. Recalibrate it once real usage data exists.

---

## 5. Monitoring, Logging, and Reliability
* **Error Tracking:** Real-time exception and error monitoring service (e.g., Sentry) integrated into both frontend and backend runtimes to capture unhandled exceptions.
* **Uptime & Health Checks:** Automated health check endpoint (`/api/v1/health`) pinging database connectivity and external service availability, returning `503` when a dependency is unreachable so the platform can drain the instance.
* **Data Backup Strategy:** Automated snapshot backups of the primary database executed daily, with a 30-day retention window for disaster recovery.
