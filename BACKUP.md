# TetherProof — Recovery and Configuration Guide

**What this file is.** A recovery and configuration reference: how to rebuild this
repository, how to put the database schema back, and how to roll the application back if
the multi-capability migration or deployment goes wrong.

**What this file is not.** It is **not a database backup.** It contains no data and no
secrets. The data export lives in `backups/`, which is gitignored, and is produced by
`scripts/export-database.mjs`.

**What has and has not been tested.** The schema recovery procedure in §7 and the data
restore in §6 have been executed against the live project. The **application rollback** in
§8 has *not* been exercised — no deployment has been made from this branch — so treat it as
a procedure to follow, not a guarantee. This is stated here rather than left for someone to
discover during an incident.

---

## 1. Current state

| | |
|---|---|
| Repository | `C:\PROJECTS\TetherProof` |
| Branch | `feature/multi-role-account-support` |
| Last commit | `f9c38cd` — *"Cover the training provider module, and fix the two checks that could not fail"* |
| `main` | also at `f9c38cd`, so **the branch is based on the current production code** |
| Uncommitted | ~70 entries — the multi-capability implementation, `BACKUP.md`, the export/restore scripts, and documentation |
| Node | `>= 22` (engines field; developed on 24.x) |
| **Database** | **`0012` APPLIED. `0013` deliberately not applied.** See §9 |

### Database position — read this before touching anything

`0012_multi_capability.sql` has been applied to the live project and is journalled
(13 entries). The application running in production is still the **pre-`0012` build**, because
deployment requires a commit and push, which is on hold.

That is the correct intermediate state and it is what the expand/contract split exists for:

* the new tables, enum, RLS and policies exist, so the new code can run;
* `public.users.role` **still exists** and is still maintained by the trigger, so the
  currently deployed application is unaffected.

**`0013_drop_user_role.sql` must not be applied until the new code is deployed.** It removes
the column the deployed application reads on every signed-in page, and applying it early would
return `500` for every signed-in user. See §9.

---

## 2. Architecture

An npm-workspaces monorepo, three packages:

```
packages/shared   TypeScript types and constants shared by both apps. Built first.
apps/api          Express + Drizzle ORM + PostgreSQL (Supabase). Port 4000 in development.
apps/web          Next.js App Router. Server components calling the API over HTTP.
```

**Data flow.** The browser loads a page from `apps/web`; server components call `apps/api`
over HTTP using the signed-in user's access token. The API is the only thing that talks to
PostgreSQL, and it uses the **service role**, which bypasses Row Level Security. RLS is
therefore a second line of defence, not the primary boundary — the primary boundary is the
API's authorisation checks. See `doc/08`.

**Identity** is owned by Supabase Auth. `public.users` is a mirror table with no credential
data in it, created and kept in step by a database trigger.

**Media** is in two Supabase Storage buckets, both private: `work-proofs` and
`profile-avatars`.

**Deployments.** The API is on Railway and the web app on Vercel. Both are deployed by their
own platform's GitHub integration on push. There is deliberately **no deploy job in CI** —
`.github/workflows/ci.yml` verifies and never ships, so a green pipeline cannot deploy
anything by accident.

---

## 3. Environment variables

Copy `.env.example` to `.env` at the repository root. One file: `apps/web/next.config.ts`
walks up and loads the root `.env`, so there is no second file to keep in step.

**No values are recorded in this guide.** Every value is a secret except the four marked
public, and those are visible to anyone who opens the browser anyway.

### Supabase

| Variable | Purpose | Where to get it |
|---|---|---|
| `SUPABASE_URL` | Project API URL | Project settings → API |
| `SUPABASE_ANON_KEY` | **Public.** Browser-safe; access is governed by RLS | Project settings → API |
| `NEXT_PUBLIC_SUPABASE_URL` | Public, same as above | as above |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public, same as above | as above |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only.** Bypasses RLS | Project settings → API. Never expose to a browser, never commit |
| `DATABASE_URL` | PostgreSQL connection string | Project settings → Database → Connection string. Use the **direct** connection for migrations, the session pooler (port 5432) for runtime |
| `DATABASE_POOL_MAX` | Connection pool size | any sane value; `10` locally |
| `DATABASE_SSL` | `true` in production | — |

### Application

| Variable | Purpose | Notes |
|---|---|---|
| `NODE_ENV` | Runtime mode | `production` on both platforms |
| `PRODUCT_NAME` | Display name | — |
| `API_HOST` | API bind address | **Must be `0.0.0.0` in production.** `127.0.0.1` listens successfully and is unreachable from a proxy |
| `API_PORT` | API port | `4000` |
| `CORS_ORIGINS` | Comma-separated allowed web origins | List the real web origin. Production accepts only what is written here |
| `NEXT_PUBLIC_API_BASE_URL` | Public, the address the browser calls | **Must be the public API origin in production**, not localhost |
| `NEXT_PUBLIC_SITE_URL` | Canonical web origin, used by both apps for confirmation links | Blank locally so links follow the port actually served |
| `WEB_BASE_URL` | Public origin used to build verification links | Required for SMS dispatch |
| `LOG_LEVEL` | Log verbosity | `info` |

### Storage

| Variable | Purpose | Notes |
|---|---|---|
| `STORAGE_PROOFS_BUCKET` | Bucket for proof media | must be **private** |
| `STORAGE_MAX_UPLOAD_BYTES` | Proof upload cap | 10 MiB |
| `STORAGE_AVATARS_BUCKET` | Bucket for avatars | must be **private** |
| `STORAGE_MAX_AVATAR_BYTES` | Avatar cap | 5 MiB |

Apply the caps and MIME allow-lists with `npm run storage:ensure-bucket`.

### Messaging, fraud, telemetry

| Variable | Purpose | Notes |
|---|---|---|
| `VERIFIER_PHONE_SALT` | Salt for hashing client phone numbers | **Required in production.** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Blank locally uses a random per-process salt and warns |
| `VERIFICATION_TOKEN_TTL` | Verification link lifetime, seconds | `259200` (72 h) |
| `MESSAGING_PROVIDER` | `twilio` or `log` | `log` is the safe default and sends nothing |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | SMS | only if `twilio` |
| `WHATSAPP_API_KEY`, `WHATSAPP_PROVIDER` | WhatsApp | unused while `MESSAGING_PROVIDER=log` |
| `FRAUD_PROXIMITY_KM` | Distance still treated as one site | `2` |
| `FRAUD_BLOCK_BELOW` | Score at or below which a proof is fraud-blocked | strictly between 0 and 1; keep generous |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub telemetry connector | with `WEB_BASE_URL`, the connector works |
| `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET`, `JIRA_BASE_URL` | Jira | **specified but not built; no effect** |
| `OPENAI_API_KEY` | Voice-note transcription | optional |

---

## 4. Platform configuration

### Railway (API)

`railway.json` at the repository root:

* build: **Dockerfile** (`dockerfilePath: Dockerfile`)
* start: `node apps/api/dist/index.js`
* healthcheck: `GET /api/v1/health`, timeout 300 s
* restart: `ON_FAILURE`, 10 retries

Required service variables: everything in §3 that the API reads. `API_HOST=0.0.0.0` is the
one that silently breaks the service if missed — it will start and report healthy-looking
while being unreachable.

Wiring: connect the GitHub repository, set the root directory, set the variables, and let it
build from the connected branch. **No build/deploy command override needed.**

### Vercel (web)

`apps/web/vercel.json` sets `buildCommand: npm run build`. Set the project root to
`apps/web`. `NEXT_PUBLIC_*` variables must be set in the Vercel project — they are baked in
at build time, so changing one needs a rebuild, not just a restart.

### Supabase

* Both storage buckets **private** and created (see `storage:ensure-bucket`).
* `auth` redirect allow-list should include the web origin.
* No anon or authenticated grant on any `public.*` table: RLS plus the service-role-only
  pattern is the design, and `npm run security-check` asserts part of it.

---

## 5. Migration history and order

Migrations are plain SQL in `apps/api/drizzle/`, ordered by `apps/api/drizzle/meta/_journal.json`.
**They must be applied in journal order and each is expected to build on the last.**

| # | File | What it does |
|---|---|---|
| 0 | `0000_luxuriant_pyro` | initial schema |
| 1 | `0001_rls_and_auth_link` | enables and forces RLS on every table; adds `sync_user_role` |
| 2 | `0002_fix_user_role_enum_cast` | fixes the enum cast in that trigger (E-002) |
| 3 | `0003_phase3_trust_signals` | telemetry and trust signals |
| 4 | `0004_phase4_employer_matching` | employer matching, saved workers |
| 5 | `0005_account_deletion_anonymisation` | account deletion and proof anonymisation |
| 6 | `0006_worker_completion_phase` | worker module completion |
| 7 | `0007_employer_console` | employer console |
| 8 | `0008_flagged_and_review` | flagged proofs and review |
| 9 | `0009_identity_visibility` | public profiles and slugs |
| 10 | `0010_saved_workers` | employer saved workers |
| 11 | `0011_trainer_module` | training providers, students, micro-credentials |
| 12 | `0012_multi_capability` | **APPLIED** 2026-10-17 — expand stage, see §9 |
| 13 | `0013_drop_user_role` | **NOT applied** — held until the new code is deployed |

**The database has 13 migrations journalled** (through `0012`).

Apply with `npm run db:migrate`. Each runs in a transaction, so a failure leaves nothing
half-applied — a fact that was relied on repeatedly while developing `0012`, see §9.

### Applying only part of the journal

`drizzle`'s migrator applies everything it finds, so a contract-stage migration that must wait
for a deploy cannot be held back with the stock runner. To apply up to a named point:

```bash
npm run db:migrate -- --to 0012_multi_capability
```

This builds a temporary folder containing the migrations up to that tag plus a matching
journal, and points the migrator at it. `drizzle` still decides what is pending, still runs
each migration in its own transaction, and still records it in the real journal — only the
set of visible files is narrowed, so nothing downstream differs from a normal run. Running
plain `npm run db:migrate` afterwards applies only what remains.

This was used to apply `0012` without `0013`.

---

## 6. Restoring data

### What exists

`backups/` (gitignored — it contains password hashes and tokens):

| File | Contents |
|---|---|
| `schema-manifest.json` | tables, columns, types, enums, foreign keys, indexes, RLS state, policies, triggers, functions. Diff this after a restore to prove the shape came back |
| `data-public.json` | every row of every `public.*` table, verbatim |
| `restore-public.sql` | those rows as `INSERT … ON CONFLICT DO NOTHING`, dependency-ordered |
| `auth-users.json` | `auth.users` and `auth.identities` |
| `RESTORE-AUTH.md` | why there is no auth SQL file, and what to run instead |
| `MANIFEST.txt` | row counts and SHA-256 prefixes |

Regenerate with `npm run export:database` (`node scripts/export-database.mjs`). It re-reads
every table after writing and prints a per-table `ok`/`FAIL` line; it exits non-zero if any
count disagrees. **Last run: 16 tables, 101 rows, all verified.**

### Restore public data

```bash
psql "$DATABASE_URL" -f backups/restore-public.sql
```

**This was executed against the live project and every statement ran without error, with row
counts unchanged** — which is the proof that matters: because each statement is
`ON CONFLICT DO NOTHING`, a statement with a value of the wrong type would have raised rather
than quietly conflicted. It is therefore also safe to re-run.

The script is dependency-ordered (`users` first) and every reference in this schema points at
`users(id)`, so one level of ordering is sufficient.

### Restore accounts

**Raw SQL does not work, and that is deliberate.** Supabase puts a Postgres **INSERT rule** on
`auth.users` that maps every column to `DEFAULT`, so any explicit value is refused with
`cannot insert a non-DEFAULT value into column "email"`. Accounts cannot be created by
bypassing GoTrue. Use the service-role API:

```bash
node scripts/restore-auth-users.mjs --dry-run   # preview
node scripts/restore-auth-users.mjs             # do it
```

Two limitations, both real:

* **Ids are reassigned.** `createUser` issues a fresh id. Restore `public.*` *after* this and
  rewrite ids by matching on email, or accept equivalent test data with different ids. The
  old id is preserved in `user_metadata.restored_from_id`.
* **Passwords cannot be carried across.** GoTrue accepts only plaintext and hashes it
  itself. The exported bcrypt hashes are useless against the API. The script generates a
  known password and **prints it** — acceptable for test data, unacceptable for real users.

Because `app_metadata` is passed through, the `sync_user_role` trigger grants the same
capabilities the accounts had, provided `0012` has been applied.

---

## 7. Restoring the schema

**Replay the migrations. Do not hand-repair.** The SQL files are the source of truth, and a
hand-built replacement is a snapshot of whatever bugs currently exist.

```bash
rm -rf apps/api/dist packages/shared/dist      # rebuild from clean
npm ci
npm run db:migrate
```

Against an empty database this creates all 17 tables, every enum, every function, every
trigger, and enables **and forces** RLS on every table. Then:

```bash
npm run storage:ensure-bucket
```

**Verified:** applying `0000`–`0013` inside a transaction against the live database, then
rolling it back, succeeded with no error. The individual statements were also executed one
at a time to find the two that had to be fixed (§9).

**Caveat:** `drizzle` will skip any migration already recorded in
`drizzle.__drizzle_migrations`. On a genuinely empty database none are, so all run. On a
partially-migrated database, reconcile that table by hand first.

---

## 8. Rolling back the application deployment

The application is deployed by push. So a rollback is a push.

```bash
git log --oneline -5 origin/main          # find the last good commit
git revert --no-commit <bad-commit>      # or: git revert <bad-commit>
git push origin main                      # triggers Railway + Vercel
```

Or, from the Railway dashboard: the service's **Deployments** list has a redeploy action for
any previous successful build, and Vercel has the same under **Deployments**. That is faster
and safer than a git operation when the bad commit is already on `main`.

**Compatibility rule that matters here:** the application can be rolled back freely
*between* `0012` and `0013`. It cannot be rolled back to a pre-`0012` commit *after* `0013`
has been applied, because such a commit reads `public.users.role`, which `0013` removes — it
would return `500` on every authenticated request. See §9.

---

## 9. The multi-capability migration

Migration `0012` replaces a single `public.users.role` column with a
`public.user_capabilities` table, so one account can be a worker, a student, a training
provider and a business owner at once, and adds `businesses` + `business_memberships` so
employer rights follow an approved organisation.

### Why it is split in two

The deployed application reads `users.role` in five places, one of which — `GET /auth/me` —
the web layout reads on **every signed-in page**. The new application reads
`user_capabilities` on **every authenticated request**. So migration-first breaks the running
application and code-first breaks it in mirror image. **There is no zero-downtime ordering of
two steps.** Hence:

| Step | Action | Downtime | Rollback |
|---|---|---|---|
| 1 | Apply `0012` (expand: adds only, keeps `users.role`) | none — verified by dry run | `DROP` the three tables and the enum |
| 2 | Deploy API + web | none | redeploy previous commit |
| 3 | Run the live suite | none | — |
| 4 | Apply `0013` (drops `users.role`) | none | see below |

**Status: step 1 done and verified. Step 2 not done — deployment needs a commit and push,
which is on hold. Step 4 must not be attempted until step 2 has happened.**

`0012` deliberately also keeps the *old* half of the `sync_user_role` trigger, which mirrors
`users.role`. Without that, replacing the trigger during the expand stage would have left the
column the deployed application reads **silently going stale** — a wrong-answer bug rather
than a visible outage, which is harder to catch.

### Step 1 outcome, measured on the live database

* journal: 13 entries, `0012` recorded
* backfill: 6 `worker`, 2 `employer`, 1 `training_provider`, all `grant_source = 'legacy'`
* **0 accounts with no capability**
* `users.role` present — the deployed application is unaffected
* RLS enabled **and forced** on all three new tables
* trigger still mirroring `users.role`
* existing data untouched: 9 profiles, 25 work-proof logs, 28 verifications, 15 capability
  blocks

### Step 3 outcome, run against the live database with `0012` applied

`531 passed, 0 failed`. Up from `91 passed` before the migration, which is the size of the
capability coverage this change adds.

Coverage includes, all against the real database: registration granting nothing; self-service
activation; `employer` and `trainee` each refused with `403` when self-claimed; enrolment by a
person who is not a worker granting `trainee` **without** granting `worker`; enrolment by a
worker adding `trainee` without removing `worker`; a pure student reading their own
credentials while still being refused a work proof; a business staying pending and granting
nothing until approved; approval granting `employer` and rejection taking it away; an account
unable to add itself to somebody else's business; a multi-capability person keeping their
public portfolio; and `worker` refusing revocation.

The suite leaves the database clean: `0` accounts matching `smoke.%`, `0` orphaned capability
rows, `0` businesses afterwards.

### Dry-run result (executed, then rolled back)

Applying `0012` then `0013` inside `BEGIN … ROLLBACK` against the live database:

* both apply cleanly
* after `0012`: `users.role` still present, trigger still mirrors it, `user_capabilities` has 9 rows — the deployed application is unaffected
* a role-claim change still updates `users.role` (`worker` → `employer`) **and** adds
  `employer` to the capability set without revoking `worker`
* after `0013`: `users.role` gone; capabilities 6 worker / 2 employer / 1 training provider; **0 orphaned**; both `employer_approvals` foreign keys intact
* **backfill: 9 of 9 accounts mapped, 0 missing, 0 mismatched**

### Two real bugs the dry run caught

Neither is visible to TypeScript, and both are parse-time failures that occur **regardless of
whether the statement matches a row** — so they would have failed on a database where they
did nothing. Recorded as `doc/13` E-060 and E-061:

1. Under `SELECT DISTINCT`, a bare `'trainee'` literal resolves to `text`, not the enum:
   `column "capability" is of type user_capability but expression is of type text`.
2. PostgreSQL has **no `min(uuid)`**.

Both are the same class as **E-002**, fixed on 2026-10-08 by migration `0002`.

### Known recovery risks

| Risk | Position |
|---|---|
| **`0013` removes a column the old application reads** | Do not apply `0013` until the new code is deployed, or the signed-in site returns `500`. This is the single most important ordering rule |
| **The dropped column is recoverable without a backup** | `ALTER TABLE public.users ADD COLUMN role public.user_role;` then set it from the most recent `user_capabilities.granted_at`. `0012` copies `granted_at` from `users.created_at`, so a single-capability account restores exactly. **This protects only that column and nothing else** — not accidental writes to or deletion of the other sixteen tables. It is not a substitute for a backup |
| **No verified platform backup** | As of 2026-10-17 it could not be confirmed from inside the database whether managed backups or PITR are enabled on the project, or that any restore has been tested. What *is* established: `archive_mode = on`, a `wal-g` push in `archive_command`, 992 segments archived with 0 failures. That is a healthy PITR **mechanism**, not evidence of a restorable backup. **Verify in the Supabase dashboard before relying on this** |
| **Replaying a `CREATE TYPE` fails if it exists** | Only relevant on partial migrations; use `CREATE TYPE … ` guarded, or drop and replay |
| **Data loss is accepted** | The existing data is test accounts and test records, and the owner accepts they may be lost. `backups/` captures them regardless |
| **Application rollback untested** | No deployment has been made from this branch. §8 is a procedure, not a verified path |

---

## 10. Manual setup steps

In order, for a new machine or a new Supabase project:

1. `npm ci`
2. `cp .env.example .env` and fill it in — see §3. `VERIFIER_PHONE_SALT` is **required in
   production**; generate it rather than copying one.
3. `npm run db:migrate` — creates the schema. See §7.
4. `npm run storage:ensure-bucket` — creates the two private buckets and applies the caps.
5. `npm run build`
6. Start the API: `npm start` (production) or `npm run dev` (both apps).
7. Create the first administrator. **There is no self-service route to it, by design**
   (`doc/13` E-024). Write `{"role":"admin"}` into `app_metadata` on the auth record:
   ```sql
   update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'
    where email = 'you@example.com';
   ```
   The trigger grants capabilities from that claim. `admin` is not itself a capability and
   the trigger ignores it for that purpose — the API reads it from the claim directly.
8. Confirm: `curl https://<api-host>/api/v1/health`

---

## 11. Verifying a recovery worked

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run build
npm run security-check && npm run fraud-check && npm run integrity-check && npm run scrub-check
node scripts/smoke.mjs --live          # creates and deletes real accounts; opt-in
```

The smoke suite is the one that matters after a restore: it exercises registration, sign-in,
proof submission, verification, employer search, account deletion and storage cleanup
against the real database. It refuses to run without `--live` and a typed `y`, because it
creates and deletes real rows.

**It leaves the database clean**, deleting what it creates; check `backups/MANIFEST.txt`
row counts against a fresh `npm run export:database` to prove it.

Compare `backups/schema-manifest.json` before and after a restore — the `tables`,
`columns`, `enums`, `foreignKeys`, `policies` and `triggers` arrays should match exactly.
`indexes` is worth a glance but is not expected to match by name, since indexes are
generated.