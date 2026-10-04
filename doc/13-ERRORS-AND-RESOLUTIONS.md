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

* **Status:** Resolved — implemented 2026-10-04 (Phase 2)
* **Found:** 2026-10-04, live registration testing.

### Description
`register()` creates the Supabase user with `email_confirm: false` and `phone_confirm: false`, and returns `session: null`. No confirmation flow exists yet, so a newly registered user cannot sign in: `login` correctly returns `401 Incorrect sign-in details.` An administrator must confirm the account manually via the Supabase dashboard before first use.

### Impact
The product is not usable by a real member until this is resolved. It is not a security defect: refusing unconfirmed accounts is the correct behaviour.

### Decision
**Supabase email/SMS one-time code.** Chosen on 2026-10-04 over auto-confirm and manual confirmation.

Rationale: it keeps proof of ownership, so nobody can register a colleague's phone number and intercept their verification links, and it matches the phone-first, low-literacy design in `01-PRD-PRODUCT-REQUIREMENTS.md`. It also removes the manual admin step entirely.

### Planned resolution
Implemented as described below. No administrator step is required to admit a new member.

### Resolution
* `POST /api/v1/auth/confirm/request` sends or re-sends a one-time code.
  `shouldCreateUser: false` is the load-bearing option: Supabase neither creates an
  account nor spends provider quota on an unknown destination.
* `POST /api/v1/auth/confirm` exchanges the code for a session and confirms the account,
  removing the manual dashboard step.
* `register` now returns a `confirmation` challenge (`channel`, masked `destination`,
  `delivered`) instead of a bare `session: null`.
* Only the channel the caller actually proved is marked confirmed. Writing `false` for the
  other channel would revoke a confirmation already earned, and setting both would let
  someone who signed up by email skip proving ownership of a registered phone number.
* Codes are never stored or logged by this API. Delivery and verification are delegated to
  Supabase Auth, which owns them.

### Anti-enumeration and abuse controls
* `/confirm/request` answers `202` with an identical body whether or not the account exists,
  and `delivered` is also `false` when the provider is merely unhealthy, so the endpoint
  cannot be used to enumerate registered phone numbers or addresses. The provider's real
  error is logged server-side only.
* A wrong, expired, or replayed code all return one generic `AUTH_CODE_INVALID` message,
  because Supabase reports them identically.
* Two dedicated limits, split by cost. `confirmationRateLimiter` allows 5 sends per 15
  minutes per IP, tighter than the general credential limit, because each accepted request
  can cost an SMS or email and could otherwise be used to message arbitrary numbers.
  `codeVerificationRateLimiter` allows 10 redemptions per 15 minutes, loose enough that a
  mistyped 6-digit code does not lock someone out for a quarter of an hour.
* Known limitation: a registered destination answers marginally slower because the provider
  is genuinely contacted. Closing that timing gap would require the API to issue codes itself.

### Verification
Confirmed 2026-10-04 against the live project with a test server on port 4100:
`/confirm/request` returns `202` with a masked destination and `delivered: false` for an
unregistered address, and the server log records `Signups not allowed for otp` without
leaking it to the caller and without sending anything. A wrong code returns
`400 AUTH_CODE_INVALID` on both the email and phone channels; a short token and a malformed
email return `400 VALIDATION_ERROR` with the failing field; the sixth request in the window
returns `429 RATE_LIMITED` in the standard error envelope. `npm run typecheck` and
`npm run build` pass in all three workspaces.

The success path was then verified end to end, which surfaced a real defect in the first
implementation, recorded as **E-016**. `admin.generateLink` mints a genuine token without
delivering anything, so the code-to-session exchange can be asserted without a mail provider
or an inbox. A valid token now returns `200` with a session, the confirmed account signs in
with its password, and replaying the token is refused. This is a permanent smoke check, so
the exchange cannot silently regress again. Full suite: **50 passed, 0 failed**.

### Remaining prerequisite
Delivery requires an email or SMS provider configured in the Supabase Auth dashboard.
Until one is configured, `delivered` is always `false` and no code is ever received. This
is dashboard configuration, not a code change. The numeric 6-digit OTP branch is the one
path still unproven, for the same reason; see the "Not covered" note under E-016.

---

---

## E-008: Media EXIF/metadata scrubbing is documented but not implemented

* **Status:** Resolved 2026-10-04
* **Found:** 2026-10-04, review against `08-SECURITY-DOCUMENTATION.md`.

### Description
`08-SECURITY-DOCUMENTATION.md` states that uploads are processed to strip EXIF location metadata before storage, and `03-SYSTEM-ARCHITECTURE.md` attributes that step to Supabase Storage. Supabase Storage does **not** strip metadata; `src/lib/storage.ts` only validates MIME type, size, and object path. Metadata therefore survived upload, including GPS coordinates that can reveal a worker's or client's location.

Investigating this found the gap was wider than the entry assumed. `POST /api/v1/workers/proofs`, specified in `07-API-DOCUMENTATION.md`, was never implemented at all: `uploadWorkProofMedia` was dead code, there was no multipart parser, no media library, and the live project had no storage bucket. The smoke suite inserted proof rows with raw SQL, so no upload path existed to test. Implementing the scrubbing therefore meant building the ingestion endpoint with the scrubbing as its core, not adding a filter to something existing.

### Impact
Location metadata is now removed from proof media, and the documentation no longer claims more than the code does. Two promises were removed rather than implemented: synthetic-media detection (a Phase 3 item, recorded below) and Supabase Storage performing the scrubbing.

### Resolution
`apps/api/src/lib/media-scrub.ts` removes metadata in memory before any byte is uploaded, and `uploadWorkProofMedia` calls it internally rather than exposing it as a step a caller could skip. The only route to the bucket runs through it, which is what makes the guarantee in `doc/08` a property of the system rather than of one code path.

* **Images are re-encoded** with sharp, which drops EXIF, ICC, and embedded GPS by construction rather than by trying to enumerate every tag that might carry a location. This is why re-encoding was chosen over surgical segment removal: a re-encode cannot miss a tag format nobody thought of. EXIF orientation is applied and then discarded, so photos stay upright without retaining the value describing the device's orientation.
* **Audio tag containers are cut out:** ID3v2 and ID3v1 from MP3, and the `udta`/`meta` atoms, including the `©xyz` location atom, from MP4-family containers.
* **The declared content type is never trusted.** It selects the scrubber, and each scrubber confirms the bytes really are the container that type claims. A file cannot be smuggled past the allow-list by mislabelling itself.
* **`submissionGps` is the only trusted location** for a proof, which is exactly why the file's own location data is removed. Coordinates are range-checked at the boundary, so `999,999` is rejected rather than stored to poison later proximity checks.
* **`metadata_status` is always written as `pending`.** Scrubbing removes location data; it does not assess authenticity. Claiming `valid` would assert work that has not been done, so the honest status is recorded until the anti-fraud engine exists.

### Sub-finding: WebM removed from the allow-list
The allow-list previously included `audio/webm`. Its metadata lives in an EBML element that cannot be removed without re-muxing the whole container, which would require an external binary such as ffmpeg. Rather than store WebM audio with its location data intact under a promise of privacy the code could not keep, the format is refused. This narrows accepted formats deliberately; it is a decision, not an oversight.

### Sub-finding: the bucket enforced nothing (E-017, now resolved)
The bucket was created private, which is what matters for confidentiality. Supabase accepted `file_size_limit` and `allowed_mime_types` without complaint but silently applied neither: reading the bucket back showed both unset, and a direct `text/plain` upload and an oversized upload were both stored. The limits have since been applied and confirmed enforced; see E-017 for how. The API's own checks remain the first line regardless, because they reject a bad upload before any bytes leave the process.

### Verification
`scripts/scrub-check.ts` runs 24 assertions against constructed fixtures rather than mocks, including a hand-built EXIF block whose GPS IFD is spliced into a real JPEG, so the assertion that location data was present beforehand and absent afterwards is meaningful. The MP4 fixture deliberately places `moov` before `mdat`, the layout where sample offsets must be repointed after bytes are removed; the stored offset is confirmed to move earlier by exactly the number of bytes deleted. Without that fixture a broken implementation would still pass, because a faststart file needs no correction. All 24 pass.

End-to-end against the live project, in the smoke suite: a GPS-tagged JPEG is uploaded, `hadGps` is `true`, and the object is read back out of the bucket to confirm no `Exif\0\0` segment survives in the stored bytes. Full suite: **80 passed, 0 failed**, 0 leftover test accounts, 0 leftover bucket objects.

### Not covered
* **Synthetic-media detection is not implemented.** `valid` and `flagged_ai_fake` are never written, and no authenticity assessment happens. Heuristics that cannot genuinely detect AI generation tend to produce false positives that block honest workers' uploads, which is worse than an honest `pending` status. `doc/02` Feature 2.3 and `doc/01` still describe this as a current capability and remain overstated; they are product requirements rather than security documentation, so they were left as written rather than rewritten.
* **Audio was verified structurally, not by playback.** The MP4 assertions prove the container is intact and the offsets are correct, but no decoder was run to confirm audio output. A real m4a from a phone should be tested when one is available.
* **HEIC is re-encoded as AV1-compressed HEIC**, which changes the file substantially to remove only metadata. The prebuilt sharp binary supports it and the round-trip was exercised, but if preserving HEIC exactly matters more than stripping metadata, that tradeoff should be revisited.
* **Verification links are not dispatched.** The token is generated and returned once, but no SMS or WhatsApp provider is wired up, so a real client cannot yet receive it.

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

## E-014: A malformed JSON body is answered with 500 instead of 400

* **Status:** Open — low severity, pre-existing
* **Found:** 2026-10-04, while probing the new confirmation endpoints.

### Description
A request whose body is not valid JSON is answered with
`500 {"error":{"code":"INTERNAL_ERROR",...}}` and logged as `Unhandled error` with a
body-parser stack trace. For example, a body of `{'email':'a@b.com'}` (single quotes).

### Root cause
`express.json()` runs as application-level middleware, ahead of `validateBody`, so its
`SyntaxError` never reaches the Zod schemas. The error handler treats anything that is not
an `AppError` as an unexpected fault, which is the correct default, but a client-caused
parse failure is not an unexpected fault.

### Impact
Low. No internal detail reaches the client, since the generic message is returned. The
response is misleading though: a caller sending a malformed body is told the server broke,
rather than that their request was invalid. It also pollutes the error log with
body-parser stack traces, which can bury a genuine fault during triage.

### Planned resolution
Catch the parse failure at the JSON middleware boundary and translate it into
`AppError.badRequest('Request body must be valid JSON.')`, so malformed input reports as a
client error and stops polluting the error log. Add a smoke check for it.

---

## E-015: `doc/logo-data.txt` and `doc/others/` are untracked working files

* **Status:** Open — needs a decision
* **Found:** 2026-10-04, during the Phase 1 commit.

### Description
`doc/logo-data.txt`, a note about brand asset formats, appeared in the working tree during
the Phase 1 commit and was deliberately left out of it. `doc/others/` then appeared the same
way. Neither belongs to the Phase 1 codebase, and neither is referenced by anything.

### Impact
None on the application. They are untracked, so they are not in the repository.

### Owner decision, 2026-10-04
The owner has reviewed both and decided:

* **`doc/others/` is to be kept and left permanently untouched.** It is someone's working
  material, not project code. It stays untracked and must not be committed, moved, edited, or
  deleted. Commits must continue to stage files by explicit path so it cannot be swept in.
* **`doc/logo-data.txt` is still undecided.** No decision has been given for it.

### Planned resolution
None for `doc/others/`; the decision above is final, and this entry exists only so the files stop
being raised as an open question on every future pass. `doc/logo-data.txt` still needs an owner
decision: move it out of `doc/`, commit it as design documentation, or delete it.

---

## E-016: Magic-link tokens were rejected by `/auth/confirm`

* **Status:** Resolved
* **Found:** 2026-10-04, while verifying the E-007 success path.
* **Related:** a defect in the E-007 implementation, surfaced by the new success-path check.

### Description
`POST /auth/confirm` answered `400 AUTH_CODE_INVALID` for every genuine token of the
non-numeric form. The numeric 6-digit code path was assumed to work and was never
exercised, but the token a magic-link email actually carries could never be redeemed. A
member using the Magic Link template would have been unable to sign in, with no route
forward except an administrator.

### Root cause
Supabase takes the two credential forms through different parameters, and neither is
interchangeable with the other:

* a short numeric code goes in `token`, alongside the address;
* a magic-link token goes in `token_hash`, and must be sent **without** the address.

Two separate mistakes were made in sequence:

1. The implementation passed the magic-link token as `token`. The provider replied
   `Token has expired or is invalid` for every verification type tried (`signup`, `email`,
   `magiclink`).
2. The first fix passed `{ email, token_hash, type }`. The provider replied
   `Only the token_hash and type should be provided`, because the address must be omitted
   once `token_hash` is used.

The code was written from the documented shape of a numeric OTP and never run against a real
link token. The API documentation compounded this by asserting the longer token was
accepted, which was untrue.

### Impact
Registration itself worked and unconfirmed accounts were correctly refused, so nothing
looked broken from the outside until someone tried to redeem an actual link.

### Resolution
`confirm()` now routes on the shape of the value: a 6-to-10-digit numeric value is sent as
`token` with the address, anything else as `token_hash` with no address. The comments state
why the two forms are not interchangeable.

`codeVerificationRateLimiter` was added at 10 per 15 minutes, separate from the tighter
5-per-15-minute `confirmationRateLimiter` on the send endpoint. Sending costs money and can
target arbitrary third parties, so it stays the tightest limit; redeeming a mistyped code
does not, and a quarter-hour lockout over a typo is the worse outcome. Guessing is still
bounded here and again by Supabase.

### Verification
Isolated by calling `verifyOtp` directly with each parameter shape, which surfaced the exact
provider rejection for each and identified the second mistake. After the fix, against the
live project: `/auth/confirm` returns `200` with an 831-character access token for an
account created either through `admin.createUser` or through `POST /auth/register`; the
confirmed account then signs in with its password (`200`); replaying the same token returns
`400 AUTH_CODE_INVALID`. At the time of that fix the suite stood at **50 passed, 0 failed**; it
now stands at **80 passed, 0 failed** after the E-008 work added the proof-ingestion checks and the E-017 work added the bucket-configuration checks.

### Not covered
The numeric 6-digit OTP path still has not been exercised against a real delivered code,
because that needs a working provider and a real inbox. Its behaviour rests on Supabase's
documented contract for `verifyOtp` with a numeric `token`.

---

## E-018: Signing in silently disabled the service-role client

* **Status:** Resolved 2026-10-04
* **Found:** 2026-10-04, while implementing E-008. Every proof upload returned `500`.
* **Related:** pre-existing defect in the E-007 implementation; invisible until something used the admin client for storage.

### Description
Every `POST /api/v1/workers/proofs` returned
`500 {"code":"INTERNAL_ERROR","message":"The file could not be stored."}`. The underlying provider
error was `new row violates row-level security policy` (`AccessDenied`, `statusCode: 403`) — yet the
same bytes, path shape, bucket, and service-role key all uploaded successfully from a standalone
script, and `service_role` was confirmed to hold `rolbypassrls`, so RLS could not have been the
blocker for that role.

### Root cause
`login()` called `supabaseAdmin.auth.signInWithPassword(...)`. Any method that signs a user in
stores the resulting session **on the client that performed it**, and from then on that client
sends the user's access token instead of the service-role key. Because `supabaseAdmin` is a
module-level singleton, the first successful login of the process permanently downgraded it: it
kept working as an ordinary authenticated client while still looking like an admin client. Storage
rejected the writes because `storage.objects` has RLS enabled and no policies, and the user role
is subject to both.

This was confirmed directly rather than inferred: in one process, an upload succeeded before a
sign-in on `supabaseAdmin` and failed immediately after one, with the same client, bytes, and
bucket. `verifyOtp` and `signInWithOtp` were already on the anon client and were not involved.

### Impact
The immediate symptom was a broken upload path. The underlying hazard is worse than the symptom:
**after any user logged in, every later call to `supabaseAdmin` ran with that user's privileges
instead of the service role.** Any code path reaching the admin client after a login would have
executed with reduced privileges, reading or writing only what that one user could reach. Whether
anything was actually exposed depends on the RLS policies in force at the time, but the guarantee
that the admin client bypasses RLS was not being upheld after the first login. Login is the most
frequently called endpoint in the system, so in practice the admin client was degraded almost
immediately after start-up.

### Resolution
`login()` now signs in on `supabaseAuth`, the anon-key client. Signing in needs no elevated
privilege, so nothing is lost, and it matches the two existing end-user auth calls. The hazard is
documented at the definition of `supabaseAdmin` in `lib/supabase.ts`, naming the methods that must
never be called on it and pointing at `supabaseAuth` instead.

### Verification
Against the live project, through the real HTTP path where the failure occurred: after a
registration and password sign-in through the API, `POST /api/v1/workers/proofs` returns `201` with
`hadGps: true`, and the stored object is read back out of the bucket to confirm no EXIF survives.
Full suite: **80 passed, 0 failed**, 0 leftover accounts, 0 leftover bucket objects.

### Note on diagnosability
This took far longer than it should have, and the reason is worth recording. `uploadWorkProofMedia`
collapsed every storage failure into one generic message, discarding the provider's reason
entirely. The RLS error that pointed straight at the cause was being thrown away at the point of
failure. `logger.error` with the provider's reason, bucket, path, and size now runs before the
generic `AppError` is raised; the caller still receives only the generic message, since a storage
error can quote the bucket name, object key, and internal reason. Making the failure visible in the
log while keeping it out of the response is what turned an unanswerable question into a
three-step diagnosis.

---

## Verification coverage achieved on 2026-10-04

For context on what is confirmed working, recorded outside the error log:

* 3 migrations applied to the live project (PostgreSQL 17.11).
* 7 tables with RLS enabled; `FORCE ROW LEVEL SECURITY` on `work_proof_logs` and `verifications`; 19 policies; `users_id_auth_fkey` → `auth.users(id)`; both role triggers present.
* **80/80 automated live API checks:** health, registration, duplicate rejection, the confirmation challenge, request-code anti-enumeration, code validation, **the full confirmation success path** (a real token exchanged for a session, replay refused, password sign-in afterwards), confirmation gating, login, `/auth/me`, **bucket configuration** (private, size cap and MIME allow-list recorded, and both an out-of-list type and an oversized object refused), **proof submission with live metadata scrubbing** (GPS detected and reported, the stored object read back out of the bucket to confirm no EXIF survives, token-hash-only storage, and refusal of WebM, mislabelled files, missing files, out-of-range coordinates, short descriptions, unauthenticated calls, and another worker's capability reference), verification view, single-use confirmation, replay refusal, input validation, and RLS posture. The confirmation success path uses `admin.generateLink`, so it needs no mail provider and no inbox.
* **24/24 media-scrubbing assertions** in `scripts/scrub-check.ts`, run against constructed fixtures rather than mocks, including a hand-built GPS EXIF block and an MP4 laid out so that sample-offset repointing is genuinely required.
* A private `work-proofs` Storage bucket now exists **with its size cap and MIME allow-list applied and confirmed enforced** (E-017). The management API silently discards both values, so `npm run storage:ensure-bucket` writes them directly to `storage.buckets` and verifies them. Six smoke checks guard this on every run.
* Cleanup leaves nothing behind: 0 test accounts, 0 application rows, 0 bucket objects after a full run.
* 20/21 automated web checks: production build, SSR of `/verify/{token}`, `no-referrer`, `noindex`, no sign-in redirect, CORS preflight and headers for the web origin, submission without GPS, persistence, and refusal of an unknown origin. The one failure was a harness cleanup bug, not a product defect; the leftover row was removed and the database confirmed empty.
* Not covered: real browser execution of the confirmation page, and a genuinely delivered 6-digit OTP. No headless browser is available in this environment, so the page was verified through SSR output and browser-equivalent HTTP calls with an `Origin` header, not by clicking the button. A delivered code needs a working provider and a real inbox.
* Reproduce with `npm run smoke -- --live --web` after `npm run build`. All API checks are automated in `scripts/smoke.mjs`; the scrubbing unit assertions run with `npm run scrub-check`, which needs no server, no database, and no live project.

---

## E-017: The proof bucket silently ignores its size and MIME-type limits

* **Status:** Resolved — 2026-10-04, verified against the live project
* **Found:** 2026-10-04, while implementing E-008.
* **Related:** sub-finding of E-008.

### Description
The `work-proofs` bucket was created private, which is the property that matters for
confidentiality. `createBucket` and a follow-up `updateBucket` were both called with
`file_size_limit` and `allowed_mime_types`, and **both calls reported success**. Reading the
bucket back showed `size_limit` undefined and `allowed_mime_types` null. Uploading directly to
confirm it rather than trusting the responses: a `text/plain` object was **accepted**, and an
object one kilobyte over the configured 10 MB cap was **also accepted**.

### Root cause
Not a plan limitation, and not a missing dashboard step. The columns exist and work:
`storage.buckets.file_size_limit` is a `bigint` and `allowed_mime_types` is a `text[]`, both
nullable, both writable. A direct `UPDATE` of `storage.buckets` persists them and Storage then
enforces them. The fault is in the **management API path**: `createBucket` and `updateBucket`
accept both fields and return success, then discard them without raising an error. Because the
call reports success, any script written against it appears to work.

There are no triggers on `storage.buckets` that could reset the values, so nothing overrides a
direct write.

### Resolution
`apps/api/scripts/ensure-proof-bucket.ts` writes the limits straight to `storage.buckets` instead
of going through the management API, then reads them back and refuses to report success if either
value did not persist. Run it with `npm run storage:ensure-bucket`. It is idempotent, converges
on the configuration rather than assuming the current state, and never marks the bucket public.

### Verification
Against the live project on 2026-10-04, after applying the limits:

| Attempt | Result |
| --- | --- |
| `image/jpeg` within the cap | accepted |
| `text/plain` | refused — `mime type text/plain is not supported` |
| `application/pdf` | refused — `mime type application/pdf is not supported` |
| `audio/webm` | refused — `mime type audio/webm is not supported` |
| `image/jpeg` over the cap | refused — `The object exceeded the maximum allowed size` |
| `image/png` over the cap | refused — `The object exceeded the maximum allowed size` |

All probe objects were removed afterwards. Six smoke checks now assert this on every run, so a
bucket that loses its configuration cannot go unnoticed: privacy, the presence of a size limit,
the MIME allow-list contents, and two refused uploads.

### Note
The bucket is a second layer, not the only one. `ALLOWED_CONTENT_TYPES` in `src/lib/storage.ts`
and the multer size cap in `src/middleware/upload.ts` reject a bad upload before any bytes are
sent, and the API-layer allow-list is deliberately kept in step with `allowed_mime_types` by hand.
If a format is added to one it must be added to the other.