# Errors and Resolutions

Living record of defects and unresolved risks found during implementation. Every entry states what went wrong, what it affects, and how it will be closed. An entry is only marked **Resolved** once the fix is verified against the live Supabase project, not merely written.

**Status values:** `Open` (known, not fixed) Ã‚Â· `In Progress` (fix started) Ã‚Â· `Resolved` (fixed and verified) Ã‚Â· `Accepted` (risk consciously kept)

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

* **Status:** Resolved Ã¢â‚¬â€ implemented 2026-10-04 (Phase 2)
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
* **Audio tag containers are cut out:** ID3v2 and ID3v1 from MP3, and the `udta`/`meta` atoms, including the `Ã‚Â©xyz` location atom, from MP4-family containers.
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
* ~~**Verification links are not dispatched.**~~ **Superseded by Phase 3.** Dispatch is now implemented behind a `MessageProvider` interface with a Twilio adapter and a log adapter, and the dispatch outcome is recorded on the verification row. The link is still not dispatched anywhere real, because no Twilio account exists Ã¢â‚¬â€ the Twilio adapter itself is unexercised. See `doc/09` Ã‚Â§4.1.

The assertion counts in the Verification section above were current when E-008 was written and are
preserved as the historical record. The current counts are in *Verification coverage achieved on
2026-10-04* at the end of this document.

---

## E-009: `users_update_own` policy would allow self-promotion if write access were ever granted

* **Status:** Open Ã¢â‚¬â€ not currently exploitable
* **Found:** 2026-10-04, RLS policy review against the live project.

### Description
The `users_update_own` policy is `USING (auth.uid() = id)` with **no** `WITH CHECK` clause, and `role` is a normal updatable column. It is currently harmless because `anon` and `authenticated` hold no `INSERT`/`UPDATE`/`DELETE` grant on any `public` table Ã¢â‚¬â€ verified live: the browser receives `permission denied for table users`.

### Impact
Latent privilege escalation. The day anyone adds a table-level grant for client writes, or switches a write path to direct PostgREST access, a user could set their own `role` to `admin`.

### Planned resolution
Before any Phase 2 endpoint introduces client-side database writes, either drop the `users` update policy entirely (the API server owns role changes) or add `WITH CHECK (auth.uid() = id AND role = (SELECT u.role FROM public.users u WHERE u.id = auth.uid()))`. Prefer dropping the policy: role changes belong to the server.

---

## E-010: No lint configuration, and no automated test framework

* **Status:** Partially resolved Ã¢â‚¬â€ smoke test added 2026-10-04; ESLint and unit tests still open
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

* **Status:** Open Ã¢â‚¬â€ low severity
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
server log contains no `Ã¢Â¨Â¯` entries. `next build` completed and prerendered all 4 routes including
`/_not-found`, so E-005 did not return and the build no longer needs `NODE_ENV` pinned externally.
`npm run typecheck` passes in all three workspaces.

### Note for the harness
The masking behaviour in E-013 is a gap in the smoke test, not just in the app. Future checks should
exercise the documented developer commands rather than inheriting a fully populated environment.

---

## E-014: A malformed JSON body is answered with 500 instead of 400

* **Status:** Open Ã¢â‚¬â€ low severity, pre-existing
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

* **Status:** Open Ã¢â‚¬â€ needs a decision
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
error was `new row violates row-level security policy` (`AccessDenied`, `statusCode: 403`) Ã¢â‚¬â€ yet the
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

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-04, verified against the live project
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
so no user was misled Ã¢â‚¬â€ but `doc/01` and `doc/02` described a capability that cannot exist as
specified.

### Resolution
Signals are derived **while the metadata still exists**, inside the scrubber, and only the
conclusions leave it. Three booleans are persisted on `public.work_proof_logs`:

| Column | True when | Never stored |
| --- | --- | --- |
| `media_has_camera_signature` | the discarded EXIF named a capture device (Make **and** Model, or a lens tag, body serial, or vendor maker note) | the make, model, lens, or serial |
| `media_timestamp_plausible` | the discarded capture time was internally consistent with the submission | the capture time |
| `media_encoder_known` | the container is structurally what its declared type claims | Ã¢â‚¬â€ |

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
`npm run scrub-check` Ã¢â‚¬â€ **51/51**, including a hand-built EXIF block with `DateTimeOriginal`
in the Exif sub-IFD (the tag a parser that only walks IFD0 silently misses), a make-without-model
block, epoch and pre-2005 timestamps, a future timestamp, a legitimate photo from the previous
week, and assertions that the make, model, and timestamp are absent from the output bytes.
27 smoke checks cover the live path. 91 further assertions in `npm run fraud-check` pin the
scoring, including that a clean file scores exactly neutral and that withholding every signal
never blocks a worker.

---

## E-020: The confirm endpoint accepted out-of-range coordinates

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-04, verified against the live project
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
wrong distance rather than an error Ã¢â‚¬â€ so the laxer endpoint was a live data-integrity defect
the moment Phase 3 landed.

### Resolution
Both schemas now import `gpsSchema` from `src/lib/geo.ts`, so there is one definition.
`geo.ts` also centralises parsing and haversine distance for the same reason.

### Verification
`npm run fraud-check` Ã¢â‚¬â€ 91/91, asserting `999,999` is rejected, that the rejection message
names the range, that latitude Ã‚Â±90 and longitude Ã‚Â±180 are accepted as boundaries while
`90.1` is refused, and that `parseCoordinate` returns `null` rather than throwing for every
malformed shape. One live smoke check confirms the confirm endpoint refuses it.

---

## E-021: A missing location could be used to defeat the trust engine

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-04, verified against the live project
* **Found:** 2026-10-04, while designing the scoring.

### Description
The engine's inputs are a worker's recorded position, the client's position when they tap,
the endorsement graph, and media provenance. Three of the four are client- or
worker-controlled, and one of them Ã¢â‚¬â€ the client's location Ã¢â‚¬â€ is trivially withheld.

Treating "no location supplied" as either a pass or a failure makes the check a toggle: a
worker who omits `submissionGps` converts a hard proximity signal into an absent one.

### Resolution
`unavailable` is a first-class `proximity_status` value, distinct from `within`, and scores
**exactly 0.5** Ã¢â‚¬â€ the neutral midpoint. The same holds for every other unavailable signal: an
unidentified verifier scores neutral, and an audio file's null provenance signals score
neutral.

The design consequence is deliberate and worth stating plainly: **an adversary who supplies
no data at all is not scored as suspicious.** That costs the engine real detection power on
exactly the inputs an adversary would withhold, and it is the correct trade, because the
alternative hands a motivated party a switch that disables the check.

The other half is that absence may not be free either. A confirmed endorsement with nothing
behind it scores ~0.5, which is above the 0.25 block threshold, so the engine does not
punish Ã¢â‚¬â€ but it also cannot be gamed into a pass, because a *real* on-site confirmation with
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

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-04, verified against the live project
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
collecting a value nothing consumes is the worst kind Ã¢â‚¬â€ it looks like a feature and carries
pure risk.

### Resolution
The column is dropped. What replaces it is `verifier_phone_hash`: a salted SHA-256 of the
normalised number, held in memory only long enough to dispatch the message.

The salt comes from `VERIFIER_PHONE_SALT`, required in production. This is not ceremony Ã¢â‚¬â€
phone numbers have very little entropy, so an unsalted digest is reversible by brute force
over the reachable number space in minutes. A default salt would be a published salt, which is
why the schema has none and a missing value outside production generates a random per-process
salt with a warning.

`normalizePhone` strips separators and reduces a `00` international prefix, because the same
number reaches the server as `+233241234567`, `0234 123 4567`, and `233-241-234567`, and
hashing the raw string would treat those as three different people Ã¢â‚¬â€ quietly disabling the
collusion filter it exists to serve.

### Deliberate non-backfill
Pre-existing rows lose the number rather than having it converted. A correct backfill needs
the operator's salt, which does not belong in a migration, and hashing without it would write
a weak digest into a column named `_hash` Ã¢â‚¬â€ worse than the plaintext it replaces, because it
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

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-04, verified against the live project
* **Found:** 2026-10-04, while extending the smoke suite for Phase 3.
* **Related:** a repeat of the cleanup scoping issue already noted against the web checks.

### Description
Every `npm run smoke -- --live --web` left behind one Auth account and its four application
rows. The API-only path was clean, so the leak was invisible unless the web checks ran.

The symptom was a single warning in the cleanup output:

```
warning: could not delete fb7d82c4-Ã¢â‚¬Â¦: Database error deleting user
FAIL  test accounts removed from auth.users  (1 rows)
```

### Root cause
Two defects, and the second is the one that mattered.

**Cleanup deleted application rows for one worker only.** The deletes were scoped to
`worker_id = workerId` Ã¢â‚¬â€ the worker registered in the API section. The `--web` path registers
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
  test-pattern check this is complete Ã¢â‚¬â€ an undeleted account is caught by pattern, and a deleted
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
* 7 tables with RLS enabled; `FORCE ROW LEVEL SECURITY` on `work_proof_logs` and `verifications`; 19 policies; `users_id_auth_fkey` Ã¢â€ â€™ `auth.users(id)`; both role triggers present.
* **114/114 automated live API checks** (`npm run smoke -- --live`), and **128/128** with the client confirmation page and browser CORS path (`--live --web`): health, registration, duplicate rejection, the confirmation challenge, request-code anti-enumeration, code validation, **the full confirmation success path** (a real token exchanged for a session, replay refused, password sign-in afterwards), confirmation gating, login, `/auth/me`, **bucket configuration** (private, size cap and MIME allow-list recorded, and both an out-of-list type and an oversized object refused), **proof submission with live metadata scrubbing** (GPS detected and reported, the stored object read back out of the bucket to confirm no EXIF survives, token-hash-only storage, and refusal of WebM, mislabelled files, missing files, out-of-range coordinates, short descriptions, unauthenticated calls, and another worker's capability reference), verification view, single-use confirmation, replay refusal, input validation, and RLS posture. The confirmation success path uses `admin.generateLink`, so it needs no mail provider and no inbox.
* **Cleanup is verified, not assumed.** Zero test accounts, zero application rows, zero orphans, zero bucket objects Ã¢â‚¬â€ with the orphan checks scoped by *predicate* (a row whose owner no longer exists in `auth.users`) rather than by the list of ids the run tracked, so they catch a fixture inserted through an untracked path. See E-023 for the leak this replaced and why the previous check proved nothing.
* **Web checks: 14 assertions** on the confirmation page Ã¢â‚¬â€ SSR of `/verify/{token}`, `no-referrer`, `noindex`, unknown tokens still rendering the page shell, CORS preflight and headers for the configured web origin, submission without GPS, persistence into the live database, revisiting an answered link, and refusal of an unknown origin. The web server must run on a port the API trusts, since the suite derives it from `CORS_ORIGINS` and deliberately exercises the *configured* origin rather than an invented host; override that variable if the port is busy.
* **31/31 trust-engine checks run live against the real project**, driving the whole loop through the public API rather than writing rows directly. Five endorsements by one verifier are submitted and confirmed to build a genuine graph history; a sixth from another continent is then confirmed and the engine independently arrives at `proximity_status = outside`, 5104 km, the concentration finding, a score of 0.125, and `verification_status = fraud_blocked` Ã¢â‚¬â€ while still telling the client their response was recorded. A client who shares no location is recorded `unavailable` with a null distance and the proof still reaches `verified`; a rejection is never scored and never blocked. Provenance booleans are asserted on the row, and the verifier's number is shown absent from a 1149-byte `row_to_json()` of the stored verification.
* **51/51 media-scrubbing assertions** in `scripts/scrub-check.ts`, run against constructed fixtures rather than mocks, including a hand-built GPS EXIF block, an MP4 laid out so that sample-offset repointing is genuinely required, and a hand-built EXIF block carrying `DateTimeOriginal` in the Exif sub-IFD to exercise the provenance parser.
* **91/91 trust-engine unit assertions** in `scripts/fraud-check.ts`, covering coordinate validation, haversine distance, the three proximity outcomes, collusion weighting including the concentration and mutual-endorsement cases, media sub-scoring, the reject-never-blocks rule, and phone normalisation.
* A private `work-proofs` Storage bucket now exists **with its size cap and MIME allow-list applied and confirmed enforced** (E-017). The management API silently discards both values, so `npm run storage:ensure-bucket` writes them directly to `storage.buckets` and verifies them. Six smoke checks guard this on every run.
* Not covered: real browser execution of the confirmation page, a genuinely delivered 6-digit OTP, and a real outbound SMS. No headless browser is available in this environment, so the page was verified through SSR output and browser-equivalent HTTP calls with an `Origin` header, not by clicking the button. A delivered code needs a working provider and a real inbox. The Twilio adapter is unverified against Twilio's live API Ã¢â‚¬â€ it is exercised only through the provider interface with the log adapter active, because no account exists yet.
* Reproduce with `npm run smoke -- --live --web` after `npm run build`. All API checks are automated in `scripts/smoke.mjs`; the scrubbing and trust-engine unit assertions run with `npm run scrub-check` and `npm run fraud-check`, neither of which needs a server, a database, or a live project.
* **The smoke suite runs `apps/api/dist/index.js`, not the TypeScript source.** A change to `src` is not under test until `npm run build` has been run. This was discovered the hard way: a full run reported 20 failures against code that typechecked cleanly, and every one of them was the compiled output being stale.

---

## E-017: The proof bucket silently ignores its size and MIME-type limits

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-04, verified against the live project
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
| `text/plain` | refused Ã¢â‚¬â€ `mime type text/plain is not supported` |
| `application/pdf` | refused Ã¢â‚¬â€ `mime type application/pdf is not supported` |
| `audio/webm` | refused Ã¢â‚¬â€ `mime type audio/webm is not supported` |
| `image/jpeg` over the cap | refused Ã¢â‚¬â€ `The object exceeded the maximum allowed size` |
| `image/png` over the cap | refused Ã¢â‚¬â€ `The object exceeded the maximum allowed size` |

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

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-05, verified live against the running project
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
that employer was then reported as `sending: {"eligibility":"eligible"}` Ã¢â‚¬â€ a fully escalated
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

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-05, by E-029. The restriction itself is removed there.
* **Found:** 2026-10-05, while tearing down browser walkthrough fixtures.
* **Related:** `doc/08` data retention; migration `0000_luxuriant_pyro.sql`; resolved by `0005`.

### Description
Two foreign keys from migration 0000 are declared `ON DELETE restrict`:

* `capability_blocks.worker_id Ã¢â€ â€™ users.id`
* `work_proof_logs.worker_id Ã¢â€ â€™ users.id`

A restricted foreign key blocks deletion of the referenced parent row. Because `public.users`
itself cascades from `auth.users`, deleting a worker who has ever logged a job aborts the whole
cascade and Supabase returns:

```
AuthRetryableFetchError: Database error deleting user
```

The message names neither the table nor the constraint, and its name claims the error is
*retryable* when it is in fact permanent Ã¢â‚¬â€ four retries failed identically. An account that has
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
opposite Ã¢â‚¬â€ and never revisited when account deletion became an operation something actually
performs. Restricting is defensible for audit records; it is not defensible as the *only*
outcome, because the combination with the `auth.users` cascade turns "keep the proof history"
into "keep the account forever".

### The three candidate fixes
Fixing it means a migration, which needed authorisation, and the correct fix was not obvious:

* Cascading would delete verified work history, which may be what a data-retention obligation
  actually requires an employer or regulator to keep.
* Cascading with an anonymising trigger would preserve aggregate proof counts while severing the
  link to a person Ã¢â‚¬â€ arguably the correct outcome, and a schema change plus new code.
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
detail: Key (id)=(Ã¢â‚¬Â¦) is still referenced from table "capability_blocks".
```

Supabase reports this as `AuthRetryableFetchError: Database error deleting user`, which names
neither the table nor the constraint and whose class name asserts retryability that does not
exist Ã¢â‚¬â€ four consecutive retries failed identically.

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
* **Why anonymisation.** The aggregate Ã¢â‚¬â€ "this skill has N verified proofs, mean trust score S"
  Ã¢â‚¬â€ is what employers consume, and none of it identifies anyone. What identifies the person is
  the foreign key and the free-text description. Severing those two, and keeping the row,
  satisfies a deletion request without falsifying a count.

Making the smoke suite's pre-flight resilient to an interrupted predecessor run Ã¢â‚¬â€ removing
restricted rows in order rather than calling `deleteUser` and swallowing the failure Ã¢â‚¬â€ is a
follow-up that belongs with the migration.

**That follow-up is no longer needed, and the migration resolved it rather than needing it.** With
the foreign keys on `set null`, `deleteUser` succeeds on an account that has logged work, so the
pre-flight's existing call now works. The suite additionally drains `orphaned_proof_media` and
refuses to count anonymised rows as orphans, both of which E-029 introduced.

---

## E-026: Accounts provisioned outside registration had no profile row

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-05, verified live
* **Found:** 2026-10-05, while building `PATCH /auth/profile`.

### Description
`updateProfile` issued an `UPDATE public.profiles SET ... WHERE user_id = ?`. The `profiles`
row is created by a trigger on `auth.users`, which only fires for accounts that pass through
`/auth/register`. Accounts created by a service-role `createUser` Ã¢â‚¬â€ an administrator
provisioning a colleague, or the smoke suite minting an elevated role Ã¢â‚¬â€ never fire it.

For those accounts the update matched zero rows, which the service reported as 404. Reading the
profile 404'd for the same reason. The result was that a perfectly real, authenticated user got
"not found" for both operations on their own profile, and the profile form was unusable for
anyone not created through the public endpoint.

### Root cause
`UPDATE` was chosen on the assumption that the row always exists, which held for the only account
creation path that had been exercised. The assumption was never wrong about the data model Ã¢â‚¬â€
it was wrong about who creates accounts.

### Resolution
Converted to `insert Ã¢â‚¬Â¦ onConflictDoUpdate`, keyed on the existing `profiles_user_id_unique`
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

* **Status:** Open Ã¢â‚¬â€ resolving it needs an authorisation decision, not code
* **Found:** 2026-10-05, while building the employer profile form.

### Description
`profiles.location_city` has no writer anywhere in the codebase. Every read returns `null`, for
every account, permanently. It was carried into the Phase 4 profile form and rendered as the
user's location, which made the UI assert something the database does not contain.

### Why it was not simply filled in
A city name cannot be derived from a latitude and longitude without reverse geocoding, which
means either a third-party lookup Ã¢â‚¬â€ a new dependency, an outbound call, and a privacy
question about sending a user's position to a geocoder Ã¢â‚¬â€ or a bundled gazetteer large enough to
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

* **Status:** Resolved as hardening Ã¢â‚¬â€ the underlying 500 is unexplained and still unreproduced
* **Found:** 2026-10-05, during the employer dashboard browser walkthrough.

### Description
`readAccessToken()` runs on every server render that calls the API Ã¢â‚¬â€ including `/login`, which
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
Roughly sixty subsequent requests were made Ã¢â‚¬â€ with no cookie, with a valid session, and with a
crafted session stamped as expired Ã¢â‚¬â€ and every one returned 200 with no new errors. Both 500
tabs recovered on reload. The built output was inspected to rule out a misconfigured Supabase
client, and both the middleware and `session.ts` have correctly inlined URLs.

**Second occurrence, 2026-10-06:** the identical signature appeared once during a proof-form
submission, with `page: /_error`, `statusCode: 500` and `handleAction` in the stack
(`app-page.runtime.dev.js`) Ã¢â‚¬â€ the server-action path rather than the render path. Again
unreproduced: roughly forty further submissions, including every refusal branch and both media
kinds, produced no further 500 and no console errors. The two occurrences sit in different paths
(one a render during sign-out, one a server action during a signed-in submission), so no single
path accounts for both. Also unexplained: `input: 'null'` is a string, so whatever constructed the
URL was given the four characters `null` rather than an empty value.

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

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-05, verified live against the running project
* **Found:** 2026-10-05, while implementing the E-025 resolution.
* **Related:** implements E-025; `doc/08` data retention; migration `0005`.

### Description
The E-025 fix has two halves, and only the first is a schema change. The database can detach a
worker's proof records from the worker; it cannot delete the file the worker uploaded.

That file matters more than it looks. The object path is
`<user_id>/<YYYY-MM-DD>/<uuid>.<ext>`, so the **path prefix is the worker's own user id**. Nulling
`media_url` removes the pointer but leaves an object in the bucket that still identifies the person
who has just asked to be removed Ã¢â‚¬â€ to anyone able to list the bucket.

The obvious implementation is a trigger that deletes the object. It cannot work, and this was
established empirically rather than assumed:

```
delete from storage.objects where bucket_id = 'work-proofs' and Ã¢â‚¬Â¦
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
   is the path Supabase's `deleteUser` takes Ã¢â‚¬â€ verified, not assumed.
2. **Record what SQL cannot delete.** `public.orphaned_proof_media` receives the bucket and path of
   every object still stored at deletion time, read back from `storage.objects` rather than
   assumed so it stays correct if the bucket is ever renamed. This turns an invisible leak into an
   auditable queue: an untracked object is indistinguishable from one that was never created.
3. **Leave removal to the Storage API**, which the smoke suite exercises end to end and then drains.

### Why `SECURITY DEFINER` and `REVOKE ... FROM PUBLIC`
The deleting role should not need `UPDATE` on the proof tables in order to scrub them, so the
function is `SECURITY DEFINER` with a pinned `search_path`. It is a *trigger* function, which
PostgreSQL will not let you call directly from SQL, so unlike a helper function it cannot be
granted to anything by mistake Ã¢â‚¬â€ which is why no `GRANT` accompanies the revoke.

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
  they are Ã¢â‚¬â€ the filter would fail open on exactly the rings it exists to catch. Excluded.

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
record would have been counted as a leak Ã¢â‚¬â€ and then, by being ignored, the check would have stopped
meaning anything. The fix is `t.worker_id is not null and not exists (Ã¢â‚¬Â¦)`.

This is the third time in this project that an absence has been read as a measurement. E-025 itself
was misdiagnosed twice from a `head: true` count that returned `null` and was guarded as if it were
zero. The general rule, now written down: **where a null decides whether something is safe to
delete or safe to report, the query has to distinguish "no rows" from "the count failed", or it has
to ask a question whose answer cannot be null.**

### Verification
`npm run smoke -- --live --web`, two new sections against the live database.

`ACCOUNT DELETION BY ANONYMISATION` Ã¢â‚¬â€ 22 assertions. It provisions a worker carrying a profile, a
capability block, a verified proof with stored media, and a confirmation, then issues `DELETE
/auth/account` as that member. It asserts the delete succeeds and reports `mediaRemoved: 1,
mediaPending: 0`; the auth user, `public.users` row, and profile are gone; the proof, capability
block, and confirmation are retained with the identifying columns cleared and `anonymised_at`
set; **the skill tag survives and the record still aggregates under it**; the verifier phone hash
survives; the stored object the trigger could not reach is gone from the bucket and its signed URL
is refused; and `orphaned_proof_media` is drained to zero rows. The retained rows are cleaned up
by id afterwards, since they carry a null `worker_id` and the owner-scoped cleanup cannot see
them.

`SELF-SERVICE ACCOUNT DELETION` Ã¢â‚¬â€ 4 assertions on the refusal path: no session is `401`, a forged
token is `401`, and `DELETE /auth/account/someone-elses-id` is `404` because no such route exists
Ã¢â‚¬â€ asserted through a refusal rather than by reading the source.

Suite total: **243 passed, 0 failed**, bucket at **0 objects**. Separately verified in a real
browser: a worker with a logged proof signed in through the form, read `/settings/account`,
confirmed the form holds the button with no nested form and no link inside it, deleted, landed on
`/?deleted=1` with the plain-language confirmation, and was redirected to `/login` when returning
to `/settings/account` Ã¢â‚¬â€ so the session really was gone rather than the page merely having moved.
Post-walkthrough probe: account, `public.users`, and profile all zero rows; proof retained with
`worker_id` null and `anonymised_at` set; block retained with its skill tag; **0 objects stored
under the account**; signed URL refused; 0 queue rows; and the retained proof still counted in
its skill aggregate.

### Known limit
An operator deleting an account through the Supabase dashboard bypasses the endpoint. The trigger
still runs and the row still lands in `orphaned_proof_media`, but nothing removes the object, so
those rows wait to be drained by hand. The endpoint closes the gap only on the path it sits on.

---

## E-030: Registration refused passwords with a message that never said why

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-05, verified live against the running project
* **Found:** 2026-10-05, from a report that creating an account in the UI failed with
  `Request body failed validation`.
* **Related:** E-007 (registration and confirmation); `doc/07` Ã‚Â§3.A; `doc/10` creating an account.

### Description
The API was right and the web app threw the answer away.

`registerSchema` enforces a password policy Ã¢â‚¬â€ at least twelve characters, an uppercase letter, a
lowercase letter, a number Ã¢â‚¬â€ and answered a refusal precisely:

```json
{"error":{"code":"VALIDATION_ERROR","message":"Request body failed validation.","status":400,
  "details":[{"path":"password","message":"Password must be at least 12 characters."}]}}
```

Three layers then discarded everything after the second sentence:

1. **`registerAccount` validated nothing about the password.** It checked only that an email and a
   name were present, so the policy was enforced entirely by the network round trip.
2. **`ApiRequestError` accepted only `message`, `status`, and `code`.** `error.details` was parsed
   out of the response and never stored, so the specific reason was gone the moment the response
   became an exception.
3. **The catch returned no `field`,** and the register panel printed any error unconditionally as a
   form-level message, so even a message naming a field would not have been shown beside it.

The result: a person whose password was one character short, or had no digit, or was otherwise
wrong, was told `Request body failed validation.` Ã¢â‚¬â€ a sentence that describes the request rather than
the mistake, and that no reader can act on. Six distinct failures produced one indistinguishable
message.

The shape itself was never wrong. Every payload the registration action sends parses, and the happy
path worked throughout; that is what made this easy to miss, because nothing fails until someone
picks a password the policy dislikes.

### The fix, and why the rules moved
* **One policy, one definition.** `passwordProblems()` now lives in `@tetherproof/shared` and returns
  every reason a password is unacceptable. `registerSchema` reports those reasons through
  `.superRefine`, and `registerAccount` checks the same list before sending anything. Two hand-written
  copies of a rule set drift apart, and they drift in the direction nobody tests Ã¢â‚¬â€ the copy with
  fewer rules Ã¢â‚¬â€ which is exactly how the frontend ended up checking nothing.
* **The field-level details survive the trip.** `ApiRequestError` now carries `issues`, read
  defensively from `details` by `readFieldIssues`, which ignores anything malformed rather than
  throwing while handling a failure.
* **`formErrorFor` maps path to input,** preferring the field-level reason and falling back to the
  request-level message. Paths with no matching input Ã¢â‚¬â€ `phoneNumber` on a form that only asks for an
  email, `role` on a select that can only hold an accepted value Ã¢â‚¬â€ deliberately stay form-level, since
  pointing at a field that did not cause the failure sends the reader to fix the wrong thing.
* **The register panel no longer repeats itself.** Its form-level message is now guarded on
  `!registerState.field`, the way the sign-in panel already was, so a field-level reason appears once.

Checking the password locally as well as in the API is not redundant: `/auth/register` is rate limited
to ten attempts per fifteen minutes and the limiter runs *before* validation, so a refused password
still spent an attempt. Failing locally costs nothing; failing remotely eventually costs the person
the ability to try at all.

`.superRefine` rather than `.refine` because a password failing three rules must report all three Ã¢â‚¬â€
which is what the previous chain of `.min()` and `.regex()` calls did, and what someone fixing their
password needs. The one wording change is the length ceiling, which now reads `Password must be at
most 200 characters.` instead of Zod's default `Password must contain at most 200 character(s).`

### Verification
A probe asserting that `registerSchema`'s password issues equal `passwordProblems` output, case by
case Ã¢â‚¬â€ compliant, too short, no uppercase, no number, no lowercase, several failures at once, over
the maximum Ã¢â‚¬â€ plus every payload shape accepted before the change (worker, employer, training
provider, no `fullName`, an extra unknown key, an omitted `role` defaulting to `worker`, and no
identifier at all). Login is asserted unchanged: it must not impose the policy on a password, because
enforcing password rules at sign-in locks people out rather than helping them. **16 of 16 passed.**

Real-browser walkthrough against the running dev server: opened the registration panel, submitted a
compliant-but-short password, and confirmed the reason now renders **attached to the password input**
(`Password must be at least 12 characters.`) with the form-level alert empty, then resubmitted with a
valid password and reached `Check f***@tetherproof.dev`. The five probe accounts this took were
removed afterwards through `admin.auth.admin.deleteUser`, leaving 0 probe accounts and 0 orphaned
profiles.

`npm run smoke -- --live`: **229 passed, 0 failed**. `scrub-check` and `fraud-check` pass. Typecheck
clean across all workspaces; shared and API builds clean.

### Known limit
React 19 resets an uncontrolled `<form action={Ã¢â‚¬Â¦}>` after the action completes, so a failed
registration still clears the name and email the person typed, and they are retyped along with the
corrected password. That is pre-existing Ã¢â‚¬â€ it happened before this fix too, with the worse message Ã¢â‚¬â€
and fixing it means carrying the submitted values back as `defaultValue`. Not done here, because it
is a separate concern from the validation contract and changes what the user sees after a failure.

**Re-tested 2026-10-05** while redesigning the registration flow, through the same early return
(a mismatched pair refused by `registerAccount`): the name, the email address, and both password
boxes all still held their values after the refusal, on the same dev server. The reset does not
reproduce, so either a dependency change since removed it or the original observation had a
different cause. The note stays because that has not been ruled out everywhere, but nothing needs
to be worked around for it at present.

A second, unrelated observation from the same walkthrough: on the sign-in panel the button that opens
the registration form is labelled **"I already have an account"**, which says the opposite of what it
does, and there is no visible "Create an account" entry point. The register panel's equivalent button
is correct. Reported, not changed.

**Since corrected** as part of the registration-flow rework (2026-10-05). The label was a default
value on the shared `PanelSwitch` component, right for one panel and wrong for the other, so the
default was removed and each panel now states its own: the sign-in panel reads **"I don't have an
account"** and opens registration Ã¢â‚¬â€ which is also the visible entry point that was missing Ã¢â‚¬â€ and the
register panel keeps **"I already have an account"** and opens sign-in.

---

## E-031: The confirmation link went to a port nobody was listening on

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-05, verified live against the running project
* **Found:** 2026-10-05, from a report that clicking the link in a confirmation email failed with a
  connection-refused error.
* **Related:** E-007 (registration and confirmation); `doc/07` Ã‚Â§3.A, Ã‚Â§3.B, Ã‚Â§3.H; `doc/10` confirming
  an account.

### Description
Two things were missing, and either alone would have been enough to break the click.

**There was no `/auth/callback` route.** When Supabase confirms an account it redirects the reader
back to a URL the application supplies. Nothing at `/auth/callback` existed, so even a link pointing
at the right machine had nowhere to land.

**The port was written down in the wrong place.** The redirect came from Supabase's Site URL Ã¢â‚¬â€
`http://localhost:3000` Ã¢â‚¬â€ because nothing asked for anything else. The application was running on
3001, and 3000 on that machine serves a completely different project. The link did not merely land
on the wrong page; it landed on someone else's server, and a reader arriving from a real inbox saw a
refused connection or an unrelated site.

The shape of the response is worth recording, because it decides where the fix has to live. GoTrue
answers the confirmation request with a redirect carrying the session in the **fragment**:

```
303 Ã¢â€ â€™ http://localhost:3001/auth/callback#access_token=Ã¢â‚¬Â¦&refresh_token=Ã¢â‚¬Â¦
```

A fragment is never transmitted to a server. No server-side code, no route handler, no middleware can
read it Ã¢â‚¬â€ so a callback that only exists as a server component would render a page and never see the
credentials. Whatever completes the sign-in has to run in the browser.

The one thing that must not happen is treating that fragment as proof. The credentials are only worth
something because Supabase issued them, so they are sent to the server and **exchanged** Ã¢â‚¬â€ GoTrue's
answer is the session, and a token the client merely asserts is worth nothing.

### The fix, and why the origin is derived rather than written down
* **`/auth/callback` exists** as a page with a client component that reads `window.location.hash`,
  clears the credentials out of the address bar with `history.replaceState` before any network call,
  and hands the refresh token to a server action. A `?code=` query Ã¢â‚¬â€ the PKCE shape, which is what
  this application's own Supabase clients speak Ã¢â‚¬â€ is handled on the same page through
  `exchangeCodeForSession`.
* **The session comes from an exchange, never from the link.** `refreshSession()` sends the refresh
  token to GoTrue and stores only what comes back; the custom `tp_session` cookie is then written.
  The role is read from `GET /auth/me` rather than from the token, because the API is what will
  authorize every page opened next Ã¢â‚¬â€ and if the API will not recognize the account, the cookie is
  cleared rather than left to fail one click later.
* **The redirect origin is supplied by the caller, per request.** The web app sends `redirectOrigin`
  on `/auth/register` and `/auth/confirm/request`, resolved in this order: a configured
  `NEXT_PUBLIC_SITE_URL`, then the request's own `Origin` header (the form of `window.origin`), then
  `x-forwarded-proto`/`x-forwarded-host`, then `Host`. Nothing is hardcoded to a port anywhere in the
  source, so whichever port the server started on is the port in the link.
* **The API refuses an origin it did not agree to.** `redirectOriginSchema` trims, validates, and
  reduces the value to `new URL(v).origin`, then checks it against the allow-list: `NEXT_PUBLIC_SITE_URL`,
  `WEB_BASE_URL`, and `CORS_ORIGINS`, plus loopback and private addresses outside production. A
  non-permitted origin is a **400 with `details` naming `redirectOrigin`** Ã¢â‚¬â€ not a silent fallback.
  Silence is how this bug survived: a redirect quietly substituted for the requested one looks exactly
  like success until somebody clicks it.

The refusal is deliberately loud because a wrong origin is a wrong link, and a wrong link is only
discovered by the person receiving it. Development permits `localhost`, the whole `127.0.0.0/8`, and
the private ranges, so a phone on the same network can still register; production permits only what
the deployment named.

### Verification
A probe asserting the policy against the real `redirectOriginSchema`, in both modes: configured
origins accepted, every path and credential form rejected, malformed values rejected, the port
carried through untouched, and the local-address allowance present in development and absent in
production. **49 of 49 passed in development, 46 of 46 in production.**

Live against the running API on port 4000: a register carrying
`redirectOrigin: https://attacker.example.net` returned **400** with
`details[0].path === "redirectOrigin"` and *"This address is not permitted to receive confirmation
links."* The same call with `http://localhost:3001` returned **201**, as did a register with no
`redirectOrigin` at all.

Real-browser proof that the origin is derived and not written down: registering from
`http://desktop-ch0mrbt:3001` was **refused in the form with that same message**, while registering
from `http://localhost:3001` succeeded. A hardcoded `http://localhost:3000` is an allowed origin, so
a hardcoded value would have been accepted on that host Ã¢â‚¬â€ the refusal is only possible if the web app
read the request's own host and sent it.

Real-browser end-to-end, run against the shipped code: registered through the real form on 3001,
minted the confirmation link with `redirect_to=http://localhost:3001/auth/callback`, and opened it.
The link landed on `/auth/callback` with no connection refused, the credentials were stripped from the
address bar, the exchange succeeded, and the reader was sent to `/invites` and rendered the signed-in
page Ã¢â‚¬â€ *"Signed in as Final Callback Probe."* Ã¢â‚¬â€ with the session surviving a full page load.

`npm run smoke -- --live`: **232 passed, 0 failed**. Typecheck clean across all workspaces; API build
clean.

### Known limit
Reaching the development server by the machine's own name Ã¢â‚¬â€ `http://DESKTOP-CH0MRBT:3001` Ã¢â‚¬â€ is
refused, because a name is not an address and deciding which hostnames count as "this machine" would
mean resolving them inside a validation path. The message says so plainly and the fix is to set
`NEXT_PUBLIC_SITE_URL`, which states the answer explicitly rather than guessing it.

The `?code=` path only completes when the code was produced by this application's own Supabase
client, because PKCE pairs a code with the verifier that requested it. A code minted elsewhere is
refused, which is correct: accepting it would defeat the pairing.

Nothing here reaches an inbox, so the link was minted with `admin.generateLink` Ã¢â‚¬â€ the same technique
used to verify E-016 Ã¢â‚¬â€ rather than by reading the email. What that does not cover is whether a
delivered message renders its link intact; the redirect is Supabase's, not the mail client's.

## E-032: The verification link rendered as `[object Promise]/verify/...`

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-06, verified in a real browser against the running app
* **Found:** 2026-10-06, walking the proof-upload success path for the first time end to end.

### Description
`submitProof` built the link a worker hands to the person confirming their work:

```ts
verificationUrl: `${currentOrigin()}/verify/${result.verificationToken}`
```

`currentOrigin()` is `async` Ã¢â‚¬â€ it awaits `headers()` Ã¢â‚¬â€ so the template string interpolated a
Promise. Every successful submission therefore displayed and copied
`[object Promise]/verify/<token>`: a link that looks complete, passes a casual read, and resolves
to a 404 when tapped. Nothing else in the flow caught it, because the API returns the token
correctly and the panel renders whatever it is given.

The same file already used `await currentOrigin()` in the two registration paths, so the mistake is
a single missed `await` rather than a misunderstanding of the helper.

### Resolution
`const origin = (await currentOrigin()) ?? ''` before the template, with a comment stating why the
`await` is load-bearing. The `?? ''` keeps the shape honest if no origin can be derived: the result
is a site-relative `/verify/<token>`, which still resolves on whatever host served the page, rather
than a stringified promise.

### Verification
Real browser, live submission through the shipped form: the panel now reads
`http://localhost:3001/verify/9syA8FrvIOML3i6lJ45aaGl-Cxhlxj9kWg4bzBSJOwA`. The token is
base64url and untouched. A second submission produced a second distinct link.

## E-033: The location box was hidden while the copy told people to type into it

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-06, verified in a real browser at a mobile viewport
* **Found:** 2026-10-06, auditing the log form at a 579px viewport.

### Description
The proof form's location input was `<input type="hidden" name="submissionGps">` Ã¢â‚¬â€ 0Ãƒâ€”0, absent from
the tab order, absent from the accessibility tree. The only way to set a location was the "Use my
location" button.

Two sentences around it said otherwise:

* the fieldset's own copy Ã¢â‚¬â€ *"this box is the only record of place there is"* Ã¢â‚¬â€ pointed at a box that
  could not be seen or focused;
* both geolocation refusal messages end *"You can type the coordinates instead"* (`use-geolocation.ts`),
  whose docblock in turn asserts *"Every location field in the app is typeable by hand"*.

So a person who declined the sensor, or whose browser has no geolocation, was told to do something
the page offered no means to do. The API accepts a typed coordinate and always did; only the
interface refused to provide one.

A hidden input also meant a stale coordinate had no visible representation: after `Clear`, the value
was gone from the DOM but the user had no surface in which to notice a value still being submitted.

### Resolution
Replaced with a visible, labelled text field inside the same fieldset: `id`/`htmlFor` `submissionGps`,
`inputMode="decimal"`, a hint giving the exact accepted form (`5.6037,-0.1870`), `aria-invalid` and
`aria-describedby` wired to the hint and the error as `Field` does. The sensor still fills it; the
keyboard is now a peer rather than a claim. The duplicate read-only span that echoed the value was
removed, since the input itself now shows it.

`submitProof` gained the matching client-side check Ã¢â‚¬â€ shape first, then `|lat| Ã¢â€°Â¤ 90`, `|lon| Ã¢â€°Â¤ 180` Ã¢â‚¬â€
for the same reason the other checks are duplicated: `/workers/proofs` sits behind a media rate
limiter, and discovering a nonsense coordinate after the file has already uploaded spends one of a
worker's few uploads per minute on a refusal that was knowable beforehand.

### Verification
Real browser at `innerWidth: 579` (below the `md:` breakpoint):

* the field measures 449Ãƒâ€”48, is labelled "Coordinates", and its hint reads *"Latitude, longitude. The
  button fills this in, or type it: 5.6037,-0.1870"*;
* typing `not-a-coordinate` and submitting returns *"Enter coordinates as latitude, longitude Ã¢â‚¬â€ for
  example 5.6037,-0.1870."* with `aria-invalid="true"` and `aria-describedby="submissionGps-error
  submissionGps-hint"` Ã¢â‚¬â€ and **without** spending an upload, since the file attached to that attempt
  was never sent;
* typing `999,999` returns *"Location coordinates are out of range."* with the text and the attached
  file both retained;
* typing `5.6037,-0.1870` with a real JPEG submits successfully and the success panel renders.

The geolocation refusal path was exercised first: declining the sensor produces *"Your location was
not shared. You can type the coordinates instead."*, and the box it refers to is now present.

## E-034: React emptied the log form after every attempt, including a refused one

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-06, verified in a real browser with a DOM probe
* **Found:** 2026-10-06, while re-testing the refusal path of the proof-upload form.

### Description
`useActionState` calls `form.reset()` once its action settles. That is correct for a form whose
submission succeeded and is now gone, and wrong for one that came back with a refusal: the worker
was about to correct one line and try again, and the reset took the rest with it Ã¢â‚¬â€ the description
they had written, the photo or recording they had chosen, and any location already set. Every
rejection cost them the whole submission.

The clean sheet a successful submission *does* need was already available from a different
direction: "Log another job" remounts the form through its `key`, which resets the inputs, the file
picker, and the recording state without relying on the browser's reset at all.

### What was tried first, and why it was reverted
A controlled `value`/`onChange` on each text field, plus restoring the chosen file after the reset.
It worked, but it made three fields controlled purely to defend against a reset this form does not
want, duplicated state the DOM already held, and needed an effect to put the file back. Two
mechanisms for one problem, and the weaker one could drift out of sync with the stronger one.

### The React `onReset` prop does not work for this
Probed directly before committing to a fix. React calls `form.reset()` from within its own work, and
on that path the synthetic event never reaches the component's `onReset` prop. Measured on the live
form:

* `form.reset` wrapped to count calls Ã¢â€ â€™ **`resets: 1`**, so React did call it;
* `onReset={(e) => e.preventDefault()}` on the `<form>` Ã¢â€ â€™ **`preventedAtForm: false`**;
* a `preventDefault` at `document` Ã¢â€ â€™ **`preventedAtDoc: false`**;
* the same prop, when a page script called `form.reset()` directly Ã¢â€ â€™ **prevented**.

So the prop looks like it should stop the reset and does not, which is worse than having no hook at
all: it invites the next reader to trust it.

### Resolution
One mechanism, on the element: a native `reset` listener installed through `formRef` in a
`useEffect`. `reset` is cancelable and the listener is on the target, so it runs before the browser
acts on it. The `onReset` prop was removed rather than left beside it Ã¢â‚¬â€ a second, inert version of
the same intent is a trap.

`Field`'s now-unused `value?: string` prop was reverted out with it, so the component is back to
being uncontrolled by default with `defaultValue` seeding it.

### Verification
DOM probe on the live form, instrumenting `form.reset` and listening for `reset`:

| | |
| --- | --- |
| `resets` | 1 Ã¢â‚¬â€ React called it, exactly as it does in production |
| `prevented` | `true` Ã¢â‚¬â€ the native listener cancelled it |
| skill text after refusal | `Reset Prevention Probe` Ã¢â‚¬â€ retained |
| description after refusal | 75 characters Ã¢â‚¬â€ retained |
| file after refusal | `probe.jpg`, `fileCount: 1` Ã¢â‚¬â€ **retained**, which the reset destroyed most reliably |
| refusal itself | `Location coordinates are out of range.` still rendered as `role="alert"` |

Stable on a second poll after the action had fully settled, so the values survive the re-render and
not merely the first frame. A full submission afterwards still produced the success panel, and
"Log another job" still produced a genuinely clean form (`skill` empty, `description` 0 characters,
`fileCount: 0`, empty location) Ã¢â‚¬â€ the clean sheet comes from the remount, which is the only place
it is wanted.

## E-035: The browser's own origin was missing from the API's CORS list, so the verification page could not load

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-06, verified against the running API with an origin matrix and in a real browser
* **Found:** 2026-10-06, opening a verification link during the Phase 5 security review.
* **Related:** E-031 (confirmation links, the same port drift); `doc/11` Ã‚Â§4; `apps/api/src/app.ts`, `apps/api/src/lib/origin.ts`.

### Description
The page a verifier is sent to is the only screen in the product that calls the API from the
browser. The page is served by the web app, the data comes from the API, and the API answers that
cross-origin read with `Access-Control-Allow-Origin` only for origins named in `CORS_ORIGINS`.

That list is written down once and says `http://localhost:3000`. The web app has not been on 3000
since another project claimed the port: `next dev` moved to 3001 and stayed there. So the preflight
was refused, the `fetch` threw, and the verifier was shown

```
This request could not be opened
We could not load this request. Please try again.
```

with, in the console,

```
Access to fetch at 'http://localhost:4000/api/v1/verifications/Ã¢â‚¬Â¦' from origin
'http://localhost:3001' has been blocked by CORS policy
```

No amount of retrying helps, because nothing about the page can change a header the API decides. The
link itself was valid Ã¢â‚¬â€ the API answered the same token correctly over plain HTTP.

The same drift had already broken confirmation links once (E-031), which is what makes this a
repeated failure rather than a first one: two independent rules in the codebase had to keep agreeing
with a port number nobody wrote down.

### Why adding the port to configuration was not the answer
It would fix today's port and nothing else Ã¢â‚¬â€ a development server takes the next free port the same
way next time Ã¢â‚¬â€ and the value lives in `.env`, which is not the code's to edit. It also only
describes the symptom. What is really being judged is *"is this origin the machine the browser is
running on"*, and the codebase already had a rule for exactly that question, written for
confirmation links: `isLocalAddress` in `redirect.ts`.

### Resolution
The rule became shared, in `apps/api/src/lib/origin.ts`, and `createApp` now decides the CORS origin
with it:

* an origin in `CORS_ORIGINS` Ã¢â€ â€™ allowed, exactly as before;
* outside production, an origin on loopback or a private range Ã¢â€ â€™ allowed, the same "this machine or
  this network" reading `redirectOriginProblem` already uses;
* anything else Ã¢â€ â€™ refused, which withholds the CORS headers entirely rather than blanking one;
* no `Origin` at all Ã¢â‚¬â€ curl, the smoke suite, server-to-server Ã¢â€ â€™ untouched, as before.

Production is unchanged: `env.isProduction` gates the local allowance, so a deployed API still
accepts only what the operator named. Two definitions of "local" would be two chances for them to
disagree, so there is one.

### Verification
Origin matrix against the running API (`GET /api/v1/health`, plus `OPTIONS` preflights):

| Origin | Result |
| --- | --- |
| none | served, no `ACAO` |
| `http://localhost:3001` (where the app runs) | `ACAO: http://localhost:3001` |
| `http://localhost:3000` (the configured entry) | `ACAO: http://localhost:3000` |
| `http://127.0.0.1:3001` | `ACAO: http://127.0.0.1:3001` |
| `https://evil.example.net` | no `ACAO`; preflight answers without CORS headers |
| `null` (what a sandboxed frame sends) | no `ACAO` |

Preflight from the app's origin answers `204` with methods and credentials.

In the browser: the verification page that previously failed now renders the question, the skill and
the description with **zero console errors**, and pressing the button recorded the answer
(*"Thank you Ã¢â‚¬â€ Your confirmation has been recorded."*), after which a reload reported the link
already answered. Full path walked live: a worker submits a proof Ã¢â€ â€™ the link is opened Ã¢â€ â€™ confirmed Ã¢â€ â€™
revisited.

End to end in the suite as well: `npm run smoke -- --live --yes --web` reports **246 passed, 0
failed**, including `preflight allows the web origin (ACAO=http://localhost:3105 status=204)`,
`GET response carries a CORS header`, and `unknown origin is not granted CORS access (ACAO=null)`.

---

## E-036: The API offered a form for a proof that could never be answered

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-06, verified against the running API and in a real browser
* **Found:** 2026-10-06, while completing the verification flow after the E-035 fix.
* **Related:** E-025/E-029 (account deletion); `apps/api/src/modules/verifications/service.ts`; `doc/08` data retention.

### Description
Two endpoints answer for one link, and they disagreed about it.

`POST /verifications/{token}` refuses through `assertUsable`, which refuses a proof whose worker has
deleted their account. The record survives anonymisation so the counts it contributes stay true, but
answering it now would write a verdict, a fraud score and a timestamp onto a row the person asked to
be released from them. The refusal is a `409`: *"This verification link is no longer active."*

`GET /verifications/{token}` did not consult that rule. It answered `200` with
`status: "awaiting_response"`, so the client rendered a working form:

1. the verifier opens a link whose worker has since left the platform;
2. the page shows the question and both buttons, as though the answer would count;
3. the verifier chooses and presses Ã¢â‚¬â€ and is told the link is no longer active;
4. "Try again" re-reads, gets `200`, and returns the identical form, so the loop only ends when the
   tab is closed.

The verifier is invited to do work that is refused every time, on a screen that claims otherwise.
Nothing is written anywhere, so there is no data damage; the damage is to a person being asked a
question the product has already decided cannot be answered.

### Why GET did not simply reuse `assertUsable`
It must not. Two of that function's three refusals are wrong for a read:

* a **spent** link must stay readable Ã¢â‚¬â€ the outcome is what the reader came for, and the suite
  asserts that revisiting shows it;
* an **expired** link can be recognised from `expiresAt`, and refusing it at read time would hide a
  summary the spent case deliberately shows.

Only the deleted-worker case has nothing to report, and it must not say *why*: `assertUsable` is
explicit that *"saying otherwise would tell a third party that an account was deleted"*. So it takes
the spent link's sentence.

### Resolution
`getVerificationSummary` now refuses an anonymised proof with the identical code and wording that
`assertUsable` uses on submission. One rule, decided once, reported the same way whichever endpoint
is asked Ã¢â‚¬â€ and the form is never rendered for it.

### Verification
Against the running API, on the link for a proof whose worker account had been deleted:

| | before | after |
| --- | --- | --- |
| `GET /verifications/{token}` | `200`, `awaiting_response`, form rendered | `409 VERIFICATION_TOKEN_CONSUMED` Ã¢â‚¬â€ *"This verification link is no longer active."* |
| unknown token | `404` | `404` (unchanged) |
| live link | `200` | `200` (unchanged) |
| answered link | `200`, outcome | `200`, outcome (unchanged) |

The browser then walked a fresh proof end to end Ã¢â‚¬â€ question Ã¢â€ â€™ confirm Ã¢â€ â€™ *"Thank you"* Ã¢â€ â€™ reload
reporting *"already answered on 10/6/2026"* Ã¢â‚¬â€ with no console errors, and the suite's
`--web` section (`browser GET returns the summary`, `revisiting the link shows it was answered`)
passes: **246 passed, 0 failed**.

---

## E-037: Running the production build stopped the dev server dead, with 500s on every route

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-06, by restarting the dev server; the trap is documented rather than patched, because it is Next's build layout rather than this project's code
* **Found:** 2026-10-06, when `/login` and `/dashboard` both answered `500 Internal Server Error` while the API stayed healthy.
* **Related:** `doc/11` Ã‚Â§4.

### Description
`npm run build` and `next dev` both write to `apps/web/.next`. Running the build while the dev
server was serving from that directory replaced the files under a running process: the server kept
its port, its PID and its apparent health, and began answering every compiled route with
`Internal Server Error`.

What made this cost time is how it presents. Three things said everything was fine:

* `/api/v1/health` returned `{"status":"ok"}`;
* `robots.txt` returned `200`, because it is a static file served outside the compile path;
* a browser tab that was already open kept rendering its page from the previous successful load.

So the evidence pointed away from the build and towards a stale session cookie or a broken route Ã¢â‚¬â€
which is where it was chased for a while before the dev server's own output was read.

### Resolution
Stop the dev server before building, and restart it afterwards. The running process's `.next` is not
going to be coherent again, so it is restarted rather than coaxed.

### Prevention
`doc/11` Ã‚Â§4 now states the constraint alongside the build and smoke steps, including the three false
symptoms above, so the next person reads the dev server's output instead of the network tab.

## E-038: A misconfigured messaging provider started anyway, exactly as the docs promised it would not

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-06, verified by starting the production build with and without the misconfiguration
* **Found:** 2026-10-06, while checking the production-startup rules `doc/09` Ã‚Â§4.1 states.
* **Related:** `doc/09` Ã‚Â§4.1 and Ã‚Â§5; `apps/api/src/lib/messaging/index.ts`; `apps/api/src/index.ts`.

### Description
Three separate documents said the same thing, and none of them was true.

`doc/09` Ã‚Â§4.1:

> Setting `MESSAGING_PROVIDER=twilio` without all three **refuses to start**, rather than looking
> healthy while quietly never sending.

The module's own header comment, above `resolve()`:

> Resolved once at startup so a deployment that intends to send messages but has misconfigured them
> is caught by the health check rather than by the first worker who submits a proof.

And the comment inside the refusal itself:

> Refusing to start is the point.

The refusal existed. It was simply never reached at the time either claim described: the provider
was resolved lazily, by `getMessageProvider()`, which runs on the first *dispatch*. So a production
process started with `MESSAGING_PROVIDER=twilio` and empty credentials:

```
$ NODE_ENV=production MESSAGING_PROVIDER=twilio node apps/api/dist/index.js
API server listening  {"url":"http://127.0.0.1:4200","environment":"production"}
$ curl /api/v1/health
{"status":"ok","product":"TetherProof","database":"up",...}
```

Healthy, listening, and doomed. The health check does not mention the messaging provider at all,
so nothing about the deployment's state was visible; the first sign of trouble would have been the
first worker to submit a proof, and even that arrives as a caught exception inside
`sendVerificationLink` Ã¢â‚¬â€ a log line, in a feature whose whole purpose is to reach a client. The
failure mode both documents named as unacceptable was the actual behaviour.

### Resolution
`index.ts` now resolves the provider before the socket opens, so `resolve()` runs at startup and
its refusal is a startup failure. Constructing the provider does no I/O Ã¢â‚¬â€ `TwilioProvider`'s
constructor stores configuration and `isConfigured()` checks that it is present Ã¢â‚¬â€ so the check
costs nothing at boot. The module comment was corrected to describe what the code now does: it
refuses to start, rather than being "caught by the health check", which it never was.

### Verification
Production build, run four ways:

| configuration | result |
| --- | --- |
| `VERIFIER_PHONE_SALT` missing | refuses to start: `VERIFIER_PHONE_SALT: required in production, at least 16 characters` (pre-existing, matches `doc/09` Ã‚Â§4.1) |
| `MESSAGING_PROVIDER=twilio`, credentials empty | **refuses to start**: `MESSAGING_PROVIDER is "twilio" but TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER are not all set.` Ã¢â‚¬â€ previously started |
| `MESSAGING_PROVIDER=log` (the default) | starts, `/api/v1/health` returns `200 {"status":"ok","database":"up"}` |
| development (`.env`, provider `log`) | unaffected; the development server runs normally |

`npm run build` and `npm run typecheck` both pass with the change.

---

## E-039: The client rendered every form in the product with none of the security headers the API carries

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-06, verified by header capture, a same-origin frame probe and Lighthouse
* **Found:** 2026-10-06, during the Phase 5 security audit Ã¢â‚¬â€ the API was checked first and came back
  clean, which is what made the asymmetry visible.
* **Related:** `doc/08` Ã‚Â§2; `apps/web/next.config.ts`; `apps/api/src/app.ts` (`helmet`).

### Description
The API has carried a full `helmet` set since Phase 1 Ã¢â‚¬â€ CSP, HSTS, `nosniff`, frame options,
referrer policy, `x-powered-by` disabled. The web app, which is the half that actually renders the
forms and holds the session cookie, shipped with none of them:

```
$ curl -I http://localhost:3001/login
HTTP/1.1 200 OK
X-Powered-By: Next.js
Content-Type: text/html; charset=utf-8
```

No `X-Content-Type-Options`, no frame protection, no referrer policy, no `Permissions-Policy`, no
CSP. Two consequences with a person behind them:

* **Clickjacking.** Any site could frame the sign-in and log-work forms, overlay them, and have a
  visitor click something they never saw. The product's entire value is a signed statement about
  work performed, so a forged submission is not a nuisance, it is the fraud the platform exists to
  prevent.
* **A token in a referer.** A verification link carries a bearer token in its path. Without a
  referrer policy, following any link from that page Ã¢â‚¬â€ or from any page the reader reached after it
  Ã¢â‚¬â€ could disclose the token to a third party.

### Why these values
* `X-Frame-Options: SAMEORIGIN` rather than `DENY`, matching the API: a same-origin frame is how the
  layout is inspected at a desktop width when no wide viewport is available, and `DENY` closes that
  without protecting anything `frame-ancestors 'self'` does not.
* `Referrer-Policy: no-referrer` Ã¢â‚¬â€ the verify page had already asked for this with a meta tag;
  nothing in the product needs to tell another site where a reader came from, and a verification
  token in a path is never a thing to leak.
* `Permissions-Policy` grants only what the app uses, to this origin: geolocation (is the work at
  the site it claims), microphone (voice note), camera (the photo picker on a phone).
* CSP asserts `frame-ancestors`, `base-uri`, `form-action` and `object-src`, and **deliberately not
  `script-src`**: Next bootstraps hydration from inline scripts, so a strict script policy needs a
  per-request nonce threaded through middleware Ã¢â‚¬â€ a change that breaks pages in ways a header check
  cannot see. The directives are independent, so a browser applies the ones it is given and leaves
  the rest alone. A nonce is the right next step and belongs in its own change.
* `Strict-Transport-Security` is stated unconditionally: it is only honoured over HTTPS, so it is
  inert in development and correct in a deployment.
* `poweredByHeader: false` removes the framework name from every response.

### Verification
Header capture after the change:

```
$ curl -I http://localhost:3001/login
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(self), microphone=(self), camera=(self)
Content-Security-Policy: frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

`X-Powered-By` is gone. Behaviour that the new headers could have broken was re-tested in a real
browser rather than assumed:

* a **same-origin 1000px frame** still renders the dashboard under `SAMEORIGIN`, and the desktop
  navigation bar is the variant visible inside it;
* a **server-action form** still submits under `form-action 'self'` Ã¢â‚¬â€ a full sign-in completed with
  no console errors and no CSP violation;
* the verification page still loads its data cross-origin (the CORS path from E-035);
* **Lighthouse** on `/` and `/dashboard`: accessibility 1.0, best practices 1.0, SEO 1.0, zero
  failures.

`npm run typecheck` and `npm run build` pass. These headers are now asserted by the smoke suite
itself Ã¢â‚¬â€ five on the API's health response, six on the client's `/login` Ã¢â‚¬â€ because a response
header is invisible to typechecking and easy to lose in a middleware reorder, and a check the suite
makes is one that survives me leaving. Full run after the assertions were added: **257 passed, 0
failed** (246 before, so all eleven passed first time).

---

## E-040: The smoke suite printed FAIL and still exited 0

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-06, verified by forcing the same failure and asserting exit 1, then a full run asserting exit 0
* **Found:** 2026-10-06, while re-running the gate after the Vercel build fix Ã¢â‚¬â€ the API failed to boot on one run, the suite printed `FAIL`, and the shell recorded `EXIT=0`.
* **Related:** `scripts/smoke.mjs`; `doc/11` Ã‚Â§4.

### Description
The gate is worth exactly what its exit code says, and this one could lie.
The observed run ended:

```
===== BOOT API =====
  FAIL  API starts and reports healthy
===== CLEANUP =====
EXIT=0
```

The API-boot block ended with `if (!up) return;`. That `return` left `main()`
from inside its `try`, so the `finally` block ran `CLEANUP` and control never
reached the `RESULT` line and `process.exit(failed === 0 ? 0 : 1)` that sit
*after* the try/finally. Nothing else was pending in the event loop, so Node
ended the process with code 0 Ã¢â‚¬â€ the one failure mode that stops the suite
early was exactly the one the exit code did not report. Runs that printed
`RESULT: 257 passed, 0 failed` were honest; the hole was only in the
early-exit path, which is the path every aborted run takes.

### Resolution
Two changes in `scripts/smoke.mjs`:

* the boot block throws instead of returning, so the failure reaches
  `main().catch`, prints `SMOKE TEST ABORTED` with the reason, still runs
  `CLEANUP` through the `finally`, and exits 1;
* a `process.on('exit')` guard makes the rule structural instead of local:
  once any check has run, the process may only exit 0 through the `RESULT`
  line, which sets a `finished` flag. Any other early exit Ã¢â‚¬â€ a future
  `return`, a path that swallows a throw Ã¢â‚¬â€ ends in 1 rather than green.

### Verification
Both directions, with the port free (the original conditions). The failure
was forced by giving the spawned API `API_HOST=192.0.2.1`, an address this
machine cannot bind, so pre-flight sees a free port while the API never
becomes healthy:

```
===== BOOT API =====
  FAIL  API starts and reports healthy
      code: 'EADDRNOTAVAIL', syscall: 'listen', address: '192.0.2.1', port: 4100
===== CLEANUP =====
SMOKE TEST ABORTED: the API did not become healthy on port 4100 (see the FAIL above for its last output)
NEGATIVE_EXIT=1 (expected 1)
```

and the unmodified happy path, same script:

```
===== RESULT: 257 passed, 0 failed =====
POSITIVE_EXIT=0 (expected 0)
```

The original boot failure itself never recurred: it appeared once, right
after `npm run build` had rewritten `apps/api/dist`, and the same binary
booted in 0.7 s on every attempt afterwards, including two full 257-check
runs. It is treated as transient; what is fixed here is the exit code,
which had been wrong all along.

## E-041: The Vercel build died on `lightningcss` Ã¢â‚¬â€ the lockfile carried only the Windows native binary

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-07, live: the Vercel build of `c8e309b` completed with `Ã¢Å“â€œ Compiled successfully` and 12/12 pages generated
* **Found:** 2026-10-06, third Vercel build of `aabf2b2` Ã¢â‚¬â€ the Root Directory and Install settings now saved correctly, the build reached `next build`, and webpack failed with `Error: Cannot find module '../lightningcss.linux-x64-gnu.node'` required from `/vercel/path0/node_modules/lightningcss/node/index.js`.
* **Related:** root `package.json` (`optionalDependencies`), `package-lock.json`, `apps/web` (Tailwind v4), `doc/09` Ã‚Â§2.1.

### Description

Tailwind v4's PostCSS chain (`@tailwindcss/postcss` Ã¢â€ â€™ `@tailwindcss/node` Ã¢â€ â€™ `lightningcss` +
`@tailwindcss/oxide`) loads its engine from a platform-specific native package. The loader in
`lightningcss/node/index.js` first tries `require('lightningcss-linux-x64-gnu')` and falls back to
a relative `../lightningcss.linux-x64-gnu.node` Ã¢â‚¬â€ the exact file Vercel reported missing.

`package-lock.json` recorded **every** platform for `sharp`, `esbuild` and `@next/swc`, but for
`lightningcss@1.32.0` and `@tailwindcss/oxide@4.3.3` it contained only the `win32-x64-msvc`
entries Ã¢â‚¬â€ the ones this machine installs Ã¢â‚¬â€ even though both parents list all of their platforms in
`optionalDependencies`. npm therefore considered the lock complete (`npm ci` passed), so Vercel's
`npm ci` faithfully installed a tree that cannot start Tailwind's engine on Linux. Local Windows
builds passed throughout, which is why every local verification had been green.

`@tailwindcss/oxide-linux-x64-gnu` had the identical hole and would have crashed the build
immediately after `lightningcss` was fixed, so both were closed in one change.

### Resolution

Root `package.json` declares both Linux binaries in `optionalDependencies`, pinned to the hoisted
parent versions (native bindings must match exactly):

```json
"optionalDependencies": {
  "@tailwindcss/oxide-linux-x64-gnu": "4.3.3",
  "lightningcss-linux-x64-gnu": "1.32.0"
}
```

* **Root level, not `apps/web`** Ã¢â‚¬â€ `lightningcss`/`oxide` are hoisted to `/vercel/path0/node_modules`,
  and `require()` from there only walks *up*; a copy nested under `apps/web/node_modules` would
  never be found.
* **`optionalDependencies`, not `devDependencies`** Ã¢â‚¬â€ both packages declare `os: ["linux"]`; as
  optional they are skipped silently on Windows instead of failing `npm install` with
  `EBADPLATFORM`, while still being written to the lock and installed on Linux.

`npm install --package-lock-only` recorded both entries at root level with `optional: true`,
`resolved` and `integrity`. An exhaustive scan of the lock afterwards (every parent's
`optionalDependencies` checked against installed entries) confirmed no other package needed by
Vercel's platform is missing; the remaining gaps are exotic platforms (android/freebsd/arm/musl)
and `fsevents` (macOS-only), none of which this build path uses.

### Verification

* Main repository: `npm install` Ã¢â€ â€™ exit 0 (Windows skips the Linux optionals silently, no
  `EBADPLATFORM`).
* Clean room: fresh `git clone` of `aabf2b2` + the two changed files (`package.json`,
  `package-lock.json`) Ã¢â€ â€™ `npm ci` Ã¢â€ â€™ `npm run build` in `apps/web` with `NODE_ENV=production`,
  `CI=true` and dummy `NEXT_PUBLIC_*` values. The first attempt died inside `npm ci` on a registry
  `ECONNRESET` storm ending in npm's `Exit handler never called!` Ã¢â‚¬â€ unrelated network flakiness;
  retried.
* Clean-room result (retry): `npm ci` Ã¢â€ â€™ exit 0, `npm run build` in `apps/web` Ã¢â€ â€™ **exit 0** Ã¢â‚¬â€
  `Ã¢Å“â€œ Compiled successfully`, lint/type checks passed, 12/12 pages generated.
* Live: pending Ã¢â‚¬â€ the next Vercel deployment is the proof that matters; this entry closes only
  then.
## E-042: Sign-in said "We could not sign you in" with no hint of the real cause

* **Status:** Open Ã¢â‚¬â€ implemented and verified locally; closes when the next Vercel build deploys it live
* **Found:** 2026-10-07, signing in at the live site (`https://tetherproof.vercel.app`) Ã¢â‚¬â€ the form showed the generic fallback and a reader could not tell a service outage from a wrong password.
* **Related:** `apps/web/src/lib/api-error.ts`, `apps/web/src/lib/server/api.ts`, `apps/web/src/lib/api.ts`, `doc/09` Ã‚Â§2.1, `doc/13` E-041.

### Description

Signing in is a server action that calls the TetherProof **API** (`apiPublic('/auth/login')` in
`lib/actions.ts`); it does not talk to Supabase from the browser. The base URL is
`NEXT_PUBLIC_API_BASE_URL`, falling back to `http://localhost:4000` (`lib/server/api.ts`). On the
deployed site that variable is unset until the API is hosted, so the action fetched Vercel's own
`localhost:4000`, and `fetch` rejected with `ECONNREFUSED`.

The failure was then hidden by design: `messageFor()` only forwards `ApiRequestError` messages,
because an unexpected error's own text may describe the database or the network rather than
something the reader can act on. A raw `fetch` rejection is exactly that case, so it fell through
to `We could not sign you in. Please try again.` Ã¢â‚¬â€ truthful, but indistinguishable from a wrong
password, with no log entry on the server to say which it was.

### Resolution

A single typed failure for "nothing answered at all", distinct from a refusal:

* `serviceUnreachable()` in `lib/api-error.ts` raises `ApiRequestError('We could not reach
  TetherProof just now. Please try again in a few moments.', 503, 'SERVICE_UNAVAILABLE')`. Status
  503 keeps it outside the 401/403 checks that mean "the session is bad": an unreachable API must
  not look like a rejected session.
* `lib/server/api.ts` routes both fetch calls through a `request()` helper that catches the
  rejection, logs the underlying cause (`console.error` with the URL and `cause`, so Vercel
  function logs can diagnose it), and throws `serviceUnreachable()`.
* `lib/api.ts` (browser client) does the same without the log line Ã¢â‚¬â€ the browser's network log
  already carries the technical cause.

The API's own refusal for bad credentials (`Incorrect sign-in details.`) still reaches the form
whenever the API is the thing answering, so the two situations now read differently.

### Verification

* `tsc --noEmit` for `apps/web` Ã¢â€ â€™ exit 0.
* Dead API (dev instance with `NEXT_PUBLIC_API_BASE_URL=http://localhost:4999`): submitting the
  login form renders the reach message, and the dev log records
  `[api] could not reach http://localhost:4999/api/v1/auth/login [TypeError: fetch failed] ...
  code: 'ECONNREFUSED'`.
* Live API, wrong password (dev instance pointed at the running API on 4000): the form renders
  the API's own `Incorrect sign-in details.`

Signing in on the deployed site still requires a hosted API with `NEXT_PUBLIC_API_BASE_URL` set
for Production (and redeployed, since `NEXT_PUBLIC_*` values are inlined at build time). That
deployment decision is pending; this entry only fixes how the waiting period reads.

---

## E-043: After "Log this work" the whole page was replaced by "That page did not load"

* **Status:** **Resolved** Ã¢â‚¬â€ 2026-10-07. Fix verified end-to-end on the production build, then
  confirmed live on the deployed site from the reporting device after the automatic deploy.
* **Found:** 2026-10-07, worker on a phone at the deployed site. After selecting a job, a photo,
  a description, and a phone number, tapping **Log this work** opened a screen reading *"That page
  did not load Ã¢â‚¬â€ Nothing you entered was lost, and nothing was saved either"* instead of the
  submission result.
* **Related:** `apps/web/src/app/(app)/workspace/LogWorkForm.tsx` (moved here from
  `apps/web/src/app/(app)/dashboard/` in the logbook restructure; the dashboard is now an overview
  with no sibling fetches on the form's post-submission re-render path Ã¢â‚¬â€ its one fetch is
  try/caught), `apps/web/src/app/(app)/error.tsx`, `doc/13` E-042.

### Description

The submission is a server action (`submitProof`), and it never throws: every failure becomes
form state. The error boundary came from a different step. Once a form action settles, Next.js
re-renders the current route, and the dashboard was a server component that also fetched
`/invites/offers` (the "Waiting for you" card) and the caller's profile. Either fetch throwing on
that re-render let `(app)/error.tsx` replace the entire screen Ã¢â‚¬â€ including the "Work logged" panel
the action had just produced.

The boundary's copy made it worse. "Nothing was saved either" is only true when the crash happened
before anything ran; after a server action it may well have landed, and the sentence then told the
worker the opposite of the truth. Repeating the submission "until it works" could record the same
job twice.

### Resolution

* Removed the dashboard's only other server-side fetch. The "Waiting for you" card is gone Ã¢â‚¬â€ it
  duplicated the Invitations tab Ã¢â‚¬â€ so the post-submission re-render now re-executes just the auth
  profile fetch that every signed-in page already depends on.
* Rewrote the error boundary copy to say *check* instead of promise: if the reader had just logged
  work, confirm whether it saved before submitting again, because a second attempt could record the
  job twice.
* The form's own reachability errors (E-042) remain the primary failure path for a dead API.

### Verification

* The signed-in dashboard renders a single "Log completed work" card; the page HTML has no
  `/invites/offers` fetch and none of the removed cards.
* The complete submission ran end-to-end against the production build: the `submitProof` action
  decoded and validated the form, uploaded the multipart proof to the API, scrubbed the image,
  created the proof row, and re-rendered the dashboard with the **Work logged** panel describing
  the result.
* One environment note surfaced during the run: this browser harness rewrites the `Origin` header
  of React's server-action POSTs to the literal string `null`, which crashes Next's own action
  handler before application code runs (see E-046). Replaying the identical request with a normal
  `Origin` header succeeded, so the application flow itself is sound. The live check followed the
  automatic deploy: the reporting device loads the workspace and logs work cleanly.

---

## E-044: "Use my location" handed the worker a coordinate box instead of a place

* **Status:** **Resolved** Ã¢â‚¬â€ 2026-10-07. Endpoint confirmed live; placement and fallback flows
  confirmed on the production build and then on-device after the automatic deploy.
* **Found:** 2026-10-07, worker testing on a phone: tapping **Use my location** filled a large
  text box with `5.6037,-0.1870`. The sensor worked, but the interface presented the outcome as
  numbers to interpret, which is the opposite of how people experience a place.
* **Related:** `apps/web/src/app/(app)/workspace/LogWorkForm.tsx` (moved here from
  `apps/web/src/app/(app)/dashboard/` in the logbook restructure), `apps/web/src/lib/use-geolocation.ts`,
  `apps/api/src/modules/locations/*`, `doc/07` Ã‚Â§7.

### Description

The workspace showed the detected location as a big editable coordinates field and told the worker
"Latitude, longitude. The button fills this in, or type it." A normal user understands a
place/community/area name, not a number pair; the primary experience should be the name, with
coordinates as secondary detail and typing as a fallback. On top of that, a 10-second geolocation
timeout made a slow GPS fix read as a failure.

### Resolution

* New public endpoint `GET /api/v1/locations/reverse?lat=..&lon=..` names a coordinate pair via
  Nominatim (OpenStreetMap) Ã¢â‚¬â€ keyless, no billing setup, an identifying User-Agent, a 6-second
  timeout, and a 60-per-15-minutes per-IP rate limit. The provider address lives only in
  `apps/api/src/modules/locations/service.ts`.
* The location section in the Workspace now leads with the detected **area name** and shows the
  coordinates as a small secondary line. Naming failure is non-fatal: coordinates are always kept,
  with a sentence saying so.
* Typing is a two-small-field fallback ("Type coordinates instead"), validated with the same rule
  the submission repeats, and the stored value travels in a hidden field so the API contract
  (`submissionGps` = `latitude,longitude`) is unchanged.
* Geolocation timeout raised 10 s to 15 s.

### Verification

* `tsc --noEmit` passes for both workspaces.
* The endpoint answered live with `{"placeName":"Black Star Square, Accra, Ghana"}` for a real
  coordinate, and a `400` with field-level details for out-of-range input.
* On the production build: the GPS button named the location ("Black Star Square, Accra, Ghana")
  with the coordinates as the small secondary line; typing `5.6037,-0.1870` produced
  "Patrice Lumumba Road, Accra, Ghana"; the stored value stayed `latitude,longitude` in the hidden
  field, and a stale name from a previous fix could not leak into a new submission. The on-device
  check after the automatic deploy confirmed the phone experience on the live site.

### Follow-up hardening (2026-10-07, logbook restructure)

The lookup is now soft on both sides. The API's reverse-geocode retries once with a short backoff
before answering `503`; the web's own name lookup retries once more (500 ms between attempts); and
the GPS hook retries once on a transient failure before reporting a distinct `failed` state with
its own message, so a slow fix no longer reads as a refusal. The coordinates are never at risk
whatever the name lookup does Ã¢â‚¬â€ verified live in the restructure run: typing `5.6037,-0.1870` saved
exactly that pair into the submission, and the log detail rendered `5.6037, -0.1871` after a
deliberate edit.

---

## E-045: "Send a new code" refused every attempt even with the email filled in

* **Status:** Resolved Ã¢â‚¬â€ 2026-10-07. Fix verified: the code request succeeds.
* **Found:** 2026-10-07 on the sign-in page. The request-code form rendered two `email` inputs and
  the hidden one came first, so `formData.get('email')` always returned the empty hidden input and
  the action answered "Enter your email address." no matter what was typed.
* **Related:** `apps/web/src/app/login/LoginView.tsx`.

### Description

A hidden email input was there to carry the email between steps, but when there was no carried
email it still rendered with an empty value, sitting before the visible input in the form. A server
action reads a form by field name, so it kept reading the hidden empty one.

### Resolution

The hidden input now renders only when there is a carried email to carry. With one email input in
the form, `formData.get('email')` reads what the person typed.

### Verification

The request-code action runs from the fixed form and the code request succeeds. No other change to
the sign-in page.

---

## E-046: Server-action POSTs crash before the action runs when the client sends `Origin: null`

* **Status:** Documented; not an application defect. Root-caused so later verification runs do not
  chase it as an app bug.
* **Found:** 2026-10-07 while verifying the proof-submission flow. React's server-action POSTs
  arrived at Next.js with `Origin: null`; Next's action handler calls `new URL(req.headers['origin'])`
  (`next/dist/server/app-render/action-handler.js`) and throws `ERR_INVALID_URL` with `input: 'null'`
  before any application code runs. Both the dev and the production runtime hit it.
* **Evidence it is environmental:** plain `fetch` POSTs from the same page carry the correct origin
  (confirmed with a local echo server and a temporary server-side header log); only React's own
  form-action dispatch is affected, and the value is already `null` when it reaches the server.
* **Why it is not the reporter's bug (E-043):** a browser on the deployed site sends its own origin,
  so this path cannot fire for the person who hit the work-log error page.
* **Workaround used for verification:** replaying the identical request from outside the harness
  with a normal `Origin` header ran the full submission to success ("Work logged" panel rendered,
  proof row created).

---

## E-047: The web workspace was not running, and port 3001 belonged to another project

* **Status:** Resolved (workaround) Ã¢â‚¬â€ 2026-10-07. The web dev server ran and the logbook flow was
  verified against it; why the watcher's web child had vanished is not yet determined.
* **Found:** 2026-10-07, before browser-verifying the logbook restructure. The `concurrently` root
  process (`npm run dev`) had only its `api` child alive; no TetherProof `next dev` was listening
  on any port, and port 3001 Ã¢â‚¬â€ the port the smoke tooling assumes for the web Ã¢â‚¬â€ was serving an
  unrelated project's `next dev` ("Veben").
* **Related:** `apps/web`, `scripts/smoke.mjs` (defaults `SMOKE_WEB_PORT` to 3100; the web dev
  default is 3000/3001), the `concurrently` launcher at the repo root.

### Description

Requests to the expected web port returned another application's HTML, and the harness browser
loaded that unrelated app, so it was impossible to browser-check the new pages without first
determining what was actually listening. The root `npm run dev` process owned only the API child;
there was no evidence of why the web child had stopped (it was not in the process tree at all).

### Resolution

Started the web workspace explicitly on an unambiguous port (`next dev -p 3100` from
`apps/web`), leaving the API dev server (still on 4000) untouched.

### Verification

The full signed-in run completed against the dev server on 3100: dashboard overview, workspace
form, a real submission (media + description + skill + typed coordinates), the "View all logs"
shortcut, the logs list, the log detail, an edit that changed the stored description and
coordinates, and the frozen-entry note after a verification link was marked as sent. All rendered
and interacted correctly. The one persistent harness quirk (E-046) did not reproduce for the
login submission this time Ã¢â‚¬â€ the action POST completed and the session was written normally.

---

## E-048: Follow-up batch Ã¯Â¿Â½ profile owner view, avatar upload, signed-in info header, header sizing, brand casing

* **Status:** Resolved
* **Found:** 2026-10-08, during review of the previously shipped build.

### Description

Four follow-ups from review of the shipped interface:

1. **Profile page opened straight into an edit form.** A profile visit answers "who am I", not
   "finish filling this form", so the page now opens read-only Ã¯Â¿Â½ photo, name, organisation,
   location Ã¯Â¿Â½ and editing starts only from an explicit **Edit profile** action.
2. **Info pages signed in showed "Sign in".** A member reaching Help from the more menu was
   told to sign in again. The info header now branches on session state like the app shell: a
   signed-in visitor keeps the more (hamburger) menu and their identity; a signed-out visitor
   keeps the "Sign in" link. The slim info footer is unchanged.
3. **Header sizes.** The header geometry stays as it was, but the app name grew from
   `text-sm` to `text-lg` (14px ? 18px) and the hamburger from `h-5 w-5` to `h-6 w-6`
   (20px ? 24px), on a `min-h-11` (44px) button.
4. **Brand casing.** Every mark that styled the app name `uppercase` now renders "TetherProof"
   in its true casing (AppShell, info header, marketing page, sign-in/verification interstitials).
   Marketing section labels and logbook headings keep their deliberate `uppercase` Ã¯Â¿Â½ those are
   not the product name.

### Resolution

Avatar storage was the new capability this batch needed: `POST /auth/avatar` (multipart
`avatar_file`) and `DELETE /auth/avatar`, both authenticated and rate-limited like proof media.
Images are scrubbed of metadata (sharp re-encoding), stored as random-UUID objects in a private
`profile-avatars` bucket (applied by the generalized `storage:ensure-bucket` script), and served
only through short-lived signed URLs minted at read time. `updateProfileSchema` still accepts no
caller-supplied `avatarUrl` Ã¯Â¿Â½ a smuggled field is stripped, never applied Ã¯Â¿Â½ and account deletion
now also removes the avatar object, counted in `mediaRemoved`. The storage helper
`deleteProfileAvatar` reports success so deletion counts stay honest.

### Verification

API (dev server on 4000): register ? confirm ? upload (201, object in `profile-avatars/`),
signed URL served real bytes, replace removed the previous object, smuggled `avatarUrl` in a
profile PATCH was stripped, remove returned `null`, and deleting the account removed the avatar
object (`mediaRemoved: 1`) with the earlier signed URL dead afterwards. No objects left behind in
either bucket.

Web (dev server on 3100): signed in as a throwaway worker Ã¯Â¿Â½ dashboard header brand 18px / weight
600 / no uppercase and 24px hamburger on a 44px button; `/profile` opened read-only with
**Edit profile**, the form appeared only after clicking it; a real file upload showed the photo
with "Your photo is updated." and an image decoded from storage; **Remove photo** cleared it with
"Your photo was removed."; `/help` while signed in showed the hamburger and its full menu
(Invitations, Settings, Help, About, Terms, Privacy) and no "Sign in" link; after sign-out the
info header reverted to brand + "Sign in"; the landing brand read "TetherProof". Web typecheck and
the production `next build` both pass.

---

## E-049: Follow-up batch 2 - the avatar editor sheet and the rearranged navigation

* **Status:** Resolved
* **Found:** 2026-10-08, as follow-ups 5 and 6 from review of the previously shipped build.
* **Supersedes:** the navigation half of E-048 (items 1-2 there described the header "More"
  control and the read-only profile; this entry replaces them with what shipped).

### Description

Two more follow-ups, both in the web app only - no API change in this batch:

1. **The photo area still looked like a form widget.** Task 5: in the profile image area there
   must be no Upload button, no "Choose file" button, and no file-name text. Tapping the avatar
   opens a simple, native-feeling image editor: the current photo shown large, a pencil icon to
   pick a new photo from the gallery, a trash icon to remove it, and Save and Cancel along the
   top. After picking a photo the person stays on the same view; nothing leaves the device until
   Save. Save uploads (or removes), then the sheet closes and the page shows the result. The
   trash is disabled when there is no photo to remove.
2. **The hamburger/More menu is gone.** Task 6: the header now carries the brand and the desktop
   nav bar on the right, and the account avatar (photo or person icon, no initials, no text
   around it) sits top-right and opens the Profile page. The phone's bottom-right corner holds a
   "More" tab that opens a dedicated `/more` page listing Invitations (worker), Settings, Help,
   About, Terms & Conditions and Privacy Policy. The Profile tab is removed from the primary
   nav. The info-page header mirrors the app shell (avatar top-right when signed in, "Sign in"
   when not), and the info footer gains a "More" link while signed in.

### Resolution

The avatar editor is `apps/web/src/app/(app)/profile/AvatarEditor.tsx`, a bottom sheet
(`role="dialog"`, `aria-modal`) rendered only while the avatar tap keeps it open, so its action
state and object URL reset on every session. It drives the existing `uploadAvatar` /
`removeAvatar` server actions imperatively through `useActionState`; a picked file is previewed
with a revocable object URL, Save dispatches exactly one action (upload when picked, remove when
the trash was used, none when nothing changed), and a `done` effect closes the sheet so the
revalidated page shows the result. Success messages are dropped - the visible outcome is the
photo itself. The person icon replaces the old initials everywhere via the shared
`ProfileAvatar` component (`sm`/`md`/`lg`).

The navigation is rearranged in `lib/navigation.ts` (each role's primary list ends in
`{ href: '/more', label: 'More', icon: 'more' }`, no Profile tab), `PrimaryNav.tsx` gains the
three-dot `more` icon, `AppShell.tsx` drops the `MoreMenu`/identity props for a header of brand +
desktop bar + `ml-auto` avatar link, the new `(app)/more/page.tsx` renders `moreFor(role)`, and
`MoreMenu.tsx` is deleted. The info header/footer branch on session state, and the Help page copy
now says "under More, in Invitations" instead of "under the more menu (.)".

### Verification

Browser walk (dev server on 3100, throwaway worker): header had brand + desktop bar + avatar
top-right with no button beside it, no text around the avatar, and no Profile tab; the phone nav
ended in More (bottom-right; `aria-current` on `/more`). Avatar tap opened the editor with
Save/Cancel, a large person icon, a pencil (Choose) and a disabled trash. Picking a file kept the
sheet open with a local preview; Save uploaded the file (signed storage URL rendered in the
profile) and closed the sheet; the editor reopened showing the photo with the trash enabled;
trash + Save removed it and the person icon returned. `/more` listed Invitations, Settings, Help,
About, Terms & Conditions and Privacy Policy; `/help` while signed in showed brand + avatar and a
footer "More" link; after sign-out it showed brand + "Sign in" with no More link. The landing
brand read "TetherProof". Web typecheck and the production `next build` both pass.

### Note: dev-server corruption while verifying

Running the production build against the running dev server corrupted `apps/web/.next` (the
shell logged `Cannot find module './571.js'` and `[TypeError: Invalid URL]` on `/login`), which
made client pages fail to hydrate and sign-in 500. This is E-037 in a new disguise: the fix is
the documented one - stop the dev server before building, delete `.next`, restart dev - after
which every flow above went green. No application code was involved.

### Follow-up during review: the corner avatar on the profile page

Review pointed out that the header's top-right avatar is the way to the profile page - and on
the profile page itself that is an anchor to where the user already is, a second avatar sitting
next to the one the page is showing. The corner now hides there. The avatar link moved into a
small client component, `HeaderAvatar` (`apps/web/src/components/shell/HeaderAvatar.tsx`), that
reads `usePathname` and returns nothing on `/profile` (or a future nested `/profile/*`), while
`AppShell` stays a server component and the header keeps the identical layout on every other
page. Verified in the browser: avatar present on `/dashboard` and `/more`, absent on `/profile`
where the header is brand + tabs and the page's own large avatar stands in for the corner.


## E-050: Follow-up batch 3 - context-aware header, More sub-pages, invitation icon, no-reload navigation

Batch scope (15 items): avatar save must never land on the error screen; no full-page reloads on
navigation or saves; header title tells you where you are; More and its sub-pages restructured
with back headers instead of body headings; invitation access moves from More to a Home-only
header icon with a pending-count badge; intro copy stripped app-wide. Verified end to end in the
browser as a worker, as an employer, and signed-out.

What changed and why:

- The header is a single client component (`AppHeader`) that branches on where you are: a
  sub-page (profile, invites, settings, help, about, terms, privacy) renders only a back icon
  and the page name; a primary section reads its own name (Workspace, Logs) or the app name on
  Home and More. The section title lives in the header as the page's single h1; every duplicate
  body heading and intro paragraph was removed from dashboard, workspace, logs, profile, invites,
  settings, and more. `HeaderAvatar` is deleted - Profile is reachable only from More.
- The bottom tab row (`AppTabs`) renders on the four primary sections and returns null on every
  sub-page, so a sub-page is a focused screen with a single way forward (back).
- The Home header carries the invitation icon for workers only, with a badge counting
  invitations not yet answered (caps at 99+; no badge at zero). The count is fetched in the app
  shell from `/invites/offers` for workers only, and any failure degrades to no badge rather
  than erroring the shell.
- One automatic retry (400 ms) was added in `apiServer` for GET requests whose response is
  5xx/503 (a page render that hits a briefly-unreachable API no longer dies on the first miss).
  Writes are never retried; the avatar save flow keeps its existing full error handling inside
  the form and always stays on /profile.

The original error screen, reproduced and explained: while verifying, the API dev process died
mid-run; the very next worker page render threw `serviceUnreachable` from `dashboard/page.tsx`
and every subsequent navigation showed the error screen (and the dev overlay). That is the same
failure the batch started from: the API being unreachable at request time. Nothing in the save
flow redirects anywhere. The retry softens transient 503s; a genuinely dead API still surfaces
the error screen honestly.

Tooling trap worth recording: the Next dev error dialog (inside `nextjs-portal` shadow DOM)
covers the whole viewport and silently swallowed every `browser.click` aimed at the page, which
looked exactly like slow/non-navigating links. The fix is to dismiss the overlay and retry the
click, not to touch application code.

Verified live: section titles in header only (Home/More read "TetherProof", Work "Workspace",
Logs "Logs", sub-pages their names; no body h1 on any signed-in screen); bottom tabs on Home,
Work, Logs, More and on no sub-page; back icon returns to More everywhere; More lists exactly
Profile, Settings, Help, About, Terms & Conditions, Privacy Policy with no heading, no
"Everything else", no "Signed in as"; invitation icon only on Home (absent on Work, Logs, More,
and every sub-page; absent for the employer session); badge lifecycle 2 -> 1 -> none after
accepting then declining the two test invitations, with the plain "Invitations" label at zero;
avatar save stays on /profile with a persisted photo across reload and sign-out/sign-in; no
document reloads across tab and sub-page navigation (a `window` marker survives every soft nav);
signed-out info pages keep the marketing header and footer with a body h1; employer Home reads
"TetherProof" with Workspace/More tabs and the same More sub-page behavior. Production `next
build` passes (dev stopped, `.next` removed first - the E-037 discipline), as does `typecheck`
across all workspaces. Test scaffolding was throwaway code and accounts under
`tetherproof.invalid`, separately deleted or left inert.

Addendum during final verification: a session whose account has been deleted (the settings
"Delete my account" flow, then the account's own browser navigating on) made `GET /auth/me`
answer 404 "Profile not found", and `currentProfile` treated that as a real error, so every
signed-in render hit the error screen instead of the login page. `currentProfile` now maps both
401 (no session) and 404 (session for a deleted account) to `null`, so the layouts redirect to
sign-in. Reproduced live with a deleted test account and verified to redirect cleanly.

## E-051: A network failure was reported to the person signing in as a wrong password

* **Status:** Fixed
* **Found:** 2026-10-08, reported from the sign-in screen: typing an email and password with no working connection produced `Incorrect sign-in details.`
* **Related:** `apps/api/src/modules/auth/service.ts` (`login`), `apps/web/src/lib/actions.ts` (`signIn`, `uploadAvatar`), `apps/web/src/lib/api-error.ts`, `apps/web/src/components/ui/Field.tsx`, `apps/web/src/app/login/LoginView.tsx`

### Description

Three separate faults stacked up behind one symptom.

**The API turned every provider failure into a credential refusal.** `login()` collapsed
`signInWithPassword` into one branch: `if (error || !data.user || !data.session) throw
AppError.unauthorized('Incorrect sign-in details.')`. Supabase reports a rejected password and
a provider it could not reach through the same field, so a person offline, behind a captive
portal, or during a provider restart was told their password was wrong. The response to that
message is to change the password, which converts a temporary fault into a real one.

**The web pinned the message to the password box.** `signIn` returned
`field: 'password'` for every failure, so even the honest network wording
(`We could not reach TetherProof just now.`) appeared directly under the password input,
where it reads as a claim about the password. `uploadAvatar` had the same shape, reporting a
failed upload beside the file picker.

**A refused sign-in wiped what had been typed.** React resets an uncontrolled form once its
action finishes, whether it succeeded or failed, so the two boxes came back empty. `Field`
documented the opposite Ã¢â‚¬â€ that an uncontrolled input keeps what the person typed Ã¢â‚¬â€ which is
why this was not caught by reading the component.

The same field-pinning defect was audited across every action. The others were already
correct: `registerAccount`, `saveProfile`, `submitProof` and `editProof` use `formErrorFor`,
which attaches a field only when the API named one, and `requestCode`/`confirmWithCode` report
at form level. `uploadAvatar` was the one remaining case.

### Resolution

* **The API answers only for the code that means it.** `invalid_credentials` still becomes
  `401 Incorrect sign-in details.`; every other provider error, and a provider answer that
  carries neither a session nor an error, becomes `503` with a message that says what
  happened and points at the sign-in code as an alternative. The provider's code, status and
  message are logged rather than forwarded, and no other provider code is branched on: a
  refusal that distinguished an unconfirmed account from an unknown one would turn sign-in
  into an account-enumeration oracle, which is what this endpoint exists to prevent.
* **The web blames the password only for a credential refusal.** `isCredentialRefusal` in
  `lib/api-error.ts` is true only for `401`; every other failure is reported at form level.
  Narrower than `isAuthFailure`, which also covers an expired session on a signed-in page.
* **The fields survive.** `Field` and `PasswordField` accept `value`, so the sign-in panel
  holds its own email and password in state and React's form reset cannot clear them. The
  register and confirm panels use the same state, so a refused attempt there keeps the name,
  address and code too.
* **The address is remembered on the device; the password never is.**
  `lib/remembered-email.ts` stores the last address in `localStorage`, guarded for SSR,
  private mode and a corrupt value, and unticking `Remember my email on this device` erases
  it. No password is written to storage by this application: `autoComplete="email"` and
  `autoComplete="current-password"` already let the browser and a password manager offer the
  matching password for the remembered address, which is the safe version of the feature.

### Verification

* `npm run typecheck` passes across shared, api and web.
* Production build of a clean copy of the tree: exit 0, every route generated.
* Rendered `/login` from that build and confirmed the server-rendered markup carries the
  Lucide icons.

## E-052: The mutual-endorsement collusion signal is documented but can never fire

### Problem

pps/api/src/lib/fraud/collusion.ts computes a mutualEndorsement fact by asking whether a worker id and a verifier key ever appear in the same row of the history, in opposite roles. The two can never be equal: a worker id is a UUID and a verifier key is a 64-character SHA-256 digest of a browser-generated pseudonym. The fact is therefore always false, and the 0.15 weight attached to it is never applied.

This is structural rather than a bug. The check was equally inert when the key was a salted phone hash. It is recorded here because doc/02 and doc/08 both describe the collusion engine as detecting closed-loop rings without qualifying that one of its three signals is unreachable, and a reader of those documents would reasonably assume it works.

### Why it is not being fixed

Making it fire requires joining a verifier pseudonym to an account. There is no other route: the verification page is reached without an account by design, so the only identifier a verifier presents is a per-browser pseudonym that deliberately carries no link back to a user id. Any change that made the two comparable would reintroduce exactly the cross-context identity linkage lib/verifier-key.ts exists to avoid - a stable pseudonym derived from a user id, or a prompt for a phone number.

The signal is also weak evidence at 0.15, below the 0.25 withhold threshold on its own. Paying a real privacy cost to detect something that would not change any outcome on its own is a bad trade, so the deliberate state is a documented gap rather than a silent one.

### What was done

* The reasoning is kept in place at the call site, so the next person to read that comparison is told why it cannot be true rather than left to rediscover it.

* This entry records the limitation where the documentation set is read, which is the only place it was missing.

* The collusion weight floor is unchanged at 0.15 (isolated + concentrated), so no score, threshold or record is affected by this entry.

### Verification

* 
pm run fraud-check passes, asserting the engine never produces raud_blocked and that the recorded weight floor is unchanged.

* pps/api/src/lib/fraud/collusion.ts still computes the fact; the value is unchanged and no assertion depends on it.

## E-053: No linting and no unit tests (E-010)

### Problem

The repository had no linter and no unit test runner. The CI workflow checked types and produced a build, and both passed on code that contained a shadowed variable leaving a security assertion in the live suite passing unconditionally - a check that could not have failed, whatever the code under test did.

### What was done

* An ESLint flat config at the repository root, scoped to rules that find bugs rather than to style. No formatting rules are enabled, so no existing line was restyled. Every rule switched off, and the two advisory rules for images and media, carries the reason in the file.
* Vitest, with 29 tests over the three pure functions that decide something: the skill-search term splitter, the verifier-key pseudonym and digests, and the scoring engine's three-way outcome. Each tests the decision at the function, with no database, so an edit to the weights or the threshold cannot pass unnoticed.
* Both wired into CI ahead of the type-check, since lint is the cheapest check that finds real problems.
* The linter found four real defects on its first run, all fixed:

  - **A LIKE wildcard could reach the query.** The search term splitter sanitised its split terms but fell back to the raw query when none survived, so a query of % became like '%%%' and returned every worker rather than none. The fallback now draws from the same sanitised runs, and a test pins it.
  - **A security assertion that could not fail.** A variable was declared twice in the smoke suite, the inner declaration shadowing the outer, so a later read inspected a value nothing ever assigned. The phone-number check was passing unconditionally. Declared once now, and it genuinely runs.
  - **Two suppression comments that had stopped suppressing**, having drifted off the line they annotated.
  - **Dead code**: an unused process helper and an assigned-but-never-read variable in the smoke suite, both removed.

### Verification

* 
pm run lint exits 0 with no warnings.
* 
pm run test:unit runs 29 tests across 3 files, all passing.
* The full live smoke suite still passes, which is what confirms the shadowed-variable fix did not change the outcome of the check it repaired.

---

## E-054: The training provider module issued credentials that named nobody

**Status:** resolved 2026-10-16
**Area:** training provider module (doc/02 Module 4), `apps/api/src/modules/trainers/`

### The symptom

Two live assertions failed against a correctly migrated database:

```
FAIL  the credential names the institute that issued it  (organizationName null)
FAIL  the credential names the instructor who signed it off  (instructorName null)
```

A student's credential page showed "A training provider" and "the instructor who recorded
this is no longer on the platform" for a credential that had been signed off seconds
earlier by an account that demonstrably still existed.

### Root cause, in two parts

`listStudentCredentials` read attribution straight off two columns of `profiles`:

```ts
organizationName: profiles.organizationName,
instructorName:   issuerProfile.fullName,
```

Both are **optional**, and both are on a table that only one code path ever writes.

**First: the columns are optional.** A training provider who registered and never filled
in an organization name has `organization_name = NULL`, so the credential named no
institution. Nobody had done anything wrong; the design simply assumed a field that is not
required.

**Second, and this is the one that produced the live failure: `profiles` rows are created
only by `/auth/register`.** `apps/api/src/modules/auth/service.ts` inserts the row; the
`on_auth_user_created` trigger that mirrors the role claim into `public.users` does not. So
any account provisioned another way - an administrator writing the claim, a service-role
`createUser`, the fixture path the live suite uses - has a name in `auth.users` and **no
`profiles` row at all**. Every profile column joined null.

This is the same class of defect as E-027, which fixed the *write* path for accounts
provisioned outside registration. The *read* path had the same blind spot and it was not
noticed until an account of that shape read a credential.

The consequence is worse than a cosmetic null. `doc/08` requires an endorsement to be
attributable, because an unattributed claim is exactly what the platform exists to make
attributable. The failure was reached by doing nothing at all, which is the worst way for a
guarantee to break.

### What was done

Attribution now resolves through an explicit three-tier chain in
`apps/api/src/modules/trainers/attribution.ts`:

1. `profiles.organization_name` - what the provider called their institute.
2. `profiles.full_name` - the account name, used for both fields when no organization was
   recorded.
3. `auth.users.raw_user_meta_data ->> 'full_name'` - the account's own name in the
   authoritative identity store, which every account has.

Tier 3 is a *read* of Supabase Auth, not a duplication of it into a second table, so
`doc/06` §2's single-source rule holds. It is no less trustworthy than tier 2: both are
display names the holder may edit, and neither carries an authorization decision - the role
that decides what an account may do is read from the server-controlled
`app_metadata.role` claim, never from a name.

Two things the resolver deliberately does not do, both of which would have been the wrong
fix:

* **It does not invent an institution.** No fallback to the skill name, the milestone
  title, or anything derived from the credential. A plausible-looking institution derived
  from the record would be indistinguishable from a real one, which is strictly worse than
  an honest "a training provider".
* **It does not claim a deleted account when the name is merely blank.** The two absences
  are different and the UI distinguishes them, rather than telling a student an instructor
  had left the platform when they had simply not named themselves.

`organizationNameFor` - used by the roster, the dashboard, and the notification a student
receives - was given the same fallback, so those three surfaces cannot name three different
institutions. The student's card also stops printing the same name twice when the
institution and the signatory resolve to one account, which is the usual case for a small
institute.

### The pre-flight check, which was also wrong

Independently, the suite's pre-flight reported the credential enum absent against a
database where it demonstrably existed. The query was unscoped:

```sql
select exists (select 1 from pg_type where typname = 'micro_credential_status')
```

`pg_type` is cluster-wide, so a type of that name in *any* schema satisfies it. The check
was not reporting a false negative for that reason alone - the real cause was that the
message was never updated after the migration succeeded - but the check itself was weaker
than it read. It is now scoped to `public`, matching the `to_regclass('public....')` form
every other check in the suite uses, and it additionally asserts the enum's *values*:

```
PASS  the enum carries exactly awaiting_student, accepted and declined
PASS  the enum has no "verified" or "issued" value
```

The second assertion is the one that matters. A migration creating the type with a
`verified` or `issued` value would pass an existence check and break the dual-backing
guarantee at the storage layer, where no service-level test could see it.

### A note on the removal queue, investigated and deliberately not changed

The suite reports nine `orphaned_proof_media` rows whose objects no longer exist. Verified
against production rather than assumed:

* 9 rows, **0 objects present** in the bucket.
* All 9 uploaders' accounts are deleted.
* All 9 date from 2026-10-11, a single earlier test run.

So this is not a leak. `orphaned_proof_media` is a work queue written by the account-
deletion trigger when SQL cannot reach storage; a row whose object is gone means the
removal already happened and the row is a **completed record**. Deleting them would be a
database write against the only evidence that those deletions finished, which is the one
thing the table exists to provide. Left alone, and the note now reports the drained/pending
split so an operator can tell a finished queue from a real backlog.

### Verification

* `attribution.test.ts`: 17 tests, including the two regressions restated as assertions -
  a blank organization name, and a provider with no profile row at all. Removing either
  tier fails the unit suite, not only the live one.
* Live suite: **463 passed, 0 failed**, up from 456/2. The two failing assertions now pass,
  and five further assertions were added around them: the name is the account's name and
  nothing derived from the credential, the named account really exists with the
  `training_provider` role, and no non-issuer id appears anywhere in the payload.
* Lint, unit (58), typecheck, build, security (93), fraud (95), integrity (54) and the
  secret scrub all pass.

### The honest limitation

Attribution is resolved at read time, so a provider who renames themselves re-labels every
credential they have ever issued. Snapshotting the issuer onto the row at signing time is
the correct fix and needs a migration, which was not authorised. Recorded here rather than
assumed away.
---

## E-055: A capability could be self-granted, defeating the business approval entirely

* **Status:** Open — fixed in code, **not verified against a database**
* **Found:** 2026-10-16, during review of the `0012` capability work, before any live run.

### Description
`capabilities/service.ts` exported a single `grant(userId, capability, source)` used by every
caller, and it had no self-service gate. `POST /auth/capabilities` called it with `source: 'self'`,
so a request naming `employer` inserted an `employer` capability row for the caller and returned
`201`.

That makes the whole business entity decorative. Employer rights exist because somebody vetted the
organisation; a self-declared one is the original problem restated. The same held for `trainee`,
which was supposed to require an institutional enrolment.

### Why the fix is in the service and not the route
`grant()` is *deliberately* unguarded — enrolment and business approval need to grant a capability
the person could not grant themselves, and that difference between the two is what an approval
means. So the gate went into a separate function, `activateSelfService()`, which is the only entry
point the route uses and which refuses anything not in `SELF_SERVICE`. A gate written only in a
handler is one forgotten import away from being bypassed by the next route that calls `grant()`
directly.

### Verification
Six live assertions added: `employer` and `trainee` are each refused with `403`, the refused
self-grant leaves the capability set unchanged, and `admin` is still rejected at validation as a
value that is not a capability at all. **These cannot run until migration `0012` is applied.**

---

## E-056: Business membership could be granted by any signed-in account

* **Status:** Open — fixed in code, **not verified against a database**
* **Found:** 2026-10-16, same review as E-055.

### Description
`POST /businesses/:businessId/members` took a business id from the URL and a user id from the body
and passed both to `addMember()` without checking that the caller owned that business. Any
signed-in account could therefore name any approved business and any colleague, create the
membership, and grant that colleague `employer`.

The same function also let an existing *member* add further members. A member who can grow the set
of people who may hire defeats the review the approval represents.

### Fix
`addMember()` now takes the caller's id and requires `business.ownerUserId === callerId` —
owner, not member. It throws `403` rather than `404`, because the caller has already proved they
are signed in and answering "no such business" to one they do not own would confirm the id exists
to somebody probing for it. The check is in the service so every caller inherits it.

### Verification
Two live assertions: an account cannot add itself to somebody else's business, and the refused
request grants no hiring capability. **They cannot run until migration `0012` is applied.**

---

## E-057: A rejected business would have silently removed a pre-existing employer's access

* **Status:** Open — fixed in code, **not verified against a database**
* **Found:** 2026-10-16, same review.

### Description
Migration `0012` promises that nobody loses access they have today. Business approval revokes the
owner's `employer` capability when a business is rejected, which is right for somebody who
earned it through a business.

It is wrong for an account that already held `employer` before the migration. That person holds it
with `grant_source = 'legacy'`, and a rejected business would have taken it away — breaking the
one promise the backfill makes, for a business being turned down rather than their account being
cancelled. The original code wrapped the revoke in a `try`/`catch`, which does not help: `revoke()`
only throws when the capability is absent, so it succeeded and removed the grant.

### Fix
The revoke now reads the capability row first and returns unless `grant_source = 'business'`. A
legacy grant is left alone.

---

## E-058: The 0012 code cannot serve any request until its migration is applied

* **Status:** Accepted
* **Found:** 2026-10-16, first live run after the change.

### Description
`authenticate()` calls `listCapabilities()` on every authenticated request, and registration calls
it to build its response. Both query `public.user_capabilities`. Against a database without
migration `0012`, **every** authenticated request returns `500` and registration returns `500` —
the application is entirely non-functional, not merely degraded.

Confirmed live: `register returns 201` failed with `500`, and 28 assertions failed as a
consequence, including the whole account-deletion section.

### Why it is not papered over with a shim
The obvious mitigation is to catch the missing-relation error and return an empty capability set.
That would convert a mass `500` into a mass `403`, which sounds safer and is not:

* it hides the missing migration behind plausible-looking authorisation denials, which is
  materially harder to diagnose than a `500` that says the relation does not exist; and
* a capability gate that quietly returns "nobody has any capability" is a gate that will one day
  do that in production for a reason nobody is looking for.

Failing loudly on a missing relation is the correct behaviour for a deployment that has gone wrong
in an obvious way, provided the ordering is stated.

### Mitigation
**Apply migration `0012_multi_capability.sql` before deploying the code that needs it.** There is
then no window in which the two disagree. This is a deployment-ordering requirement, not a code
change, and it is recorded in the deployment notes. The live suite has a pre-flight check that
reports "apply migration 0012_multi_capability" rather than aborting part-way, and the capability
sections skip themselves when it is absent.

---

## E-059: Business records are keyed on the person, not the business

* **Status:** Accepted
* **Found:** 2026-10-16, during the `0012` design.

### Description
Employer job specs, saved candidates and invitations remain keyed on `users.id` rather than on
`businesses.id`. Somebody who runs two businesses sees one set of employer records.

### Why it was left
The agreed design asked for a *simple* business workspace, and the capability model is the part
that has to be right: one account, several authorised areas, hiring behind a vetted organisation.
Threading `business_id` through five tables, every query that reads them, and every saved
shortlist is a much larger change to a working, tested module, made for a case the design does not
name.

The business is still real: it is the authorisation vehicle and the display identity, and the
employer capability genuinely follows an approved one. If two-business separation is ever needed
it is a migration on top of this one, not a rewrite of it.

---

## E-060: The trainee backfill would have failed the whole migration at the worst moment

* **Status:** Resolved — found by dry run, fixed, re-verified
* **Found:** 2026-10-17, applying `0012` inside a transaction against the live database and
  rolling it back.

### Description
```sql
INSERT INTO public.user_capabilities (user_id, capability, grant_source, granted_at)
SELECT DISTINCT ts.student_id, 'trainee', 'enrolment', ts.enrolled_at
  FROM public.trainer_students ts
ON CONFLICT (user_id, capability) DO NOTHING;
```
fails with `column "capability" is of type user_capability but expression is of type text`.

Under `SELECT DISTINCT` an unadorned string literal is resolved to `text` rather than to the
column's enum type, so the target-type propagation from the `INSERT` does not reach it.

### Why it is the worst possible statement to get wrong
The live database has **zero enrolments**. This statement therefore inserts nothing — but it
fails at parse time regardless of matching rows. It sits thirteenth in the migration, so the
twelve statements before it — including the type and table creation — had already run. Written
any other way, this would have aborted the migration two-thirds of the way through, against a
production database, at the point of maximum exposure. Drizzle runs a migration in a
transaction so nothing would have been left half-applied, but the deploy would have failed at
the worst moment and the cause would have looked like a schema conflict rather than a cast.

### Fix
The literals are cast explicitly (`'trainee'::public.user_capability`,
`'enrolment'::public.capability_grant_source`), as is `'legacy'` in the other backfill for the
same reason. Verified: the migration now applies end to end.

### The lesson, which is why this is recorded at all
The same class of defect is **E-002**, fixed on 2026-10-08 by migration `0002` when the
`0001` trigger assigned a `text` expression to the `user_role` enum column. It has now
happened twice, in the same codebase, in the same month of work. A dry run against the real
database — `BEGIN; <migration>; <verify>; ROLLBACK;` — caught both. Neither a unit test nor a
typecheck can see this class of defect, because it is a question about how the PostgreSQL
parser resolves types, not about what any TypeScript says.

---

## E-061: `min(uuid)` does not exist, and the statement failed regardless of matching rows

* **Status:** Resolved — found by dry run, fixed, re-verified
* **Found:** 2026-10-17, immediately after E-060, in the same dry run.

### Description
```sql
UPDATE public.user_capabilities c
   SET granted_by = ( SELECT min(ts.trainer_id) FROM public.trainer_students ts
                       WHERE ts.student_id = c.user_id )
 WHERE c.capability = 'trainee' AND c.grant_source = 'enrolment' AND c.granted_by IS NULL;
```
fails with `function min(uuid) does not exist`.

PostgreSQL defines `min()` for numbers, strings, dates and arrays — **not** for `uuid`. There
is no `max(uuid)` either. This was assumed rather than checked, and it is invisible to every
tool in this repository: it is not a type error, because `ts.trainer_id` really is a `uuid`.

### Why it is worse than it looks
Like E-060, this statement matches zero rows on the live database (no enrolments) and would
still have failed, because function resolution happens during parsing. Two independent
migration-stopping defects, in the two statements a developer would most reasonably assume were
the safest in the file.

### Fix
`ORDER BY ts.trainer_id LIMIT 1` in a scalar subquery. A student enrolled by two institutes has
two legitimate grantors and only one is recorded; that is a deliberate simplification, and the
lowest id is at least deterministic for a value nothing is meant to depend on.

---

## E-062: There is no zero-downtime ordering for this change

* **Status:** Resolved by splitting the migration
* **Found:** 2026-10-17, while preparing the production release sequence.

### Description
The change makes two demands on the database that cannot both be met at once:

* the **currently deployed** application reads `public.users.role` in five places, one of
  which — `GET /auth/me` — the web layout reads on **every signed-in page**; and
* the **new** application reads `public.user_capabilities` on every authenticated request,
  because `authenticate()` loads the capability set before any guard runs.

So applying the migration first breaks the running application, and deploying the code first
breaks it too, in mirror image. There is no ordering of two steps that avoids an outage.

### Fix: expand / contract, in three steps with no window
The migration was split. `0012_multi_capability.sql` only *adds* — enum, three tables,
backfill, RLS — and deliberately keeps `users.role`. `0013_drop_user_role.sql` removes it, and
must not run until the new code is deployed.

One detail made this safe rather than merely workable. Two triggers call `sync_user_role()`:
`on_auth_user_created` (AFTER INSERT) and `on_auth_user_role_changed` (AFTER UPDATE OF
`raw_app_meta_data`). The function `0012` installs therefore **both** grants the capability
**and** keeps `users.role` mirrored, byte-for-byte in behaviour. Without that, replacing the
trigger during the expand phase would have left the column the deployed application reads
quietly going stale — a silent wrong-answer bug rather than a visible outage, which is worse.
`0013` then replaces the function with the capability-only version and drops the column.

### Verified by dry run against the live database, 2026-10-17
| Assertion | Result |
|---|---|
| `0012` applies | clean |
| `users.role` still present after `0012` | true — the old application is unaffected |
| trigger still mirrors `users.role` | true |
| `user_capabilities` rows available to the new code | 9 |
| changing a role claim still updates `users.role` | `worker` → `employer` (old behaviour preserved) |
| the same change is additive, revoking nothing | `[worker, employer]` |
| `0012` then `0013` applies | clean |
| `users.role` present after `0013` | false |
| capabilities after `0013` | 6 worker, 2 employer, 1 training_provider |
| orphaned capabilities | 0 |
| `employer_approvals` foreign keys | both intact |

---

## E-063: A recent recoverable backup could not be verified

* **Status:** Open — **blocking the migration**
* **Found:** 2026-10-17, before applying anything to the live database.

### Description
Applying `0012` and `0013` to a live project requires certainty that the database can be put
back. That certainty could not be established from this environment.

### What was checked
* No Supabase personal access token: none in `.env`, none at `~/.supabase/access-token`
* No Supabase CLI installed
* No management API or dashboard access
* The available credentials are data-plane only — `DATABASE_URL`, the service-role key and
  the anon key — and none of them can report backup state

### What was established, and what it is not
`archive_mode = on`, `archive_command` is a `wal-g` push via `admin-mgr`, `archive_mode`
healthy with **992 segments archived, 0 failures**, most recent 17 minutes before the check.

This is strong evidence that the **mechanism** behind point-in-time recovery is running and
healthy. It is **not** verification that a backup exists. The following remain unknown and are
not derivable from inside the database:

1. whether managed backups or PITR are enabled **on the project** — `archive_mode` is the
   mechanism, not the service;
2. the **retention window**, so it cannot even be said whether a backup from today exists;
3. whether any backup has actually **completed** and been catalogued;
4. whether a restore has ever been **tested** — the decisive one, since an untested backup is
   not a proven-recoverable backup.

### Why this is blocking rather than noted
The instruction was to stop before executing if a recent recoverable backup cannot be verified.
It cannot be, so nothing was applied. Every check in this entry was read-only, and both
migrations were verified inside transactions that were rolled back — the database is
byte-for-byte as it was found.

### Partial mitigation, and its limit
The single most alarming step, `DROP COLUMN users.role`, is **recoverable without a backup**,
because the value is derivable from the new table:

```sql
ALTER TABLE public.users ADD COLUMN role public.user_role;
UPDATE public.users u SET role = (
  SELECT c.capability::user_role FROM public.user_capabilities c
   WHERE c.user_id = u.id ORDER BY c.granted_at DESC LIMIT 1);
```

That restores the column, and the backfill records the original `granted_at` from
`users.created_at`, so a single-capability account restores exactly. It is a convenience, not
a safety net: it protects only the dropped column, and it protects against nothing else —
including any accidental write to or deletion of the other sixteen tables. **It does not
substitute for a verified backup.**

---

## E-064: Enrolment was behind the capability it grants — student-first enrolment was impossible

* **Status:** Resolved — found by the live suite, fixed, verified
* **Found:** 2026-10-17, first full live run after `0012` was applied.

### Description
The enrolment-code redemption route sat on `studentCredentialRouter`, which migration `0012`
had gated on `authorize('worker', 'trainee')`. Redeeming a code is what *grants* `trainee`, so
a person who had neither capability got `403`.

That is a chicken-and-egg that defeats the entire point of the change: somebody joining an
institute before their first paid job is the ordinary case, and the agreed design says
explicitly that "a student with no qualifying verified work must not become searchable". A
person with no work could not become a student at all.

The live suite caught it as four linked failures — enrolment `403`, no `trainee` granted, no
institute recorded as grantor, and the credential read refused.

### Fix
Enrolment moved to its own router, `studentEnrolmentRouter`, guarded by `authenticate` alone,
mounted **before** `studentCredentialRouter` so the prefix does not swallow it.

A session-only guard is correct here because **the enrolment code is the authorisation**:

* codes are written only by `training_provider` accounts and stored as a SHA-256 digest, so
  one cannot be guessed from the table;
* a wrong code matches nothing and grants nothing;
* what a valid code grants is `trainee`, which reaches a person's own credential records and
  nothing else.

Anyone signed in may therefore *attempt* a redemption, and the worst an attempt achieves
without a real code is a failed lookup — the same exposure as any credential-verification
endpoint.

### Why the ordering matters
Express matches routers in mount order. Had `studentCredentialRouter` stayed mounted first,
`/workers/enrolment` would still be captured by the `worker`/`trainee` guard and the fix would
have looked applied while changing nothing. The order is commented at the mount site.

---

## E-065: Four security assertions were silently skipping

* **Status:** Resolved
* **Found:** 2026-10-17, while reviewing which of the new assertions had actually executed.

### Description
Two guards in the new multi-capability section were never satisfied, so the assertions inside
them did not run and could not fail:

1. The escalation block was wrapped in `if (escalateToken)`. The escalate account was
   registered but **never email-confirmed**, so sign-in returned `401`, no token was issued,
   and four assertions — including *"an account that asked for 'admin' cannot reach the admin
   surface"* — never executed. The suite reported `531 passed` while quietly skipping the most
   security-relevant checks in the change.
2. The public-portfolio assertion was wrapped in `if (slug)`. `mintAccount` provisions through
   the auth admin API, which creates `public.users` but **not** `profiles`, so the
   `UPDATE … RETURNING` matched nothing. The check guarding the single highest-risk line in the
   whole migration — that a person with two capabilities keeps their public page — never ran.

### Fix
Both guards removed rather than merely satisfied, so a future breakage fails loudly:

* the escalate account is confirmed before sign-in, and there is now an explicit assertion
  that the sign-in worked, so the block cannot be entered silently;
* a `profiles` row is created for the fixture first, and the slug itself is asserted rather
  than branched on.

The assertions now report `PASS` and the portfolio check has a companion that reads the page
twice.

### The rule
A conditional wrapper around an assertion converts it into documentation. The live suite
already says this in its own comments — *"a security assertion that cannot fail"* was the
defect class behind the `0000` check — and it applied to the new code too.

---

## E-066: The escalation account leaked on every run

* **Status:** Resolved
* **Found:** 2026-10-17, same session.

### Description
The `wants-admin` account created by the escalation test was never pushed onto `createdUsers`,
so cleanup did not remove it. Every run left one account behind, and the pre-flight leftover
check reported `FAIL … (1 removed)` permanently — self-healing only because the *next* run's
pre-flight deleted it.

### Why it mattered beyond the noise
The leftover check is the suite's own signal that it cleans up after itself. A permanent
failure there trains a reader to ignore it, which is exactly when a *real* leak would go
unnoticed. The fix registers the id for cleanup immediately after it is read.

Verified: `531 passed, 0 failed`, and zero `smoke.%` accounts remain afterwards.

---

## E-067: A PowerShell edit corrupted `package.json`

* **Status:** Resolved
* **Found:** 2026-10-17, while adding the export/restore npm scripts.

### Description
`ConvertFrom-Json` → `ConvertTo-Json` → `Set-Content -Encoding utf8` did two damaging things:

* Windows PowerShell 5.1's `utf8` writes a **byte-order mark**, and Node's JSON parser rejects
  it — `SyntaxError: C:\PROJECTS\TetherProof\package.json`.
* `ConvertTo-Json` reformatted the whole file: a 51-insertion, 49-deletion diff for what should
  have been two added lines.

Every `npm` command in the repository failed until this was caught.

### Fix
`git checkout HEAD -- package.json`, then the two scripts added with a targeted edit. The diff
is now the intended 2 lines and nothing else.

### The rule
Never round-trip a repository JSON file through PowerShell. Use a targeted edit. The BOM is
the loud failure; the silent whole-file reformat is the one that would have ended up in a
commit.

---

## E-068: A floating switcher was built, then replaced by a header control

* **Status:** Resolved — built and removed within the same working session
* **Found:** 2026-10-17, while implementing role switching.

### Description
The first implementation put a pinned circular button near the bottom-right corner on
phones, opening a bottom sheet of capabilities — the WhatsApp compose-button pattern. The
owner then chose a header-based selector instead, on the grounds that the header is not
crowded and that a permanent floating control will eventually overlap whichever dashboard
control is added next.

### Resolution
`WorkspaceFab` was deleted rather than left disabled, and the control lives in the header at
every width. The reasoning is recorded here because the argument is worth keeping either way:

* a floating control has to live somewhere, and the bottom-right corner is where it competes
  with the bottom tab row for the thumb;
* the header already carries the section title and the account menu, so a role selector is
  not competing for space there;
* it gives the active role a permanent, identifiable home, which a floating `+` does not —
  a `+` says "add", and what this does is mostly "switch".

Nothing else changed: the navigation model, the setup pages and the capability service were
all independent of where the control was mounted.

### The responsive shape, since one control has to serve two very different screens
A dropdown anchored under a header button overflows a phone screen. So the panel is **one
element** whose positioning classes change at `md`: `fixed inset-x-0 bottom-0` with a scrim
and a drag handle on a phone, `absolute left-0 top-full` with no scrim on a desktop. One
implementation, two shapes, and no second component that could drift from the first.

---

## E-069: There was no persisted active role at all

* **Status:** Resolved
* **Found:** 2026-10-19, while working through the worker interface corrections.

### Description
The active role was derived from the URL, which is correct only while you are *inside* a
workspace. On `/profile`, `/settings`, `/notifications`, `/roles` and the setup pages,
nothing could be marked active — and the header either named the wrong role or gave up.

Worse, **two places computed it separately and disagreed**: the header used the address, and
the tab row assumed "the first capability you hold", read from a database query with no
`ORDER BY`. That is how a single page could show two roles highlighted, and how standing on
one role's setup page could tick a completely different role. Neither was a rendering bug;
both were two sources of truth.

It also meant the choice could not survive a refresh, because the URL was the only record of
it, and could not be restored after signing back in.

### Fix
`lib/server/active-role.ts` resolves it **once, on the server**:

1. the address wins when it names a workspace — a link, a notification or a pasted URL must
   land where it says;
2. otherwise the role remembered from last session, so a refresh on `/settings` or a
   sign-in opens where you left off;
3. otherwise the first capability held.

Every candidate is checked against the capabilities the database just returned, so a stale
or hand-edited cookie naming a role this account no longer holds falls through to one that
works rather than producing a broken header. `listCapabilities` also gained an `ORDER BY`,
because a list treated as a sequence must not depend on the planner.

Choosing a role is now a server action rather than a link: it records the preference and
rebuilds the navigation for that role, instead of moving only the label.

### Not a security change
The cookie is a **session preference**, not account data — httpOnly, cleared on sign out,
re-validated on every read. A tampered value can at worst change which of your own
workspaces opens first. Authorisation is untouched and still checked per route on the server.

13 tests pin the rules, including that the result does not depend on the order capabilities
arrive in, which was the old fallback's actual defect.

---

## E-070: Rejected work logs were labelled "Not confirmed"

* **Status:** Resolved
* **Found:** 2026-10-19.

### Description
`ProofListItemView` rendered a rejected proof as **"Not confirmed"**. That phrase describes
the *absence* of a confirmation, which is also true of a proof nobody has answered yet — so
a rejected log and an awaiting log read as the same state from the badge alone. The rest of
the app already said "Rejected" in two other places, so the list was also inconsistent with
its own siblings.

### Fix
The label is "Rejected", matching the wording already used elsewhere. Verified, awaiting and
rejected remain three distinct labels.

---

## E-071: Manual coordinate entry removed from every user-facing form

* **Status:** Resolved
* **Found:** 2026-10-19.

### Description
Latitude and longitude could be typed into the work-logging form (behind a "Type coordinates"
toggle), the worker profile, the employer organisation form, and capability setup.

Nothing underneath changed and nothing needed to: the coordinates are still stored, still
validated by the API, and still used for proximity search and the fraud model.

### Why removing them is a correction rather than a removal
The only reason a person ever entered a number was to say **"no location"**, and there is an
action for that. Typing a coordinate also admitted a class of error with no upside: a
mistyped pair is silently the wrong place, which is worse than no place, because a search
within the wrong radius returns plausible-looking results. Nothing in the old layout said
which of two six-digit numbers had been got wrong.

Each form keeps hidden inputs carrying exactly what the visible ones did, so the value
"Use my location" produces is submitted unchanged. A **Clear** action was added where the
removed inputs had been the only way to express no location — a real choice, since searches
then run without a distance filter.

---

## E-072: An individual work log fell through to the section header

* **Status:** Resolved
* **Found:** 2026-10-19.

### Description
`/logs/<id>` was absent from `SUBPAGE_TITLES`, so `subpageTitleFor` returned `null`, the app
treated it as a primary section, and it rendered the section header rather than the back
header. That is why a single log read as a browser page instead of the drill-down pattern
used by every other sub-page.

### Fix
Added as `'/logs/'` **with the trailing slash**, which matches an individual log and not the
list — the list is a primary destination with its own tab and keeps the section header.

`BackHeader` gained an optional `backTo`. An individual log always returns to `/logs` rather
than to browser history: it is one record reached from the list, so going back to wherever
the person happened to come from could strand them in the app with no route to the record
they were looking at. History remains the default everywhere else, because those pages are
genuinely reached from several places.
