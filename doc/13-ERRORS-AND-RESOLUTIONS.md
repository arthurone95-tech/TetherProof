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
* **Synthetic-media detection is not implemented.** `valid` and `flagged_ai_fake` are never written, and no authenticity assessment happens. Heuristics that cannot genuinely detect AI generation tend to produce false positives that block honest workers' uploads, which is worse than an honest `pending` status.
  * **Superseded in part by E-019.** When this was written, `doc/01` and `doc/02` still described this as a current capability and were left as written rather than rewritten, on the grounds that they are product requirements rather than security documentation. That judgement was reversed once Phase 3 forced the issue: `doc/01` and `doc/02` Feature 2.4 are now corrected to describe provenance signals and to state plainly that AI-generation detection is not implemented. E-019 also explains why the original specification was unbuildable rather than merely unimplemented.
  * The honest answer is unchanged: **there is no AI-generation detection, and no such claim is made.** What Phase 3 added is three consistency booleans derived before the metadata is destroyed.
* **Audio was verified structurally, not by playback.** The MP4 assertions prove the container is intact and the offsets are correct, but no decoder was run to confirm audio output. A real m4a from a phone should be tested when one is available.
* **HEIC is re-encoded as AV1-compressed HEIC**, which changes the file substantially to remove only metadata. The prebuilt sharp binary supports it and the round-trip was exercised, but if preserving HEIC exactly matters more than stripping metadata, that tradeoff should be revisited.
* ~~**Verification links are not dispatched.**~~ **Superseded by Phase 3.** Dispatch is now implemented behind a `MessageProvider` interface with a Twilio adapter and a log adapter, and the dispatch outcome is recorded on the verification row. The link is still not dispatched anywhere real, because no Twilio account exists — the Twilio adapter itself is unexercised. See `doc/09` §4.1.

The assertion counts in the Verification section above were current when E-008 was written and are
preserved as the historical record. The current counts are in *Verification coverage achieved on
2026-10-04* at the end of this document.

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

## E-019: Feature 2.4's "AI-fake detector" requires metadata that Phase 2 destroys

* **Status:** Resolved — 2026-10-04, verified against the live project
* **Found:** 2026-10-04, while implementing Phase 3.
* **Related:** E-008.

### Description
Feature 2.4 specifies an "AI-Fake Image/Video Detector" that "inspects file metadata
(timestamps, camera signatures, and device data) to reject fake or AI-synthesized upload
attempts." Phase 2, at E-008, deliberately strips all of that metadata before the object
reaches storage.

The two requirements cannot both be met as written. A detector cannot read camera
signatures from a file that no longer has any.

### Root cause
Not a coding defect. The specification was written as though scrubbing and detection were
independent features, when one is defined as the destruction of the other's input. Nothing
in the codebase claimed this worked, and `metadata_status` was honestly left at `pending`,
so no user was misled — but `doc/01` and `doc/02` described a capability that cannot exist as
specified.

### Resolution
Signals are derived **while the metadata still exists**, inside the scrubber, and only the
conclusions leave it. Three booleans are persisted on `public.work_proof_logs`:

| Column | True when | Never stored |
| --- | --- | --- |
| `media_has_camera_signature` | the discarded EXIF named a capture device (Make **and** Model, or a lens tag, body serial, or vendor maker note) | the make, model, lens, or serial |
| `media_timestamp_plausible` | the discarded capture time was internally consistent with the submission | the capture time |
| `media_encoder_known` | the container is structurally what its declared type claims | — |

A `NULL` in any of the three means "not applicable or not determinable", which is honest for
audio: an MP3 carries no camera and no capture time, so reporting `false` would assert that
the absence of a camera signature was a finding.

`media-scrub.ts` now reads what it previously discarded, and the values still leave the
process with the metadata. The privacy promise in `doc/08` is unchanged, and two checks
assert that the camera make, model, and timestamp are absent from the stored bytes.

### What this deliberately does not do
It does **not** detect AI-generated media, and nothing claims it does. No metadata check can
reliably distinguish a generated image from a real one. What these checks actually establish
is narrower:

* absence of a camera signature, which capture devices reliably write;
* an internally contradictory capture time (after submission, or before 2005, which is where
  an unset clock and the 1970 epoch both land);
* a container that does not match its declared type, which catches hand-assembled files.

These are consistency checks. They are scored as weak evidence, they can only **lower** a
score and never raise it above neutral, and a clean file earns nothing. That is deliberate:
a heuristic that rewarded plausible-looking files could be gamed, and one that punished
unusual files would block honest workers whose cameras behave differently.

`metadata_status` remains `pending` and `flagged_ai_fake` is still written nowhere. The
detection gap is real and stays documented rather than papered over.

### Verification
`npm run scrub-check` — **51/51**, including a hand-built EXIF block with `DateTimeOriginal`
in the Exif sub-IFD (the tag a parser that only walks IFD0 silently misses), a make-without-model
block, epoch and pre-2005 timestamps, a future timestamp, a legitimate photo from the previous
week, and assertions that the make, model, and timestamp are absent from the output bytes.
27 smoke checks cover the live path. 91 further assertions in `npm run fraud-check` pin the
scoring, including that a clean file scores exactly neutral and that withholding every signal
never blocks a worker.

---

## E-020: The confirm endpoint accepted out-of-range coordinates

* **Status:** Resolved — 2026-10-04, verified against the live project
* **Found:** 2026-10-04, while implementing Phase 3.
* **Related:** made exploitable by E-019's proximity check.

### Description
`POST /api/v1/verifications/{token}` accepted `verifierGps: "999,999"`. The submission
endpoint rejected the same value.

### Root cause
Two endpoints shared a validation rule by copy-paste rather than by reference. The copy on
the submission side had a range check; the copy on the confirmation side checked only the
`latitude,longitude` shape, and `999,999` matches that shape.

This was harmless while the value was stored and never read. Proximity scoring is the first
consumer, and a nonsense coordinate fed into a haversine calculation yields a confident,
wrong distance rather than an error — so the laxer endpoint was a live data-integrity defect
the moment Phase 3 landed.

### Resolution
Both schemas now import `gpsSchema` from `src/lib/geo.ts`, so there is one definition.
`geo.ts` also centralises parsing and haversine distance for the same reason.

### Verification
`npm run fraud-check` — 91/91, asserting `999,999` is rejected, that the rejection message
names the range, that latitude ±90 and longitude ±180 are accepted as boundaries while
`90.1` is refused, and that `parseCoordinate` returns `null` rather than throwing for every
malformed shape. One live smoke check confirms the confirm endpoint refuses it.

---

## E-021: A missing location could be used to defeat the trust engine

* **Status:** Resolved — 2026-10-04, verified against the live project
* **Found:** 2026-10-04, while designing the scoring.

### Description
The engine's inputs are a worker's recorded position, the client's position when they tap,
the endorsement graph, and media provenance. Three of the four are client- or
worker-controlled, and one of them — the client's location — is trivially withheld.

Treating "no location supplied" as either a pass or a failure makes the check a toggle: a
worker who omits `submissionGps` converts a hard proximity signal into an absent one.

### Resolution
`unavailable` is a first-class `proximity_status` value, distinct from `within`, and scores
**exactly 0.5** — the neutral midpoint. The same holds for every other unavailable signal: an
unidentified verifier scores neutral, and an audio file's null provenance signals score
neutral.

The design consequence is deliberate and worth stating plainly: **an adversary who supplies
no data at all is not scored as suspicious.** That costs the engine real detection power on
exactly the inputs an adversary would withhold, and it is the correct trade, because the
alternative hands a motivated party a switch that disables the check.

The other half is that absence may not be free either. A confirmed endorsement with nothing
behind it scores ~0.5, which is above the 0.25 block threshold, so the engine does not
punish — but it also cannot be gamed into a pass, because a *real* on-site confirmation with
a clean history scores ~0.75.

### Verification
`npm run fraud-check` asserts, directly: withholding a location scores exactly 0.5;
withholding scores lower than being present; an all-null signal set is exactly neutral and is
never read as a finding; a null set is never worse than a genuinely bad one; and submitting
every signal as withheld does not get a worker blocked. Two live smoke checks confirm
`proximity_status` is `unavailable` with a null distance and the proof still reaches
`verified`.

---

## E-022: `verifier_phone` stored client phone numbers in plaintext

* **Status:** Resolved — 2026-10-04, verified against the live project
* **Found:** 2026-10-04, while implementing the collusion filter.
* **Related:** contradicts the retention promise in `doc/08`.

### Description
`public.verifications.verifier_phone` held the client's phone number as plaintext, written on
every proof submission that supplied one. It was never read by any code path. It was the only
piece of client PII the product retained, and it contradicted the scrubbing effort in E-008:
location metadata is stripped from a photo, while the same worker's contact number sits in
the database in the clear.

### Root cause
Phase 2 added the column for SMS dispatch, which was never wired up. A dormant column
collecting a value nothing consumes is the worst kind — it looks like a feature and carries
pure risk.

### Resolution
The column is dropped. What replaces it is `verifier_phone_hash`: a salted SHA-256 of the
normalised number, held in memory only long enough to dispatch the message.

The salt comes from `VERIFIER_PHONE_SALT`, required in production. This is not ceremony —
phone numbers have very little entropy, so an unsalted digest is reversible by brute force
over the reachable number space in minutes. A default salt would be a published salt, which is
why the schema has none and a missing value outside production generates a random per-process
salt with a warning.

`normalizePhone` strips separators and reduces a `00` international prefix, because the same
number reaches the server as `+233241234567`, `0234 123 4567`, and `233-241-234567`, and
hashing the raw string would treat those as three different people — quietly disabling the
collusion filter it exists to serve.

### Deliberate non-backfill
Pre-existing rows lose the number rather than having it converted. A correct backfill needs
the operator's salt, which does not belong in a migration, and hashing without it would write
a weak digest into a column named `_hash` — worse than the plaintext it replaces, because it
would look protected. The rows are read as identity-unknown, which scores neutral. The table
held no non-test data.

### Verification
Live, against the running project: five submissions by one verifier produce **one** distinct
hash value; the column list for `verifications` contains exactly one phone-related column and
it is `verifier_phone_hash`; the literal number appears nowhere in a 1149-byte
`row_to_json()` of a verification row; and it appears nowhere in the stored fraud-score
breakdown. `npm run fraud-check` asserts the three formatting variants of one number collapse
to a single hash input while two different numbers stay distinct.

---

## E-023: The `--web` smoke run leaked an account on every invocation

* **Status:** Resolved — 2026-10-04, verified against the live project
* **Found:** 2026-10-04, while extending the smoke suite for Phase 3.
* **Related:** a repeat of the cleanup scoping issue already noted against the web checks.

### Description
Every `npm run smoke -- --live --web` left behind one Auth account and its four application
rows. The API-only path was clean, so the leak was invisible unless the web checks ran.

The symptom was a single warning in the cleanup output:

```
warning: could not delete fb7d82c4-…: Database error deleting user
FAIL  test accounts removed from auth.users  (1 rows)
```

### Root cause
Two defects, and the second is the one that mattered.

**Cleanup deleted application rows for one worker only.** The deletes were scoped to
`worker_id = workerId` — the worker registered in the API section. The `--web` path registers
a *second* account and inserts its own capability block, proof, and verification directly. Those
rows were never deleted.

**The check that should have caught it was scoped identically.** `test rows removed from the
application tables` counted `work_proof_logs where worker_id = workerId`. It was checking the
same narrow slice as the delete, so the rows that leaked were, by construction, invisible to it.
It reported PASS while the database filled up. A leak check that shares its scope with the
operation it is verifying verifies nothing.

The visible failure was downstream of this: `deleteUser` failed because the `public.users` row
still referenced the account, so the harness reported an auth error for what was actually a
data-cleanup gap.

### Resolution

* Cleanup now deletes for **every** account the run created, tracked by id in one list, rather
  than a single `workerId`.
* `test accounts removed from auth.users` now filters on the test address pattern
  (`^(smoke|web-smoke)\.`) instead of counting the whole table. Counting every row in
  `auth.users` fails for the wrong reason the moment the project has a real member, which
  teaches you to ignore the check.
* Three **orphan** checks were added, and they are scoped by *predicate* rather than by a list
  of ids this run happened to track: a row counts as a leak only if its owner no longer exists
  in `auth.users`. A real member's rows always have a live owner, so they are never counted, and
  a fixture inserted through an untracked path is caught regardless. Combined with the
  test-pattern check this is complete — an undeleted account is caught by pattern, and a deleted
  account whose rows survive is caught as an orphan.

The general lesson is recorded deliberately: **a verification scoped the same way as the
operation it verifies is not a verification.**

### Verification
Re-ran `--live --web` against the live project: **128 passed, 0 failed**, cleanup reporting 0
test accounts, 0 application rows, and 0 orphans across `work_proof_logs`, `capability_blocks`,
and `verifications`, and 0 objects in the bucket. The API-only path: **114 passed, 0 failed**.
The leaked account found before the fix was removed and the database confirmed empty.

Note this bug only became reachable in Phase 3. `--web` previously aborted early on a port
conflict, so the web section's fixtures were never created and the leak never ran.

---

## Verification coverage achieved on 2026-10-04

For context on what is confirmed working, recorded outside the error log:

* 4 migrations applied to the live project (PostgreSQL 17.11).
* 7 tables with RLS enabled; `FORCE ROW LEVEL SECURITY` on `work_proof_logs` and `verifications`; 19 policies; `users_id_auth_fkey` → `auth.users(id)`; both role triggers present.
* **114/114 automated live API checks** (`npm run smoke -- --live`), and **128/128** with the client confirmation page and browser CORS path (`--live --web`): health, registration, duplicate rejection, the confirmation challenge, request-code anti-enumeration, code validation, **the full confirmation success path** (a real token exchanged for a session, replay refused, password sign-in afterwards), confirmation gating, login, `/auth/me`, **bucket configuration** (private, size cap and MIME allow-list recorded, and both an out-of-list type and an oversized object refused), **proof submission with live metadata scrubbing** (GPS detected and reported, the stored object read back out of the bucket to confirm no EXIF survives, token-hash-only storage, and refusal of WebM, mislabelled files, missing files, out-of-range coordinates, short descriptions, unauthenticated calls, and another worker's capability reference), verification view, single-use confirmation, replay refusal, input validation, and RLS posture. The confirmation success path uses `admin.generateLink`, so it needs no mail provider and no inbox.
* **Cleanup is verified, not assumed.** Zero test accounts, zero application rows, zero orphans, zero bucket objects — with the orphan checks scoped by *predicate* (a row whose owner no longer exists in `auth.users`) rather than by the list of ids the run tracked, so they catch a fixture inserted through an untracked path. See E-023 for the leak this replaced and why the previous check proved nothing.
* **Web checks: 14 assertions** on the confirmation page — SSR of `/verify/{token}`, `no-referrer`, `noindex`, unknown tokens still rendering the page shell, CORS preflight and headers for the configured web origin, submission without GPS, persistence into the live database, revisiting an answered link, and refusal of an unknown origin. The web server must run on a port the API trusts, since the suite derives it from `CORS_ORIGINS` and deliberately exercises the *configured* origin rather than an invented host; override that variable if the port is busy.
* **31/31 trust-engine checks run live against the real project**, driving the whole loop through the public API rather than writing rows directly. Five endorsements by one verifier are submitted and confirmed to build a genuine graph history; a sixth from another continent is then confirmed and the engine independently arrives at `proximity_status = outside`, 5104 km, the concentration finding, a score of 0.125, and `verification_status = fraud_blocked` — while still telling the client their response was recorded. A client who shares no location is recorded `unavailable` with a null distance and the proof still reaches `verified`; a rejection is never scored and never blocked. Provenance booleans are asserted on the row, and the verifier's number is shown absent from a 1149-byte `row_to_json()` of the stored verification.
* **51/51 media-scrubbing assertions** in `scripts/scrub-check.ts`, run against constructed fixtures rather than mocks, including a hand-built GPS EXIF block, an MP4 laid out so that sample-offset repointing is genuinely required, and a hand-built EXIF block carrying `DateTimeOriginal` in the Exif sub-IFD to exercise the provenance parser.
* **91/91 trust-engine unit assertions** in `scripts/fraud-check.ts`, covering coordinate validation, haversine distance, the three proximity outcomes, collusion weighting including the concentration and mutual-endorsement cases, media sub-scoring, the reject-never-blocks rule, and phone normalisation.
* A private `work-proofs` Storage bucket now exists **with its size cap and MIME allow-list applied and confirmed enforced** (E-017). The management API silently discards both values, so `npm run storage:ensure-bucket` writes them directly to `storage.buckets` and verifies them. Six smoke checks guard this on every run.
* Not covered: real browser execution of the confirmation page, a genuinely delivered 6-digit OTP, and a real outbound SMS. No headless browser is available in this environment, so the page was verified through SSR output and browser-equivalent HTTP calls with an `Origin` header, not by clicking the button. A delivered code needs a working provider and a real inbox. The Twilio adapter is unverified against Twilio's live API — it is exercised only through the provider interface with the log adapter active, because no account exists yet.
* Reproduce with `npm run smoke -- --live --web` after `npm run build`. All API checks are automated in `scripts/smoke.mjs`; the scrubbing and trust-engine unit assertions run with `npm run scrub-check` and `npm run fraud-check`, neither of which needs a server, a database, or a live project.
* **The smoke suite runs `apps/api/dist/index.js`, not the TypeScript source.** A change to `src` is not under test until `npm run build` has been run. This was discovered the hard way: a full run reported 20 failures against code that typechecked cleanly, and every one of them was the compiled output being stale.

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
---

## E-024: Anyone could self-register as an administrator

* **Status:** Resolved — 2026-10-05, verified live against the running project
* **Severity:** Privilege escalation from no credentials to full administrator.
* **Found:** 2026-10-05, while building the employer approval flow.
* **Related:** makes E-009's latent policy weakness reachable in practice.

### Description
`registerSchema` validated `role` against the full `USER_ROLES` list, which includes `admin`.
The endpoint then wrote that role into the server-controlled `app_metadata.role` claim. Because
`authorize('admin')` reads that claim, accepting `admin` at registration meant **any anonymous
caller could mint themselves an administrator account** with one unauthenticated POST.

This was not theoretical. Verified live end to end: an anonymous caller registered as `admin`,
called the approval endpoint to approve a third party's employer account, received `200`, and
that employer was then reported as `sending: {"eligibility":"eligible"}` — a fully escalated
path from no credentials to approving strangers and sending invitations to workers.

It also invalidated the design of the whole approval gate. The gate exists so a human decides
whether a real organisation may contact real people. If the gate's own keyholder can be
self-issued, the gate is not a gate.

### Root cause
The list of valid roles and the list of roles a stranger may claim are different questions, and
the schema only asked the first. `USER_ROLES` is a correct description of what exists in the
system; it was the wrong allow-list for an unauthenticated endpoint.

### Resolution
`SELF_REGISTER_ROLES = ['worker', 'employer', 'training_provider']` in
`packages/shared/src/enums.ts`, used by `registerSchema`. `USER_ROLES` is untouched and still
drives the database enum, so nothing else changes.

Self-registration stays open for employers and training providers, deliberately. Requiring
approval before anyone can look at the product would leave nobody in a position to approve
anyone. What is gated is sending an invitation, not looking.

Administrators are now provisioned by writing the role claim against the auth record, which is
an operation requiring service-role credentials that are never exposed to a browser.

### Verification
`npm run smoke -- --live --web` asserts an anonymous `POST /auth/register` with `role: "admin"`
is refused with `400`, and that no `public.users` row was created for the attempt. The suite
also asserts the three legitimately self-registerable roles still succeed, so the fix cannot be
"closed registration" in disguise.

---

## E-025: `ON DELETE restrict` makes any worker who has logged work impossible to delete

* **Status:** Resolved — 2026-10-05, by E-029. The restriction itself is removed there.
* **Found:** 2026-10-05, while tearing down browser walkthrough fixtures.
* **Related:** `doc/08` data retention; migration `0000_luxuriant_pyro.sql`; resolved by `0005`.

### Description
Two foreign keys from migration 0000 are declared `ON DELETE restrict`:

* `capability_blocks.worker_id → users.id`
* `work_proof_logs.worker_id → users.id`

A restricted foreign key blocks deletion of the referenced parent row. Because `public.users`
itself cascades from `auth.users`, deleting a worker who has ever logged a job aborts the whole
cascade and Supabase returns:

```
AuthRetryableFetchError: Database error deleting user
```

The message names neither the table nor the constraint, and its name claims the error is
*retryable* when it is in fact permanent — four retries failed identically. An account that has
logged work therefore **cannot be deleted at all**, by any route.

This surfaced through ordinary operations rather than an audit. The walkthrough teardown could
remove every fixture account except the one worker who had submitted proofs; and later, a smoke
run interrupted by a DNS failure left an account that the suite's own pre-flight then refused to
clean up, on every subsequent run. In both cases the failure was indistinguishable from a
permissions problem, and the two plausible explanations (a missing grant, a transient error) were
both wrong.

It matters beyond housekeeping. A member who asks for their account to be removed is entitled
to a mechanism that works, and the current answer is a silent generic error. It also blocks
retention workflows: the rows that make deletion impossible are exactly the proof records.

### Root cause
A deliberate choice to restrict deletion on proof history, made when nothing required the
opposite — and never revisited when account deletion became an operation something actually
performs. Restricting is defensible for audit records; it is not defensible as the *only*
outcome, because the combination with the `auth.users` cascade turns "keep the proof history"
into "keep the account forever".

### The three candidate fixes
Fixing it means a migration, which needed authorisation, and the correct fix was not obvious:

* Cascading would delete verified work history, which may be what a data-retention obligation
  actually requires an employer or regulator to keep.
* Cascading with an anonymising trigger would preserve aggregate proof counts while severing the
  link to a person — arguably the correct outcome, and a schema change plus new code.
* Leaving it restricted, and documenting that deletion requires an administrator running an
  explicit retention script, is honest but leaves the generic error in place for the next person.

Guessing at a retention obligation is worse than leaving a known limitation visible, so no
migration was written at the time. The second option was authorised on 2026-10-05 and is
implemented as **E-029**; the reasoning for choosing it is in that entry.

### Impact on the smoke suite's own cleanup
This surfaced a second, more annoying consequence. The smoke suite's pre-flight deletes leftover
test accounts with `deleteUser(...).catch(() => undefined)`. Any worker fixture that has logged
work therefore **cannot be removed by the suite's own self-healing**, and the swallowed error
means the only visible symptom is a `no leftover accounts from an earlier run` check that fails
on every subsequent run while cleaning nothing.

This was hit for real. A `--web` run aborted mid-flight when DNS to the database pooler failed
(`getaddrinfo ENOTFOUND`), leaving one worker and nine stored uploads behind. Every later run
then reported the same two failures. Those failures were **not** a leak in the smoke suite: they
were this restriction refusing to let the suite clean up after a run it could not finish.

The actual PostgreSQL error, read directly rather than through the admin API's opaque wrapper:

```
23503 update or delete on table "users" violates foreign key constraint
      "capability_blocks_worker_id_users_id_fk" on table "capability_blocks"
detail: Key (id)=(…) is still referenced from table "capability_blocks".
```

Supabase reports this as `AuthRetryableFetchError: Database error deleting user`, which names
neither the table nor the constraint and whose class name asserts retryability that does not
exist — four consecutive retries failed identically.

### Diagnostic caution worth recording
Two false conclusions were reached before the real one, and both came from the same mistake:

1. The pre-flight cleanup was assumed to be removing accounts, on the basis that it reported
   `0 rows`. It removes zero because the delete is *refused*, not because there is nothing to
   delete.
2. A PostgREST count query with `head: true` was read as "no referencing rows". It returned
   `null`, and a `count && count > 0` guard treated `null` as zero. The account demonstrably had
   **9** `capability_blocks` rows.

A `null` count is an absence of a measurement, not a measurement of zero. Where a number decides
whether something is safe to delete, it has to come from a query whose empty result and failure
are distinguishable.

### Mitigation applied in the meantime
Only to temporary cleanup scripts, not to product code or to `scripts/smoke.mjs`: they delete
dependent rows in explicit order over `pg`, remove the stored objects, then remove the auth
user, asserting what each step removed, and confirming zero orphans afterwards scoped by
predicate rather than by the ids the run happened to create.

Note that `service_role` has **no DELETE grant** on these tables through PostgREST, so a
service-role client cannot clean up after this failure either. Row removal goes through a direct
database connection, which is how the smoke suite's own cleanup already worked.

### Resolution
Authorised on 2026-10-05: **keep the proof records, strip the link to the person.** Deletion
becomes an anonymisation rather than a refusal, so the retention promise survives and the
member can still be removed.

Superseded by E-029, which records the implementation. What follows is the reasoning, kept
because it explains why the resolution is not "just cascade".

* **Why not cascade.** Cascading would destroy verified work history. The value of the network
  is that the proof is real and independently verified; deleting it to satisfy a deletion
  request destroys the thing being asked about, and would do so for a *different* worker's
  trust score, since an aggregate spans many people.
* **Why not leave it restricted.** It is the current state, and it means a member who asks to
  be removed gets a generic error and stays. That is the worst of the three options because it
  is both unhelpful and, on a retention question, non-compliant.
* **Why anonymisation.** The aggregate — "this skill has N verified proofs, mean trust score S"
  — is what employers consume, and none of it identifies anyone. What identifies the person is
  the foreign key and the free-text description. Severing those two, and keeping the row,
  satisfies a deletion request without falsifying a count.

Making the smoke suite's pre-flight resilient to an interrupted predecessor run — removing
restricted rows in order rather than calling `deleteUser` and swallowing the failure — is a
follow-up that belongs with the migration.

**That follow-up is no longer needed, and the migration resolved it rather than needing it.** With
the foreign keys on `set null`, `deleteUser` succeeds on an account that has logged work, so the
pre-flight's existing call now works. The suite additionally drains `orphaned_proof_media` and
refuses to count anonymised rows as orphans, both of which E-029 introduced.

---

## E-026: Accounts provisioned outside registration had no profile row

* **Status:** Resolved — 2026-10-05, verified live
* **Found:** 2026-10-05, while building `PATCH /auth/profile`.

### Description
`updateProfile` issued an `UPDATE public.profiles SET ... WHERE user_id = ?`. The `profiles`
row is created by a trigger on `auth.users`, which only fires for accounts that pass through
`/auth/register`. Accounts created by a service-role `createUser` — an administrator
provisioning a colleague, or the smoke suite minting an elevated role — never fire it.

For those accounts the update matched zero rows, which the service reported as 404. Reading the
profile 404'd for the same reason. The result was that a perfectly real, authenticated user got
"not found" for both operations on their own profile, and the profile form was unusable for
anyone not created through the public endpoint.

### Root cause
`UPDATE` was chosen on the assumption that the row always exists, which held for the only account
creation path that had been exercised. The assumption was never wrong about the data model —
it was wrong about who creates accounts.

### Resolution
Converted to `insert … onConflictDoUpdate`, keyed on the existing `profiles_user_id_unique`
index. No schema change was needed; the unique constraint that makes the upsert safe was
already there.

A trigger to create `profiles` rows for every auth user was considered and **deliberately not
added**: it is a schema change nobody asked for, and the upsert makes it unnecessary.

### Verification
`npm run smoke -- --live --web` exercises `PATCH /auth/profile` for a worker, an employer, and
an account minted directly through the service role, and confirms each can both read and write
its own profile.

---

## E-027: `profiles.location_city` is a column no code path writes

* **Status:** Open — resolving it needs an authorisation decision, not code
* **Found:** 2026-10-05, while building the employer profile form.

### Description
`profiles.location_city` has no writer anywhere in the codebase. Every read returns `null`, for
every account, permanently. It was carried into the Phase 4 profile form and rendered as the
user's location, which made the UI assert something the database does not contain.

### Why it was not simply filled in
A city name cannot be derived from a latitude and longitude without reverse geocoding, which
means either a third-party lookup — a new dependency, an outbound call, and a privacy
question about sending a user's position to a geocoder — or a bundled gazetteer large enough to
matter. Both are decisions to make deliberately, not defaults to pick.

The alternative was to derive it on read from `location_gps` and present that as a fact. A
geocoder's answer is a guess about administrative boundaries; presenting it as "your city" would
be asserting something the platform does not actually know.

### Resolution so far
The column remains, because dropping it is a breaking contract change and `ProfileResponse`
already exposes it. It is documented in `packages/shared/src/api.ts` as always `null` with the
reason, and it was **removed from every screen** rather than rendered as though it held a
place. Nothing in the product now displays it.

### What remains
Either authorise reverse geocoding, or authorise dropping the column. Leaving it is stable and
honest, but the field is dead weight that the next developer will trip over.

---

## E-028: A profile refresh could not be persisted during a render

* **Status:** Resolved as hardening — the underlying 500 is unexplained and still unreproduced
* **Found:** 2026-10-05, during the employer dashboard browser walkthrough.

### Description
`readAccessToken()` runs on every server render that calls the API — including `/login`, which
calls `currentProfile()`. When the stored access token had expired, it refreshed through
Supabase and then called `writeSession()` to persist the renewed token.

`writeSession()` calls `cookies().set()`, which Next.js only permits inside a Server Action or
Route Handler. During a Server Component render this is outside the contract, and the write is
guaranteed to be rejected.

### The unresolved part
During the walkthrough, `/login` returned `500: Internal Server Error` four times, and the
server logged:

```
[TypeError: Invalid URL] { code: 'ERR_INVALID_URL', input: 'null' }
```

one per failed request, all in the sign-out-then-navigate sequence. **This was not reproduced.**
Roughly sixty subsequent requests were made — with no cookie, with a valid session, and with a
crafted session stamped as expired — and every one returned 200 with no new errors. Both 500
tabs recovered on reload. The built output was inspected to rule out a misconfigured Supabase
client, and both the middleware and `session.ts` have correctly inlined URLs.

So: the cookie-write-during-render is a real contract violation and has been removed. It is
**not** established as the cause of the 500, and the error's `input: 'null'` does not obviously
correspond to anything in this code path. Recording this honestly matters more than closing it
with a guess: an unexplained intermittent 500 in an auth path should not be reported as fixed.

### Resolution
`writeSession()` now returns `false` instead of throwing when the cookie cannot be written, and
`readAccessToken()` ignores the result: the refreshed token is used for the request in hand and
the renewal is persisted by the next action. One extra Supabase refresh per render after an hour
of continuous use is a small cost; failing a render over it would be a large one.

### What would settle it
A stack trace. `next start` logs only the error summary, so the production path cannot produce
one without either a development server or an error-reporting hook. Neither was added, since
adding infrastructure for a defect that has not reproduced in sixty attempts is a poor trade.

---

## E-029: Account deletion had no mechanism that a trigger could complete

* **Status:** Resolved — 2026-10-05, verified live against the running project
* **Found:** 2026-10-05, while implementing the E-025 resolution.
* **Related:** implements E-025; `doc/08` data retention; migration `0005`.

### Description
The E-025 fix has two halves, and only the first is a schema change. The database can detach a
worker's proof records from the worker; it cannot delete the file the worker uploaded.

That file matters more than it looks. The object path is
`<user_id>/<YYYY-MM-DD>/<uuid>.<ext>`, so the **path prefix is the worker's own user id**. Nulling
`media_url` removes the pointer but leaves an object in the bucket that still identifies the person
who has just asked to be removed — to anyone able to list the bucket.

The obvious implementation is a trigger that deletes the object. It cannot work, and this was
established empirically rather than assumed:

```
delete from storage.objects where bucket_id = 'work-proofs' and …
  42501  Direct deletion from storage tables is not allowed. Use the Storage API instead.
         raised by storage.protect_delete()
```

Refused with the row genuinely present, from a direct database connection, as the table owner. It is
a deliberate guard against accidental data loss from orphaned objects, not a permissions gap. The
same probe confirmed the Storage API does remove the object, after which a signed URL for it is
refused. So a `BEFORE DELETE` trigger can scrub every column and still leave the bytes behind, and
nothing in SQL can close that gap.

### What the migration does instead
1. **Scrub what SQL can scrub.** A `BEFORE DELETE` trigger on `public.users` overwrites the
   description, nulls `submission_gps` and `media_url`, nulls `verifications.verifier_gps`, and
   stamps `anonymised_at` on both proof tables. `BEFORE` because a referential action fires as an
   `AFTER` trigger on the parent, so this runs before the new `ON DELETE set null` empties the
   column it has to search on. It fires for rows deleted by the cascade from `auth.users` too, which
   is the path Supabase's `deleteUser` takes — verified, not assumed.
2. **Record what SQL cannot delete.** `public.orphaned_proof_media` receives the bucket and path of
   every object still stored at deletion time, read back from `storage.objects` rather than
   assumed so it stays correct if the bucket is ever renamed. This turns an invisible leak into an
   auditable queue: an untracked object is indistinguishable from one that was never created.
3. **Leave removal to the Storage API**, which the smoke suite exercises end to end and then drains.

### Why `SECURITY DEFINER` and `REVOKE ... FROM PUBLIC`
The deleting role should not need `UPDATE` on the proof tables in order to scrub them, so the
function is `SECURITY DEFINER` with a pinned `search_path`. It is a *trigger* function, which
PostgreSQL will not let you call directly from SQL, so unlike a helper function it cannot be
granted to anything by mistake — which is why no `GRANT` accompanies the revoke.

### `verifier_phone_hash` is deliberately retained
It is a salted hash of a **third party's** number, not the worker's, and it is what lets the
collusion filter still recognise one client approving many proofs. Scrubbing it would make every
verifier look new and silently disable a fraud check. The coordinate beside it is retained by no
such argument and is nulled.

### Consequences for reads, and the two that were easy to get wrong
* `aggregateCandidateMetrics` groups by `worker_id`. Anonymised rows would have grouped into a
  single candidate with a null identity and then failed `candidate_handles`' foreign key. Excluded
  explicitly. No live worker's numbers change: each row is grouped by its own worker, so dropping
  one worker's anonymised rows removes only their own contribution.
* `loadEndorsementHistory` feeds the collusion graph, which keys on worker identity. A null there
  would collapse **every deleted worker into one node**, making a verifier look more diverse than
  they are — the filter would fail open on exactly the rings it exists to catch. Excluded.

The known limit of that second choice: a verifier who built their apparent reach through workers
who have since deleted their accounts now looks narrower than they are. Correcting for it needs
approvals counted per distinct deleted account, which the retention policy deliberately does not
keep. Recorded rather than papered over.

A verification link for an anonymised proof is refused as already spent (`409`). The link was
dispatched while the worker was on the platform; letting a year-old link write a verification
outcome and a fraud score onto a record the worker asked to be released from them would undermine
the retention the change exists to provide. It is reported as spent rather than as an error about
the worker, so a client is not told that an account was deleted.

### A bug this introduced, and the shape of it
Making `worker_id` nullable broke the smoke suite's own orphan check, which read:

```sql
where not exists (select 1 from auth.users u where u.id = t.worker_id)
```

A null `worker_id` satisfies that predicate **by construction**, so every deliberately retained
record would have been counted as a leak — and then, by being ignored, the check would have stopped
meaning anything. The fix is `t.worker_id is not null and not exists (…)`.

This is the third time in this project that an absence has been read as a measurement. E-025 itself
was misdiagnosed twice from a `head: true` count that returned `null` and was guarded as if it were
zero. The general rule, now written down: **where a null decides whether something is safe to
delete or safe to report, the query has to distinguish "no rows" from "the count failed", or it has
to ask a question whose answer cannot be null.**

### Verification
`npm run smoke -- --live --web`, two new sections against the live database.

`ACCOUNT DELETION BY ANONYMISATION` — 22 assertions. It provisions a worker carrying a profile, a
capability block, a verified proof with stored media, and a confirmation, then issues `DELETE
/auth/account` as that member. It asserts the delete succeeds and reports `mediaRemoved: 1,
mediaPending: 0`; the auth user, `public.users` row, and profile are gone; the proof, capability
block, and confirmation are retained with the identifying columns cleared and `anonymised_at`
set; **the skill tag survives and the record still aggregates under it**; the verifier phone hash
survives; the stored object the trigger could not reach is gone from the bucket and its signed URL
is refused; and `orphaned_proof_media` is drained to zero rows. The retained rows are cleaned up
by id afterwards, since they carry a null `worker_id` and the owner-scoped cleanup cannot see
them.

`SELF-SERVICE ACCOUNT DELETION` — 4 assertions on the refusal path: no session is `401`, a forged
token is `401`, and `DELETE /auth/account/someone-elses-id` is `404` because no such route exists
— asserted through a refusal rather than by reading the source.

Suite total: **243 passed, 0 failed**, bucket at **0 objects**. Separately verified in a real
browser: a worker with a logged proof signed in through the form, read `/settings/account`,
confirmed the form holds the button with no nested form and no link inside it, deleted, landed on
`/?deleted=1` with the plain-language confirmation, and was redirected to `/login` when returning
to `/settings/account` — so the session really was gone rather than the page merely having moved.
Post-walkthrough probe: account, `public.users`, and profile all zero rows; proof retained with
`worker_id` null and `anonymised_at` set; block retained with its skill tag; **0 objects stored
under the account**; signed URL refused; 0 queue rows; and the retained proof still counted in
its skill aggregate.

### Known limit
An operator deleting an account through the Supabase dashboard bypasses the endpoint. The trigger
still runs and the row still lands in `orphaned_proof_media`, but nothing removes the object, so
those rows wait to be drained by hand. The endpoint closes the gap only on the path it sits on.
