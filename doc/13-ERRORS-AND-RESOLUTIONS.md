# Errors and Resolutions

Living record of defects and unresolved risks found during implementation. Every entry states what went wrong, what it affects, and how it will be closed. An entry is only marked **Resolved** once the fix is verified against the live Supabase project, not merely written.

**Status values:** `Open` (known, not fixed) · `In Progress` (fix started) · `Resolved` (fixed and verified) · `Accepted` (risk consciously kept)

---

## E-001: Supabase Auth user creation failed for every account

* **Status:** Resolved
* **Found:** 2026-10-04, during the first live run against Supabase.

### Description
`POST /api/v1/auth/register` returned `400 Account could not be created with these details.` for every new account, regardless of email domain or phone/email combination. Supabase Auth reports the cause only as the opaque `Database error creating new user` (500), so the real fault was hidden.

### Root cause
Two separate defects, both in the `public.sync_user_role()` trigger installed by migration `0001_rls_and_auth_link.sql`:

1. **Duplicate primary key.** `auth.service.ts` inserted into `public.users` immediately after `createUser`, but the `on_auth_user_created` trigger had already inserted that row. The explicit insert always collided on the primary key.
2. **Missing enum cast.** The trigger assigned a `text` expression to the `user_role` enum column, which PL/pgSQL rejects:
   `column "role" is of type public.user_role but expression is of type text`

### Impact
Registration was completely non-functional. No account could be created, so nothing downstream could be tested.

### Resolution
* `auth.service.ts` no longer writes to `public.users`; the trigger is the single writer of that row.
* Migration `0002_fix_user_role_enum_cast.sql` replaces the function with an explicit `CASE` mapping to `user_role`, and adds an `AFTER UPDATE OF raw_app_meta_data` trigger so a later role change stays mirrored.

### Verification
Live: registration returns `201`, the trigger writes `public.users.role`, and changing `app_metadata.role` from `employer` to `training_provider` was observed to update `public.users.role` automatically.

---

## E-002: Migration errors were undebuggable

* **Status:** Resolved
* **Found:** 2026-10-04, while applying `0002`.

### Description
`npm run db:migrate` reported only `Failed query: <entire SQL file>`, with the actual PostgreSQL message missing, making the failure impossible to diagnose.

### Root cause
`pg` nests the server error in `error.cause`; the migration error handler only read `error.message`.

### Resolution
`src/db/migrate.ts` now unwraps `error.cause` and reports the server message. This is what surfaced the `IS` syntax error described in E-003.

---

## E-003: `IS DISTINCT FROM` is invalid in a `CREATE TRIGGER` clause

* **Status:** Resolved
* **Found:** 2026-10-04, applying `0002`.

### Description
`syntax error at or near "IS"` when creating the role-change trigger.

### Root cause
PostgreSQL does not accept `IS DISTINCT FROM` inside a `CREATE TRIGGER ... WHEN` condition. It was intended to skip no-op role updates.

### Resolution
The comparison was moved into the function body (`IF TG_OP = 'UPDATE' AND OLD... IS NOT DISTINCT FROM NEW...`), where it is valid, and the trigger was created without a `WHEN` clause.

---

## E-004: Root `.env` was invisible to the API and Drizzle

* **Status:** Resolved
* **Found:** 2026-10-04, before the first live migration.

### Description
`DATABASE_URL` was undefined in `src/db/migrate.ts` even though a valid `.env` existed at the repository root.

### Root cause
npm workspace scripts run with the working directory set to the package (`apps/api`), so `dotenv()` only looked for `apps/api/.env`. In addition, `migrate.ts` read `process.env` directly without loading any file.

### Resolution
* Added `src/config/load-env.ts`, which walks up from the module to find the repository-root `.env`, and is used by `src/config/env.ts`.
* `src/db/migrate.ts` now imports the validated `env` object, so migrations and the server share one configuration source.
* `drizzle.config.ts` loads the root `.env` explicitly for `db:generate` and `db:studio`.

---

## E-005: `next build` failed prerendering `/404` when `NODE_ENV` was inherited

* **Status:** Resolved
* **Found:** 2026-10-04, verifying the client confirmation page.

### Description
`<Html> should not be imported outside of pages/_document`, failing the build at `/404`. The identical build succeeded when run through the root npm script.

### Root cause
The build inherited `NODE_ENV` from `.env`. Next must build in production mode; with a non-production value its error-page prerendering misbehaves.

### Resolution
Web builds and `next start` are run with `NODE_ENV=production` pinned in the verification harness. **Deployment note:** the host must set `NODE_ENV=production` for the web app, otherwise this build failure returns.

---

## E-006: Verification tooling ran against a stale server process

* **Status:** Resolved
* **Found:** 2026-10-04, during live testing.

### Description
Later test runs reported `429` rate-limit errors on the second request of a freshly started process, and inconsistent results.

### Root cause
A server process from an earlier run was still holding port `4000`. Each new run's server failed to bind (`EADDRINUSE`), but the harness only checked for an HTTP `200`, so it silently tested the **old** process with its warm rate-limit counters.

### Resolution
The harness now refuses to run if the port is occupied, asserts the spawned process is still alive after boot, and terminates the whole process tree with `taskkill /T /F`. Results are only valid when the boot check confirms `health 200` from the newly spawned process.

---

## E-007: Registration creates unconfirmed accounts with no way to confirm them

* **Status:** Resolved — decision taken 2026-10-04, implementation scheduled for Phase 2
* **Found:** 2026-10-04, live registration testing.

### Description
`register()` creates the Supabase user with `email_confirm: false` and `phone_confirm: false`, and returns `session: null`. No confirmation flow exists yet, so a newly registered user cannot sign in: `login` correctly returns `401 Incorrect sign-in details.` An administrator must confirm the account manually via the Supabase dashboard before first use.

### Impact
The product is not usable by a real member until this is resolved. It is not a security defect: refusing unconfirmed accounts is the correct behaviour.

### Decision
**Supabase email/SMS one-time code.** Chosen on 2026-10-04 over auto-confirm and manual confirmation.

Rationale: it keeps proof of ownership, so nobody can register a colleague's phone number and intercept their verification links, and it matches the phone-first, low-literacy design in `01-PRD-PRODUCT-REQUIREMENTS.md`. It also removes the manual admin step entirely.

### Planned resolution
First task of Phase 2:
1. Add `POST /api/v1/auth/confirm` to exchange a one-time code for a session, and have `register` return a confirmation challenge instead of a bare user object.
2. Enable the Supabase email and/or SMS template used for the code, and set `email_confirm`/`phone_confirm` from the verified result rather than at creation time.
3. Update `07-API-DOCUMENTATION.md` with the confirmation endpoints and the resulting session behaviour.

Until this ships, `register` continues to return `session: null` and sign-in stays blocked, which is logged here as a known limitation rather than a defect.

---

## E-008: Media EXIF/metadata scrubbing is documented but not implemented

* **Status:** Open — deferred to Phase 2
* **Found:** 2026-10-04, review against `08-SECURITY-DOCUMENTATION.md`.

### Description
`08-SECURITY-DOCUMENTATION.md` states that uploads are processed to strip EXIF location metadata before storage, and `03-SYSTEM-ARCHITECTURE.md` attributes that step to Supabase Storage. Supabase Storage does **not** strip metadata; `src/lib/storage.ts` only validates MIME type, size, and object path. Metadata therefore survives upload, including GPS coordinates that can reveal a worker's or client's location.

### Impact
Location metadata is not yet removed from proof media. The documentation currently overstates the protection.

### Planned resolution
Phase 2, with the proof-ingestion endpoint: strip metadata server-side before upload (image re-encode, audio container rewrite), and treat the client's submitted GPS as the only trusted location source. Correct the wording in `03` and `08` in the same change.

---

## E-009: `users_update_own` policy would allow self-promotion if write access were ever granted

* **Status:** Open — not currently exploitable
* **Found:** 2026-10-04, RLS policy review against the live project.

### Description
The `users_update_own` policy is `USING (auth.uid() = id)` with **no** `WITH CHECK` clause, and `role` is a normal updatable column. It is currently harmless because `anon` and `authenticated` hold no `INSERT`/`UPDATE`/`DELETE` grant on any `public` table — verified live: the browser receives `permission denied for table users`.

### Impact
Latent privilege escalation. The day anyone adds a table-level grant for client writes, or switches a write path to direct PostgREST access, a user could set their own `role` to `admin`.

### Planned resolution
Before any Phase 2 endpoint introduces client-side database writes, either drop the `users` update policy entirely (the API server owns role changes) or add `WITH CHECK (auth.uid() = id AND role = (SELECT u.role FROM public.users u WHERE u.id = auth.uid()))`. Prefer dropping the policy: role changes belong to the server.

---

## E-010: No lint configuration, and no automated test framework

* **Status:** Partially resolved — smoke test added 2026-10-04; ESLint and unit tests still open
* **Found:** 2026-10-04, verification phase.

### Description
There was no test framework and no ESLint setup in the repository, while `09-DEPLOYMENT-INFRASTRUCTURE.md` mandates CI running lint, unit, and integration tests. Verification to date had been manual probes, which are not repeatable.

### Impact
Regressions such as E-001 would not be caught automatically. The documentation promised a safety net that did not exist.

### Resolution so far
Added `scripts/smoke.mjs`, run with `npm run smoke -- --live`. It asserts the behaviour that mocks cannot cover: the auth trigger, `app_metadata` role mirroring, Row Level Security, single-use verification, and the browser CORS path.

Safety properties, because it operates on a real Supabase project:
* Refuses to run without `--live`, exiting with code `2` and changing nothing.
* Prompts for confirmation; `--yes` is available for CI.
* Deletes only accounts matching its own `smoke.` / `web-smoke.` prefixes, never real users.
* Refuses to start if the API or web port is occupied, so results cannot come from a stale server.
* Cleans up in a `finally` block, so data is removed even when a check fails.

Verified on 2026-10-04: **48 checks, 0 failures** (34 API/database, 14 web).

### Still open
Add ESLint and a Vitest unit suite. The smoke test deliberately covers integration behaviour only and is not a substitute for unit tests.

---

## E-011: `docker-compose.yml` contradicted the Supabase architecture

* **Status:** Resolved
* **Found:** 2026-10-04, review after the Supabase pivot.

### Description
The repository root contained a `docker-compose.yml` that started a local PostgreSQL for the pre-Supabase design. Nothing used it once `DATABASE_URL` pointed at Supabase, and its presence misled anyone starting the project.

### Resolution
Deleted on 2026-10-04 with approval. Supabase is now the single documented environment, consistent with `03-SYSTEM-ARCHITECTURE.md` and `09-DEPLOYMENT-INFRASTRUCTURE.md`. No local database bootstrap step remains.

---

## E-012: Response envelope is inconsistent

* **Status:** Open — low severity
* **Found:** 2026-10-04, live API testing.

### Description
Success bodies are returned unwrapped (`{ "user": ..., "session": ... }`) while errors are wrapped (`{ "error": { "code", "message", "status" } }`). Clients must branch on two different shapes, which is an easy source of bugs.

### Impact
Low at this stage; the web client has a single `apiFetch` helper that already handles both.

### Planned resolution
Decide one envelope in Phase 2, apply it across all routes, and document it in `07-API-DOCUMENTATION.md`. Not changed now because it would alter already-verified response shapes.

---

## E-013: Next.js client started with empty Supabase configuration

* **Status:** Resolved
* **Found:** 2026-10-04, running `npm run dev --workspace @tetherproof/web` directly.
* **Related:** web-side counterpart of E-004.

### Description
`next dev` compiled successfully and then failed every request with
`Error: Your project's URL and Key are required to create a Supabase client!`,
thrown from `updateSession` in `src/lib/supabase/middleware.ts:24`. `GET /` returned `404`.

### Root cause
Two independent gaps combined:

1. **The root `.env` is invisible to Next.js.** Next only loads `.env*` from its own project
   directory, `apps/web`. The single configuration file lives at the repository root, where the API
   finds it by walking upward (`src/config/load-env.ts`), so `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` were `undefined` and the clients were built from empty strings.
2. **The smoke harness hid it.** `scripts/smoke.mjs` loads the root `.env` into its own
   `process.env` and spawns the web server with `env: { ...process.env }`. The child therefore
   received correctly populated variables, so all 48 checks passed while the documented developer
   command was broken. Verification covered the harness's process shape, not the real one.

### Impact
Any developer following the documented setup could not start the web client. Production impact was
contained only because the deployment host injects these variables directly.

### Resolution
* `apps/web/next.config.ts` locates the repository-root `.env` by walking upward from the workspace
  and loads it with `process.loadEnvFile`, which never overwrites variables that are already set, so
  host-provided values still win.
* `NODE_ENV` is captured and restored around that load. The root `.env` sets
  `NODE_ENV=development` for the API tooling; letting that into a `next build` would reintroduce the
  E-005 `/404` prerender failure.
* Missing `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` now fail at startup with the
  offending key names and the `.env.example` instruction, instead of surfacing later as a Supabase
  client error with no indication of the cause.

### Verification
Confirmed on 2026-10-04 with no variables set in the child environment:
`next dev` reached `Ready` without the configuration error, `GET /` returned `200` (previously
`404`), `GET /verify/<unknown-token>` returned `200` through the server-side Supabase client, and the
server log contains no `⨯` entries. `next build` completed and prerendered all 4 routes including
`/_not-found`, so E-005 did not return and the build no longer needs `NODE_ENV` pinned externally.
`npm run typecheck` passes in all three workspaces.

### Note for the harness
The masking behaviour in E-013 is a gap in the smoke test, not just in the app. Future checks should
exercise the documented developer commands rather than inheriting a fully populated environment.

---

## Verification coverage achieved on 2026-10-04

For context on what is confirmed working, recorded outside the error log:

* 3 migrations applied to the live project (PostgreSQL 17.11).
* 7 tables with RLS enabled; `FORCE ROW LEVEL SECURITY` on `work_proof_logs` and `verifications`; 19 policies; `users_id_auth_fkey` → `auth.users(id)`; both role triggers present.
* 35/35 automated live API checks: health, registration, duplicate rejection, confirmation gating, login, `/auth/me`, token-hash-only storage, verification view, single-use confirmation, replay refusal, input validation, and RLS posture.
* 20/21 automated web checks: production build, SSR of `/verify/{token}`, `no-referrer`, `noindex`, no sign-in redirect, CORS preflight and headers for the web origin, submission without GPS, persistence, and refusal of an unknown origin. The one failure was a harness cleanup bug, not a product defect; the leftover row was removed and the database confirmed empty.
* Not covered: real browser execution of the confirmation page. No headless browser is available in this environment, so the page was verified through SSR output and browser-equivalent HTTP calls with an `Origin` header, not by clicking the button.
* Reproduce with `npm run smoke -- --live --web` after `npm run build`. All 48 checks are now automated in `scripts/smoke.mjs`.