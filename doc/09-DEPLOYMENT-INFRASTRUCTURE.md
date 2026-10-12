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

### 2.1 Deploying the web client to Vercel

The client is one workspace of an npm-workspaces repository, and `@tetherproof/shared` is a build
artifact: `packages/shared` resolves to `dist/`, `dist/` is gitignored, and `apps/web` imports two
of its values at runtime rather than only its types. Two consequences decide every setting below:

* The shared package must be **compiled** before `next build` runs, on a machine that has the
  whole repository checked out.
* Vercel's Next.js framework default runs `next build` directly, which compiles nothing first —
  that is the `Module not found: Can't resolve '@tetherproof/shared'` failure. Two files prevent
  it: `apps/web/package.json` builds the shared package inside its own `build` script, and
  `apps/web/vercel.json` pins the build command to `npm run build` so the framework default cannot
  bypass it.

**Project settings** (Settings → General):

| Setting | Value | Why |
| --- | --- | --- |
| Root Directory | `apps/web` | Where Next.js actually lives. Set to the repository root, Vercel reports *No Next.js version detected*, because `next` is a dependency of `apps/web`, not of the root package. |
| Framework Preset | Next.js | Auto-detected from the Root Directory. |
| Node.js Version | 22.x | `engines.node` is `>=22`. |
| Install Command | *(leave empty)* | Vercel detects `package-lock.json` and the `workspaces` field at the repository root and installs there, which is what creates the `node_modules/@tetherproof/shared` link in the first place. |
| Build Command | *(leave empty — `apps/web/vercel.json` supplies `npm run build`)* | Builds `packages/shared`, then `next build`. |
| Output Directory | *(leave empty — defaults to `.next`)* | |

**Environment variables** (Settings → Environment Variables). Two are read at **build** time and
the build refuses to start without them (`apps/web/next.config.ts`):

* `NEXT_PUBLIC_SUPABASE_URL`
* `NEXT_PUBLIC_SUPABASE_ANON_KEY`

For a deployed site also set `NEXT_PUBLIC_SITE_URL` to the public origin of the client, and on the
API side set `CORS_ORIGINS` and `WEB_BASE_URL` to that same origin — see §4.2.

**If the build fails** saying it cannot find `../../packages/shared`, the project is excluding
files from outside the Root Directory; enable the *Include source files outside of the Root
Directory* option under Settings → Build and Deployment and redeploy.

**Tailwind's native engine is declared explicitly.** `lightningcss` and `@tailwindcss/oxide` load
a platform-specific `.node` binary at build time. The root `package.json` declares
`lightningcss-linux-x64-gnu` and `@tailwindcss/oxide-linux-x64-gnu` in `optionalDependencies`
(pinned to the hoisted parent versions) so the lockfile always carries the Linux binary that
Vercel builds on. Without them `npm ci` installs a tree that works on the developer's machine but
dies on Vercel with `Cannot find module '../lightningcss.linux-x64-gnu.node'` (E-041).

**Keep exactly one `vercel.json`, in the Root Directory** — that is where Vercel reads it from, so
a second copy at the repository root competes with it. The root copy that used to exist was an
experiment for the repository-root Root Directory and has been removed. The alternative
configuration (Root Directory = `.`) is possible but needs a root `vercel.json` declaring
`"framework": "nextjs"`, `"buildCommand": "npm run build --workspace @tetherproof/web"` and
`"outputDirectory": "apps/web/.next"`; without the `framework` field it is that missing field
which produces *No Next.js version detected*.

---

### 2.2 Deploying the API to Railway

The API is a container that talks to the same Supabase project the web client uses — Postgres
through `DATABASE_URL`, Storage for proof media, and Supabase Auth. Railway only runs the Node
process; no new database or provider is required.

**Repository side** (this repo):

* `Dockerfile` at the repository root, multi-stage: `npm ci` for the whole workspace, builds
  `packages/shared` then `apps/api`, and copies the compiled tree into a slim `node:24-alpine`
  runner (matching the pinned `.nvmrc`). The runner keeps the full `node_modules` (with the
  workspace symlink that resolves `@tetherproof/shared`), which trades image size for resolution
  certainty — fine for Railway, which bills CPU and memory, not disk.
* `.dockerignore` keeps `node_modules`, `dist`, `.env` and `.next` out of the build context.
* `apps/api/src/config/env.ts` makes `API_PORT` fall back to the platform-injected `PORT`, then
  4000, so the container listens where the platform's proxy expects it. Without that fallback a
  deployment that only sets `PORT` would listen on 4000 and be healthy and unreachable at once.
* `railway.json` pins `build.builder` to `DOCKERFILE` (Railway otherwise auto-detects npm and
  runs the *root* build, which compiles the web client too and fails without `NEXT_PUBLIC_*`
  build-time variables), sets `deploy.startCommand` to the same command the Dockerfile's `CMD`
  runs, and configures the health check and restart policy.

**In the Railway dashboard** (Settings → General on a new service):

| Setting | Value |
| --- | --- |
| Deploy from | GitHub repo `arthurone95-tech/TetherProof`, branch `main` |
| Service type | Dockerfile — pinned by `railway.json` at the repository root (auto-detection would otherwise run the root npm build and fail) |
| Root Directory | repository root (the Dockerfile lives here) |
| Health Check Path | `GET /api/v1/health` |

**Environment variables** (Service → Variables). The API refuses to start without the required
ones, so a missing variable fails loudly instead of half-working:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `API_HOST` | `0.0.0.0` — the localhost default only accepts same-machine connections, so a proxied container would listen and be unreachable at the same time |
| `SUPABASE_URL` | Supabase → Settings → API → project URL |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API → anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role key (server-only, never exposed to the browser) |
| `DATABASE_URL` | Supabase → Settings → Database → connection string (prefer the session pooler on port 5432) |
| `VERIFIER_PHONE_SALT` | At least 16 characters. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Randomly generated per process in production refuses to start (`apps/api/src/config/env.ts`) |

Strongly recommended:

| Variable | Value |
| --- | --- |
| `CORS_ORIGINS` | `https://tetherproof.vercel.app` — production accepts only what is listed here |
| `WEB_BASE_URL` | `https://tetherproof.vercel.app` |
| `NEXT_PUBLIC_SITE_URL` | `https://tetherproof.vercel.app` |
| `LOG_LEVEL` | `info` |

Everything else has a production-safe default. `DATABASE_SSL=true` is the switch to try if the
API boots but reports the database down. `MESSAGING_PROVIDER=log` is the correct value until
Twilio is configured (E-027).

**After the deployment is green:**

1. Run the schema migrations once against production: `npm run db:migrate --workspace @tetherproof/api` with the production `DATABASE_URL` set (a one-off Railway command, or locally against the production connection string).
2. Give the API a stable public URL (a custom domain, or keep the generated `*.up.railway.app`).
3. Set `NEXT_PUBLIC_API_BASE_URL` on Vercel (Production) to that URL and redeploy the web client — `NEXT_PUBLIC_*` values are baked in at build time (E-042 notes the fallback that applies until then).

---

## 3. Deployment Pipeline & CI/CD
* **Version Control & Branching:** GitHub repository structure featuring protected `main` (production) and `staging` branches. Direct commits to `main` are strictly prohibited.
* **Automated Checks (CI):** Every pull request automatically triggers GitHub Actions to run:
  * TypeScript type checking and syntax validation.
  * Linting and code formatting checks.
  * Automated unit and integration test suites.
* **Continuous Deployment (CD):** Merges into the `staging` branch deploy automatically to the staging environment for QA testing. Merging into `main` after approval triggers production deployment.

### 3.1 Current state of the pipeline

`.github/workflows/ci.yml` implements the checks above as far as the repository currently allows:

| Specified | State |
| --- | --- |
| TypeScript type checking | **Implemented.** `npm ci` → `npm run typecheck` → `npm run build` on every pull request, on pushes to `main`/`staging`, and on manual dispatch. The build is the check that matters most here: it is what the smoke suite executes, so a change is not green until it produces a runnable bundle. |
| Linting and formatting | **Not implemented — nothing exists to run.** No workspace has an ESLint or Prettier configuration (`doc/13` E-010). The workflow says so in a comment rather than running an empty job that would show a green tick meaning nothing. |
| Unit and integration suites | **Integration only, opt-in.** No unit-test runner is configured. The integration coverage that exists is the live smoke suite (257 checks), which creates and deletes real accounts against a real database — so it runs as a separate job gated behind the repository variable `RUN_LIVE_SMOKE` and the Supabase secrets, never automatically. See `doc/11` §4 before enabling it. |
| Continuous deployment | **Not implemented.** The workflow has no deploy job on purpose: staging and production deployment needs hosting credentials and explicit authorisation, and CI should not be able to ship on its own. |
| Protected branches | **Not implemented — and it cannot be from inside the repository.** Branch protection is a GitHub repository setting, so `main` is currently writable and pushable as the workflow above runs. |

The job can only be verified by running it; the commands inside it are the same ones run locally
before every change, and they pass. The live-smoke job has never run in CI.

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
| `FRAUD_BLOCK_BELOW` | No (default `0.25`) | Score at or below which a confirmed proof is withheld as `flagged` for human review. Validated at startup to fall strictly between 0 and 1. Never produces `fraud_blocked` — see `doc/08` §4. |
| `MESSAGING_PROVIDER` | No (default `log`) | `twilio` sends real SMS. `log` writes the link to the server log and sends nothing, which is the safe default. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | If `twilio` | Setting `MESSAGING_PROVIDER=twilio` without all three **refuses to start**, rather than looking healthy while quietly never sending. |

Keep `FRAUD_BLOCK_BELOW` generous. A false block costs an honest worker a real verification, which
is a worse outcome than letting a mediocre case through; the gate should only fire when several
signals agree. Recalibrate it once real usage data exists.

### 4.2 Production configuration checklist

Everything the process validates lives in `apps/api/src/config/env.ts`; this is what to set on the
host, in the order it will matter. The two right-hand columns record how each row was established,
because "the code says so" and "it was observed to do so" are different strengths of claim.

**Refuses to start without these** (`NODE_ENV=production`):

| Variable | Notes | Verified |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Project URL, public anon key, server-only service-role key. No defaults: a URL, then a 20-character minimum each. | Startup refusal, read from the schema |
| `DATABASE_URL` | Postgres connection string, no default. | Startup refusal, read from the schema |
| `VERIFIER_PHONE_SALT` | At least 16 characters. | **Observed:** starts and exits `1` with `required in production, at least 16 characters` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Read by `apps/web/next.config.ts` at **build** time, not run time — a client bundle built without them has no project to talk to. | Guard read from the source |

**Load-bearing, and silent if wrong:**

| Variable | If left at the default | Verified |
| --- | --- | --- |
| `CORS_ORIGINS` | Production grants cross-origin reads to exactly what is written here and to nothing else — no loopback allowance outside development. | **Observed:** in a production run with `http://localhost:3000` configured, `http://localhost:3000` was echoed and `http://localhost:3001`, `http://127.0.0.1:4200` and `https://evil.example.net` received no `Access-Control-Allow-Origin` at all |
| `NEXT_PUBLIC_API_BASE_URL` | Falls back to `http://localhost:4000`. Page code reads it in the *visitor's* browser, so at the default every request goes to the visitor's own machine. Must be the public API origin. | Fallback read from `apps/web/src/lib/api.ts` and `lib/server/api.ts` |
| `API_HOST` | `127.0.0.1`. A container or platform proxy reaches the process from outside that machine, so the port listens and is unreachable simultaneously. Set `0.0.0.0`. | Default read from the schema; note recorded in `.env.example` |
| `WEB_BASE_URL` | Empty, which skips dispatch: the worker is handed the link in the API response instead of by SMS. The product's client-facing flow then never sends anything. | Documented in `doc/07` |
| `NEXT_PUBLIC_SITE_URL` | Empty, so confirmation links return to whichever origin the request arrived on rather than to one canonical address. Correct for development, wrong for a deployed site. | Documented in `doc/07` |
| `MESSAGING_PROVIDER` + `TWILIO_*` | `twilio` with any of the three credentials missing refuses to start (E-038). `log`, the default, writes links to the log and sends nothing — right for a staging environment, wrong for a real one. | **Observed:** production run exits `1` with the three names listed |

**Defaults that are fine:** `API_PORT` (4000), `LOG_LEVEL` (`info`), `FRAUD_PROXIMITY_KM` (2),
`FRAUD_BLOCK_BELOW` (0.25), `VERIFICATION_TOKEN_TTL` (259200 s), `DATABASE_POOL_MAX` (10),
`STORAGE_PROOFS_BUCKET` (`work-proofs`), `STORAGE_MAX_UPLOAD_BYTES` (10 MiB).

`API_BASE_URL` was removed from the API's schema during this review: it was validated on startup
and then never referenced by anything, while the variable that does the work —
`NEXT_PUBLIC_API_BASE_URL` — sits in the client workspace. Two similarly named keys where only one
has an effect is how a deployment configures the wrong one.

---

## 5. Monitoring, Logging, and Reliability
* **Error Tracking:** Real-time exception and error monitoring service (e.g., Sentry) integrated into both frontend and backend runtimes to capture unhandled exceptions.
* **Uptime & Health Checks:** Automated health check endpoint (`/api/v1/health`) pinging database connectivity and external service availability, returning `503` when a dependency is unreachable so the platform can drain the instance.
* **Data Backup Strategy:** Automated snapshot backups of the primary database executed daily, with a 30-day retention window for disaster recovery.
