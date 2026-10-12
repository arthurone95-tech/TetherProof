# 08-SECURITY-DOCUMENTATION.md

**Product:** TetherProof

## 1. Overview
This document outlines the security architecture, threat model mitigations, data privacy rules, and anti-fraud protocols for the verified capability platform. Security must be enforced rigorously at both the application and infrastructure layers.

---

## 2. Authentication & Authorization Security
* **Token Management:** Supabase Auth issues short-lived access tokens for session maintenance. Tokens are transmitted exclusively over HTTPS and are never written to logs.
* **Server-Controlled Roles:** The account role is written into the `app_metadata.role` claim at registration. `user_metadata` is editable by the account holder and therefore never carries an authorization decision.
* **Roles Cannot Be Self-Declared.** Public registration accepts only `worker`, `employer`, and `training_provider`. `admin` is excluded, because the endpoint writes the role into a server-controlled claim that `authorize('admin')` trusts — accepting `admin` from an unauthenticated caller was a complete privilege escalation, verified live before the fix (`doc/13` E-024). Administrators are provisioned by writing the claim against the auth record, an operation requiring service-role credentials that never reach a browser. Validating a role against the list of roles that exist is not the same as validating it against the list a stranger may claim.
* **Role-Based Access Control (RBAC):** Every API endpoint must enforce server-side role checks.  
  * `worker` roles cannot access employer search management or training provider tools.  
  * `employer` roles cannot access or modify worker capability proof logs directly.  
  * `training_provider` roles are restricted to institutional milestone issuance and demand analytics.
  * Role requirements are enforced at the router mount point, so the rule is a property of the route group rather than something each handler can forget to repeat. The employer approval gate is deliberately **not** middleware: it lives in the service layer so the rule holds however the route is reached.
* **Worker Identity Is Not An API Output.** No employer endpoint returns a worker id, name, email, phone number, or avatar. A search result carries an opaque, employer-scoped, expiring handle that resolves server-side and is inert for any other employer. Identity is revealed only to the employer the worker has accepted an invitation from — a one-directional reveal, because the worker is the one releasing their identity. Coordinates are never returned to anyone but their owner; search reports a distance in kilometres.
* **Account Deletion Works, With One Path That Only Records The Leak.** The two `ON DELETE restrict` foreign keys that made any worker with proof records undeletable were replaced with `set null` (migration `0005`, `doc/13` E-025/E-029), so an account holding work can now be deleted. What SQL cannot do is remove the uploaded bytes: a `BEFORE DELETE` trigger is refused from `storage.objects` by `storage.protect_delete()`, so the trigger instead scrubs every identifying column and writes the bucket and path to `public.orphaned_proof_media`. Removal is left to the Storage API, which `DELETE /auth/account` performs before answering (the response reports `mediaRemoved`/`mediaPending` rather than a bare success) and which the smoke suite drains. The residual exposure is an object left by a deletion that bypasses the application — a direct Supabase dashboard delete — which is queued for removal rather than silently lost, but is not removed at that moment. Tracked as `doc/13` E-025/E-029.
* **Row Level Security:** Enabled **and forced** on all application tables as a second, independent boundary. The browser only ever holds the public anon key, so a modified or careless client cannot read data belonging to another user. The API server holds the service-role key and is responsible for its own authorization.
  * `FORCE ROW LEVEL SECURITY` matters: it applies the policies to the table owner too, so a table cannot be protected by accident of ownership.
  * `anon` and `authenticated` hold **no grants at all** on the application tables. The service role is therefore the real boundary, and RLS is defence in depth behind it — not the thing standing between two users.
  * `candidate_handles` has no INSERT or UPDATE policy by design. The service role writes it, and a masked search result is only meaningful server-side.
* **Public Verification Tokens:** SMS and WhatsApp verification links use single-use tokens with short expiration windows to prevent replay attacks. Only a SHA-256 hash of the token is stored, so a leaked database row cannot be replayed.

---

## 3. Data Protection & PII Privacy
* **Zero-Knowledge Principle:** Employer candidate searches return anonymized tokens, aggregate proof counts, and trust scores. Personal Identifying Information (PII) such as full names, phone numbers, and direct contact details are strictly masked until a direct offer is mutually accepted.
* **Identity Data Ownership:** Credentials, email addresses, and phone numbers live in Supabase Auth and are not duplicated into application tables, which keeps identity data in one auditable place. The one derived value the application needs for the collusion filter is a salted hash of a client's phone number, never the number itself; see §4.
* **Storage Encryption:** All sensitive user records and transactional database entries must be encrypted at rest.
* **Media Sanitization:** Uploaded work proof images and audio files are stored in a private Supabase Storage bucket with EXIF location metadata and private organizational logos stripped before storage. Buckets are never public; access is granted through short-lived signed URLs, and object paths use unpredictable random identifiers. Uploaded content is restricted to an explicit type allow-list and a size cap, enforced in the API before any bytes are transmitted and again at the bucket itself.

### Account Deletion and Retention
Deleting an account keeps the work and removes the person, in the database rather than in an
application service. A service can be bypassed by the Supabase dashboard, by a migration, or by
the smoke suite; a privacy guarantee that holds on only one path is not a guarantee.

* **What is destroyed:** the `auth.users` row, the `public.users` row, and the `profiles` row -
  which is where the full name, phone, city, and coordinates live.
* **What is retained:** the worker's `capability_blocks` and `work_proof_logs`, detached from them
  by `ON DELETE set null` and stamped `anonymised_at`. Within those rows the description is
  overwritten, `submission_gps` and `media_url` are nulled, and `verifications.verifier_gps` is
  nulled. What survives is the skill tag, the verification outcome, the fraud score, and the
  timestamps.
* **Why retention rather than deletion:** the records are the proof network. Because an aggregate
  spans many people, deleting one worker's rows would also destroy a *different* worker's trust
  score. The skill tag in particular is deliberately not severed - it is what carries the record
  into the aggregate - so removing it would strip both records from every count.
* **`verifier_phone_hash` is deliberately retained.** It is a salted hash of a *third party's*
  number, not the worker's, and it is what lets the collusion filter still recognise one client
  approving many proofs. Scrubbing it would make every verifier look new and silently disable a
  fraud check. The coordinate next to it has no such argument and is nulled.
* **Anonymised records are inert, and that is a real cost.** They no longer appear in employer
  search, because there is no account to address and minting a handle for one would be a fiction
  the `candidate_handles` foreign key rightly refuses. They are also excluded from the collusion
  graph, where a null worker identity would collapse every deleted worker into a single node and
  make a verifier look *more* diverse than they are - the filter would fail open on exactly the
  rings it exists to catch. The known limit of that choice is that a verifier whose apparent reach
  was built through workers who have since deleted their accounts now looks narrower than they
  are. Correcting for it needs approvals counted per distinct deleted account, which this
  retention policy deliberately does not keep.
* **A verification link for an anonymised record is refused** as already spent, so a link
  dispatched while the worker was on the platform cannot write an outcome onto a record they have
  since been released from. It is worded as spent rather than as an error about the worker, so a
  client is not told that an account was deleted.
* **The gap that is left, stated plainly:** SQL cannot delete a stored object.
  `storage.protect_delete()` refuses it - verified against the live project, not assumed - so
  nulling `media_url` removes the pointer while the bytes remain under a path that still begins
  with the worker's own user id. The migration records the affected paths in
  `orphaned_proof_media` rather than pretending otherwise, which makes the gap auditable instead
  of silent: an untracked object is indistinguishable from one that was never created.
* **Members delete their own account** through `DELETE /api/v1/auth/account` (`doc/07` §3.G).
  The endpoint takes no target in the path and none in the body, so there is no variant of it
  that can be pointed at somebody else. It deletes the account — which fires the trigger — then
  removes the quarantined objects through the Storage API and drains their queue rows, so the
  byte-level gap above is closed on the self-service path rather than merely recorded. It
  reports counts of removed and pending media instead of a bare success, because "deleted" would
  otherwise assert something about the bucket the database cannot verify. Signed out
  afterwards.
* **An operator deleting through the Supabase dashboard bypasses all of that.** The trigger
  still runs and the row still lands in `orphaned_proof_media`, but nothing removes the object.
  That is the intended shape of the gap: the database enforces what it can enforce, and the part
  it cannot is recorded rather than lost. Such rows sit in the table until they are drained.
  See `doc/13` E-029.

---

## 4. Anti-Fraud & Trust Protocol Security
* **Graph Centrality Engine:** Detects and mitigates closed-loop collusion (e.g., users mutually verifying friends). Verifications from isolated or repeated two-way connections are automatically down-weighted.
* **Verifier Identity Is Minimised:** Identifying a verifier well enough to detect a ring requires recognising repeat confirmations, but that does not require keeping the number. `verifications` holds only a salted SHA-256 of the normalised phone number, used exclusively to recognise that the same party confirmed several proofs. The number exists in memory for the length of one dispatch and is never written to any table or log. The salt lives in `VERIFIER_PHONE_SALT` and is required in production, because phone numbers have too little entropy for an unsalted digest to be protective. See `doc/13` E-022.
* **Location & Proximity Telemetry:** Compares the GPS coordinates logged by the worker during task submission with the GPS telemetry of the client device when confirming via the verification link, so a remote sign-off is recorded as such. A party who shares no location is scored **neutral**, never as a pass and never as a failure — otherwise the check could be switched off by withholding data, and privacy-respecting users would be penalised for declining.

  Verifier-supplied GPS is treated as a **claim**, not as proof of where the verifier was. It arrives in the same request as the answer, so the token holder fully controls it, and it carries the heaviest weight in the engine. That combination was a demonstrated defect: a single fabricated coordinate drove a well-formed submission exactly onto the block threshold and marked an honest worker's proof `fraud_blocked`, permanently, with no route back and with the client shown a cheerful `confirmed`. The shipped client sends no coordinates at all, so the value is only present when a caller chooses to supply it.
* **The Engine Withholds; It Does Not Accuse.** This is the central control, and it exists because of a second demonstrated defect. The families are not equally trustworthy — proximity is a self-declaration, media provenance is a consistency check on a file that ordinary re-compression routinely strips, and collusion is a graph shape a legitimate site supervisor produces by working one site all week. Each can be true of an honest worker and each can be arranged by someone aiming to make a competitor look bad. **Two weak signals agreeing is not two strong signals.** An earlier rule that treated two adverse families as corroboration simply moved the problem: an attacker supplying a forged ring and a bogus location still crossed it, while a legitimate remote verification on a re-compressed photo could too.

  So there are now three outcomes, and the mapping is deliberately asymmetric:

  | Outcome | Reached by | Counts as proof | Is an accusation |
  |---|---|---|---|
  | `verified` | score above the threshold | Yes | No |
  | `flagged` | any score at or below the threshold | **No** | **No** — a question, queued for a person |
  | `fraud_blocked` | an administrator upholding a review | No | **Yes** — and only a human may write it |

  `fraud_blocked` is unreachable from any score, in any code path. The engine's job is to decide what may be *trusted*, not to decide who is a liar. Withholding the record is the entire protective effect: the proof stops helping the worker and stops being held against them, and the damage is repairable.

  The bias is deliberately towards under-flagging rather than over-flagging. A missed ring is one bad record, still visible to the client who confirmed it; a false hold costs an honest worker real income.
* **Every Hold Is Disclosed and Reversible.** A worker is notified the moment a record is withheld, and the record itself carries `flagged_at`, a plain-language `flag_reason`, and the appeal state. The reason names the *kinds* of signal that fired and never their values: a worker can act on "the file you uploaded carried fewer capture details than a camera normally writes", and on nothing else. Publishing a score or a threshold would tell anyone with a grudge exactly how far to push.
* **Withheld Records Do Not Reach Employers.** A withheld record is excluded from `verifiedProofs`, from `trustScore`, from `lastVerifiedAt`, and from candidate eligibility. This matters: `trustScore` originally averaged every confirmed verification regardless of the proof's status, so a record the platform explicitly refused to call fraud was still permanently lowering a worker's score in an employer's search — and an overturned review restored the proof but not the number it had dragged down. Withholding had to mean withholding, everywhere, or the label change was cosmetic.
* **An Appeal Cannot Manufacture a Confirmation.** Reviewing a record corrects an integrity decision; it never creates a verification request or a second token. An overturn is refused unless the client actually confirmed, because turning "the client says this did not happen" into a badge would override the only party who was there rather than review anything. Decisions are terminal, are stored against the administrator's own session id rather than anything in the request body, and carry a `WHERE`-clause guard so two reviewers acting at once cannot both land.
* **Media Metadata Removal:** Uploaded proof media is scrubbed of EXIF, ICC, and embedded GPS data by the API before it reaches storage, so a photo cannot reveal where a worker or client was. Audio tag containers are stripped the same way. The worker's submitted coordinates are the only trusted location for a proof.
* **Media Provenance Signals:** Three booleans — whether a capture device was identified, whether the capture time was consistent with the submission, and whether the container matches its declared type — are derived from the metadata **while it exists**, then the metadata is destroyed and only the conclusions are kept. No make, model, serial number, or timestamp is retained anywhere, so the privacy guarantee is unchanged by the fraud signal existing at all.
* **Synthetic-Media Detection (not implemented, and not claimed):** Rejecting AI-generated or scraped media is not implemented. No metadata check can reliably distinguish a generated image from a real one, and nothing in the system asserts that it can. The provenance signals above are consistency checks, scored as weak evidence that can only *lower* a score — never raise it above neutral — and no upload is ever refused on their basis, because a heuristic that vetoes an honest worker's photo is worse than an honest `pending` status. Every proof records `metadata_status = 'pending'` and `flagged_ai_fake` is written nowhere. See `doc/13` E-019.
* **Why a hosted detector was rejected on evidence rather than overlooked.** Benchmarks published in 2026 report zero-shot accuracy spread across 16 detector families of 37 percentage points, and detection of current commercial generators at 18–30% — below chance-adjusted usefulness. An audit of five commercial tools found they declared **authentic** press photographs AI-generated between 6% and 40% of the time. Two consequences follow for this product. First, a detector cannot gate a worker's verification: the cost of a false block is a person losing real income, while a missed synthetic image is still visible to the recipient who is looking at the photograph. Second, integrating one would require transmitting a worker's evidence to an external processor, adding a data-flow and retention surface that `doc/08` §4 otherwise removes. What is implemented instead is a reader for C2PA Content Credentials (`apps/api/src/lib/media-provenance.ts`): a **declared** origin, cryptographically signed by the capturing device where present. A manifest that declares generative origin marks the file for human review and never blocks it; absence of a manifest is not a finding, because almost no real photograph carries one. This is a provenance reader, not a detector, and no false claim of detection is made anywhere in the system.
* **Explainable Decisions:** The per-signal breakdown behind every `fraud_score` is persisted in `fraud_score_detail`, and it **survives an appeal**. A decision that erases its own reasoning cannot be audited, and an appeal that erased the findings would let anyone clear a genuine finding by objecting to it.
* **Rejections Are Never Punitive:** A client reporting that work did not happen is recorded as `rejected` and is never scored and never withheld, however adverse the other signals look. Scoring rejections would let colluding clients manufacture free disputes against real workers.

---

## 5. Environment Variables & Secrets Management
* **No Hardcoded Secrets:** Private API keys, database credentials, and third-party service tokens (e.g., Twilio, payment gateways) must never be hardcoded in source files.
* **Environment Strategy:** All credentials must be loaded via secure environment variables (`.env`). The actual `.env` file must be excluded from version control via `.gitignore`.

---

## 6. HTTP Hardening: Headers, Origin Policy, and Abuse Limits

Every control in this section is enforced by the server rather than by the client, and each is
asserted by the smoke suite so it fails loudly if it is lost (`doc/13` E-039).

### 6.1 Response headers

Both applications set their own headers; neither relies on the other to do it.

| | API (`helmet`, since Phase 1) | Web client (`apps/web/next.config.ts`) |
| --- | --- | --- |
| MIME sniffing | `X-Content-Type-Options: nosniff` | `X-Content-Type-Options: nosniff` |
| Framing | `X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'` | `X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'` |
| Referrer | `Referrer-Policy: no-referrer` | `Referrer-Policy: no-referrer` |
| Transport | `Strict-Transport-Security: max-age=31536000; includeSubDomains` | same |
| Content Security Policy | full policy: `default-src 'self'`, `script-src 'self'`, `style-src 'self' https: 'unsafe-inline'`, `object-src 'none'`, `form-action 'self'`, `base-uri 'self'` | narrow by design: `frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'` |
| Capabilities | — | `Permissions-Policy: geolocation=(self), microphone=(self), camera=(self)` |
| Fingerprint | `X-Powered-By` disabled | `X-Powered-By` disabled |

Two deliberate asymmetries:

* **The client's CSP does not state `script-src`.** Next bootstraps hydration from inline scripts,
  so a strict script policy requires a per-request nonce threaded through middleware — a change that
  breaks pages in ways a header check cannot detect. The directives that are present are
  independent, and a browser applies those while leaving `script-src` unconstrained. A nonce policy
  is the right next step and belongs in its own change.
* **`SAMEORIGIN`, not `DENY`.** A same-origin frame is how the layout is inspected at a desktop
  width when no wide viewport is available; `DENY` would close that without protecting anything
  `frame-ancestors 'self'` does not.

`Referrer-Policy: no-referrer` exists because a verification link carries a bearer token in its
path: no page in this product needs to tell a third party where a reader came from.

### 6.2 Origin policy (CORS)

* Cross-origin reads are granted **only to origins listed in `CORS_ORIGINS`**, and the same list is
  what decides which origins may be pointed at by a confirmation link.
* Outside development, nothing else is granted — not loopback, not private ranges, not an absent
  `Origin`. In development, loopback and private-range origins are accepted as a convenience
  (`apps/api/src/lib/origin.ts`), because a browser is usually served from a port that changes.
* A request with no `Origin` is not a CORS request and is left alone.
* Refused origins receive **no `Access-Control-Allow-Origin` header at all** rather than a
  mismatched value, so the browser reports the refusal as a CORS failure with nothing to fall back
  on.

Observed in a production-mode run with `http://localhost:3000` configured: that origin echoed,
`http://localhost:3001`, `http://127.0.0.1:4200` and `https://evil.example.net` each received no
CORS headers, and a preflight from the configured origin returned `204` with methods and
credentials (`doc/13` E-035).

### 6.3 Rate limits

Per-IP, `express-rate-limit`, draft-7 headers (`RateLimit`, `RateLimit-Policy`), answered with
`429 RATE_LIMITED` and no detail about what remains:

| Bucket | Limit |
| --- | --- |
| Global, every route | 300 / 60s |
| Auth (`/auth/login`, `/auth/register`, code verification) | 10 / 15 min |
| Confirmation code submission | 5 / 15 min |
| Proof media upload | 20 / 15 min |
| Verification link fetch | 30 / 60s |

Registration deserves the client-side password check before the request is sent: 10 attempts per
15 minutes means a rejected password costs a real attempt, so the policy is validated in the form
first (`doc/13` E-030) and then again on the server, where it is authoritative.

### 6.4 Input validation

Request bodies, query strings and path parameters are validated with `zod` at the route boundary —
the same schemas the client pre-checks, so the two cannot drift. Media uploads are constrained by
declared MIME type and size, images are re-encoded before storage, and every write path runs
through `authorize()`.
