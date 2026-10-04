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
  * *Object Storage:* Supabase Storage private bucket configured with strict access control and PII scrubbing pipelines for media uploads. Public buckets are prohibited.
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

---

## 5. Monitoring, Logging, and Reliability
* **Error Tracking:** Real-time exception and error monitoring service (e.g., Sentry) integrated into both frontend and backend runtimes to capture unhandled exceptions.
* **Uptime & Health Checks:** Automated health check endpoint (`/api/v1/health`) pinging database connectivity and external service availability, returning `503` when a dependency is unreachable so the platform can drain the instance.
* **Data Backup Strategy:** Automated snapshot backups of the primary database executed daily, with a 30-day retention window for disaster recovery.
