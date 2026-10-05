# 07-API-DOCUMENTATION.md

**Product:** TetherProof

## 1. Overview
This document defines the RESTful API endpoints, request payloads, response formats, and authentication rules for the verified capability platform. All endpoints enforce strict server-side validation and role-based access control (RBAC).

Sessions are issued by Supabase Auth and presented as `Authorization: Bearer <access_token>`. Field names in request bodies are camelCase.

---

## 2. Base URL & Versioning
* **Base URL:** `/api/v1`
* **Protocol:** HTTPS only
* **Content-Type:** `application/json`

---

## 3. Authentication Endpoints

Credentials are owned by Supabase Auth. These endpoints create accounts and exchange credentials for a session on the server, so the service-role key is never exposed to the browser and role claims are always written server-side.

### A. Register User
* **Endpoint:** `POST /api/v1/auth/register`
* **Description:** Registers a new user account (worker, employer, or training provider) in Supabase Auth and writes the server-controlled role claim.
* **Request Body:**
  ```json
  {
    "phoneNumber": "+233241234567",
    "email": "user@example.com",
    "password": "SecurePassword123!",
    "role": "worker",
    "fullName": "Ama Mensah"
  }
  ```
At least one of `phoneNumber` or `email` is required. Passwords must be at least 12 characters and include an uppercase letter, a lowercase letter, and a number.

Response (201 Created): Returns the user object and role, `session: null`, and a `confirmation` challenge. A session is not issued until the account is confirmed.

```json
{
  "user": { "id": "...", "role": "worker", "email": "user@example.com", "phone": "+233241234567" },
  "session": null,
  "confirmation": { "channel": "phone", "destination": "***567", "delivered": true }
}
```

`confirmation.channel` is `phone` when a phone number was supplied, otherwise `email`. `destination` is always masked. `delivered` is `false` when the messaging provider rejected the send; the account still exists and the caller can retry through **B**.

### B. Request Confirmation Code
* **Endpoint:** `POST /api/v1/auth/confirm/request`
* **Description:** Sends, or re-sends, a one-time sign-in code to an account that has not yet been confirmed. Use this when `delivered` was `false` at registration, or when the member did not receive the code.
* **Request Body:**
  ```json
  { "phoneNumber": "+233241234567" }
  ```
  A `phoneNumber` or an `email` is required, matching the value used at registration.
* **Rate limit:** 5 requests per 15 minutes per IP, tighter than the credential endpoints because each accepted request can cost an SMS or email.

Response (202 Accepted): Returns the masked destination and whether the message was dispatched. The status and shape are identical whether or not the account exists, so this endpoint cannot be used to discover which phone numbers or addresses are registered.

### C. Confirm Account
* **Endpoint:** `POST /api/v1/auth/confirm`
* **Description:** Exchanges a one-time code for a session and marks the proven channel as confirmed. This is what removes the need for an administrator to confirm new accounts by hand.
* **Request Body:**
  ```json
  { "phoneNumber": "+233241234567", "token": "123456" }
  ```
  `token` accepts either form of credential Supabase issues, because either Auth template may be enabled:

  * a short numeric code (6 to 10 digits) from the **Email OTP** / SMS template, sent as-is;
  * the longer token from a **Magic Link** email, which is also sent as-is.

  The two are not interchangeable in Supabase's API, so the endpoint routes on the shape of the value rather than on any client-supplied type.

* **Rate limit:** 10 requests per 15 minutes per IP. Looser than the send endpoint on purpose, so a mistyped 6-digit code does not lock someone out. Supabase additionally throttles verification attempts per token.

Response (200 OK): Returns the user, role, and a session, with `confirmation: null`.

Failure (400 `AUTH_CODE_INVALID`): A wrong, expired, or already-used token. Supabase reports all three identically and a single generic message is returned, so a caller cannot tell which they hit.

### D. Login User
* **Endpoint:** `POST /api/v1/auth/login`
* **Description:** Authenticates an existing, confirmed user through Supabase Auth and returns a session.
* **Request Body:**
  ```json
  {
    "phoneNumber": "+233241234567",
    "password": "SecurePassword123!"
  }
  ```
Response (200 OK): Returns the user object, role, and a session containing the access token, refresh token, and expiry. An unconfirmed account is refused with `401` until **C** succeeds.

### E. Current Profile
* **Endpoint:** `GET /api/v1/auth/me`
* **Description:** Returns the authenticated caller's profile and role.
* **Authorization:** `Authorization: Bearer <access_token>`

Response (200 OK): Returns the caller's id, role, full name, location, organization, and avatar.

This returns **no email address and no phone number**, by design. A page that needs contact
details has to ask for them deliberately through another endpoint rather than receiving them
by default alongside the profile. It does include `locationGps`, which is the caller's own
value, so a profile form can be prefilled with the location that was actually saved.

### F. Update Own Profile
* **Endpoint:** `PATCH /api/v1/auth/profile`
* **Description:** Updates the caller's own profile fields. Any field may be omitted to leave
  it unchanged.
* **Authorization:** `Authorization: Bearer <access_token>`

* **Request Body:**
  ```json
  {
    "fullName": "Ama Mensah",
    "organizationName": "Accra Solar Ltd",
    "locationGps": "5.6037,-0.1870",
    "avatarUrl": "https://…"
  }
  ```

Response (200 OK): Returns the updated profile. This is an **upsert**, not an update: accounts
provisioned outside `/auth/register` — by an administrator or a service-role `createUser` —
never pass through the registration trigger and so have no `profiles` row at all. A plain
`UPDATE` against a missing row is a silent no-op that reports 404, which is indistinguishable
from "no such user". See `doc/13` E-027.

`locationGps` is a `"latitude,longitude"` string. **Coordinates are never returned to anyone
but their owner** — search reports a distance in kilometres and never a point. `locationCity`
is accepted by no endpoint and always reads `null`; see `doc/13` E-024.

> **Prerequisite:** Endpoints **B** and **C** depend on an email or SMS provider being configured in the Supabase Auth dashboard. Without one, `delivered` is always `false` and codes are never received.

### G. Delete Own Account
* **Endpoint:** `DELETE /api/v1/auth/account`
* **Description:** Deletes the caller's own account permanently and anonymises the work they leave behind.
* **Authorization:** `Authorization: Bearer <access_token>`

* **Request Body:** None. The endpoint takes no target — no id in the path and no id in the
  body — because a self-service deletion endpoint that accepts an identifier is an
  account-takeover primitive the moment one is guessed.

Response (200 OK):

```json
{
  "mediaRemoved": 1,
  "mediaPending": 0
}
```

The counts are deliberate. "Deleted" would assert two things — that the account is gone, and
that nothing identifying remains — and the second is not something the database can guarantee
on its own, since SQL is refused by storage. The endpoint measures both and reports them, so a
caller is never told a clean result the bucket does not agree with.

| Outcome | Meaning |
| --- | --- |
| `mediaRemoved` | Stored objects confirmed removed through the Storage API. |
| `mediaPending` | Objects still in the bucket, left in `orphaned_proof_media` rather than forgotten. A backlog to drain, not a retry signal. |

**What happens:** the `auth.users` row is deleted, which cascades to `public.users` and fires
the `BEFORE DELETE` anonymisation trigger (`doc/06`). The profile goes with it. The worker's
proofs and capability blocks are retained with the identifying columns cleared and
`anonymised_at` set, and the quarantined object paths are then removed through the Storage API
and their queue rows deleted. `401` without a valid session, and the session is invalidated
afterwards.

See `doc/13` E-025 and E-029 for why deletion anonymises rather than cascading, and `doc/08`
for the retention policy in full.

---

## 4. Worker & Proof Ingestion Endpoints

### A. Log Work Proof
* **Endpoint:** `POST /api/v1/workers/proofs`
* **Description:** Allows a worker to submit a completed task proof (voice/photo log). Requires worker authorization.
* **Request Body (Multipart Form-Data):**
  ```json
  {
    "skillTag": "Refrigeration Repair",
    "description": "Replaced commercial compressor and fixed electrical fault.",
    "submissionGps": "5.6037,-0.1870",
    "verifierPhone": "+233241234567"
  }
  ```
`media_file` is uploaded as multipart binary to a private Supabase Storage bucket, and must be
present. Accepted types are `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `audio/mpeg`,
`audio/mp4`, and `audio/aac`. Files are size-capped by `STORAGE_MAX_UPLOAD_BYTES`, and stored
object paths use unpredictable random identifiers under the worker's own folder. The same
allow-list and cap are applied a second time at the bucket, so a request that somehow bypassed
the API would still be refused.

Every upload is scrubbed of metadata before it is stored:

* **Images are re-encoded** by sharp, which drops EXIF, ICC, and any embedded GPS block by
  construction. The declared content type is not trusted on its own: the bytes must decode as the
  container that type claims, so a file cannot be smuggled past the allow-list by mislabelling
  itself.
* **Audio tag containers are cut out** — ID3v2 and ID3v1 from MP3, and the `udta`/`meta` atoms,
  including the `©xyz` location atom, from MP4-family containers. Sample offset tables are
  repointed after removal so the audio still plays.
* **WebM is not accepted.** Its metadata lives in an EBML element that cannot be removed without
  re-muxing the container, which would require an external binary. Storing it with location data
  intact would contradict the scrubbing guarantee, so the format is refused rather than stored
  unsanitised.

`submissionGps` is the only trusted location for a proof, which is precisely why the file's own
location metadata is removed. Coordinates are range-checked, so `999,999` is rejected.

`verifierPhone` is optional. It is the number the confirmation link is sent to. **Only a salted
hash is stored** — the number itself is used once, to address the message, and is never written
to any table or log. See `doc/08` §4.

Response (201 Created):

```json
{
  "proofId": "uuid",
  "skillTag": "Refrigeration Repair",
  "capabilityBlockId": "uuid",
  "metadataStatus": "pending",
  "scrubbed": { "hadGps": true, "hadMetadata": true, "hadAudioTags": false },
  "verificationToken": "returned-once-only",
  "verificationExpiresAt": "2026-10-11T12:00:00.000Z",
  "verificationLinkSent": false
}
```

`metadataStatus` is always `pending`. Scrubbing removes location data; it does not assess whether
the media is genuine. Detecting synthetic media is not implemented and is not claimed — see
`doc/02` Feature 2.4. `scrubbed` reports what was actually removed, so a caller can see the
protection that was applied rather than take it on trust.

Only the SHA-256 hash of `verificationToken` is stored, and it is returned exactly once.

`verificationLinkSent` reports whether a messaging provider accepted the link. **A `false` here is
not an error and does not fail the request.** Dispatch is skipped when no `verifierPhone` was
supplied, when `WEB_BASE_URL` is unset so no link can be built, or when the provider declined; all
three are indistinguishable from the worker's side, which is the point. The token is in the
response either way, so share it manually. The outcome is recorded on the verification row
(`dispatch_status`), so a link that never arrived is visible rather than mysterious.

---

## 5. Verification Endpoints (SMS Loop)

### A. Get Verification Details
* **Endpoint:** `GET /api/v1/verifications/{token}`
* **Description:** Public endpoint accessed via the SMS web link by clients to view task confirmation details.

Response (200 OK): Returns task summary and worker skill category without exposing private PII.
Deliberately excludes worker identity, the verifier's phone number, GPS telemetry, the fraud
score, and media URLs, which would leak PII or let a link holder probe the trust engine.

### B. Submit Client Confirmation
* **Endpoint:** `POST /api/v1/verifications/{token}`
* **Description:** Submits the client's "Yes/No" confirmation response along with device telemetry. The link is single-use; a second submission returns `409`.
* **Request Body:**
  ```json
  {
    "response": "confirmed",
    "verifierGps": "5.6039,-0.1872"
  }
  ```
`response` must be `confirmed` or `rejected`. `verifierGps` is optional and range-checked by the
same validator used on submission, so `999,999` is refused here too. Omitting it is normal: a
client who declined to share a location yields `proximity_status = 'unavailable'`, which is an
absence of evidence and is never scored as either a pass or a failure.

Response (200 OK):

```json
{
  "status": "confirmed",
  "skillTag": "Refrigeration Repair",
  "fraudScore": 0.75,
  "verificationStatus": "verified"
}
```

The trust engine runs synchronously **before** the proof status is written, so a `fraud_blocked`
verdict is never briefly overwritten with `verified`. The score combines proximity (strongest,
being the only signal grounded in an independent physical fact), endorsement diversity, and
media provenance (weakest, since both rest on data a motivated party controls). Missing signals
contribute nothing in either direction, so withholding data is not a way to defeat the engine.

`verificationStatus` is `verified`, `rejected`, or `fraud_blocked`. Note that `status` reports what
the **client** did, which is not always what happened to the **proof**: a client confirming from
another continent gets `status: "confirmed"` — they did confirm it — alongside
`verificationStatus: "fraud_blocked"`, because the endorsement does not count.

A `rejected` response is never scored and never blocked, whatever the other signals say.
Scoring rejections would let colluding clients manufacture free disputes against real workers.

Possible errors: `400` invalid response or malformed coordinates, `404` invalid link, `409` link
already used, `410` link expired.

---

## 6. Employer & Matching Endpoints

All endpoints here are role-scoped at the router, so the requirement is a property of the mount
point rather than something each handler re-checks. Employer routes require `employer`, the
invitation inbox requires `worker`, and the approval route requires `admin`.

**The approval gate.** An employer may read and search as soon as the account exists. Sending
an invitation waits for approval, because that is the action that contacts a real person who
did not ask to be contacted. The gate lives in the service layer, not in middleware, so it
holds however the route is reached.

### A. Own Approval State
* **Endpoint:** `GET /api/v1/employers/approval`
* **Description:** The caller's own review state, so a disabled control can be explained
  instead of leaving the employer to guess.
* **Authorization:** `Authorization: Bearer <access_token>`, employer role.

Response (200 OK):
```json
{
  "status": "approved",
  "record": {
    "employerId": "…",
    "status": "approved",
    "reviewedBy": null,
    "reviewedAt": "2026-10-05T09:12:00Z",
    "note": "Company documents checked."
  },
  "sending": { "eligibility": "eligible" }
}
```
`record` is `null` when no decision has been made, which behaves the same as `pending`.
`reviewedBy` is **always `null` in this response** — it is stripped deliberately. The employer
needs to know a decision was made and what it was; who made it is not theirs to see.

### B. Zero-Knowledge Talent Search
* **Endpoint:** `GET /api/v1/employers/search`
* **Description:** Searches verified workers and returns aggregate proof metrics with no
  worker identity. Open to unapproved employers.
* **Query Parameters:** `specId` (UUID, optional) to reuse a saved spec, or any of
  `requiredSkill`, `minProofThreshold`, `maxDistanceKm`, `referenceGps`, `limit` (1–100,
  default 25). Numeric values are coerced from strings, so this is usable as a plain form GET.

Response (200 OK):
```json
{
  "candidates": [
    {
      "candidateHandle": "9yo0q0Yl_XrrJIv4Wrk-tAo7pD0EmNv2TyO7IEdRiEU",
      "requiredSkill": "Solar Panel Installation",
      "verifiedProofs": 2,
      "trustScore": 0.71,
      "distanceKm": 0,
      "lastVerifiedAt": "2026-10-05T08:40:00Z"
    }
  ]
}
```
No field in this response identifies a worker: no id, name, email, phone, avatar, or
coordinate. `candidateHandle` is random, employer-scoped, and expires — it is only resolvable
by the employer that ran this search. `trustScore` is the mean fraud score of the verifications
backing those proofs, so a low number is good.

A worker who has not shared a location is **not** filtered out. Their card reports
`distanceKm: null` and is still actionable; an absent location is an absence of evidence, and
excluding those workers would hide most of a network that has not opted into geolocation.

### C. List, Create, Update, and Delete Specs
* `GET /api/v1/employers/specs` — the caller's own specs.
* `POST /api/v1/employers/specs` — create. **201** with the created spec.
  ```json
  { "requiredSkill": "Industrial Machine Operator", "minProofThreshold": 15, "maxDistanceKm": 20 }
  ```
* `PATCH /api/v1/employers/specs/:specId` — partial update, including `isActive` to pause a
  spec without deleting it. An empty body is refused.
* `DELETE /api/v1/employers/specs/:specId` — **204**. Invitations already sent keep a null
  reference to the spec rather than cascading away, so an employer cannot erase their own
  record of who they contacted by deleting the filter that found them.

`minProofThreshold` defaults to 1 and is capped at 500; `maxDistanceKm` defaults to 25 and is
capped at 20,000. The caps are deliberate: a threshold no worker could realistically reach
produces a filter that silently matches nothing forever, and refusing it at creation is kinder
than a saved spec that never fires.

### D. Send an Invitation
* **Endpoint:** `POST /api/v1/employers/offers`
* **Description:** Sends an invitation to a masked candidate card. Requires an approved account.
* **Request Body:**
  ```json
  {
    "candidateHandle": "9yo0q0Yl_XrrJIv4Wrk-tAo7pD0EmNv2TyO7IEdRiEU",
    "note": "We have a site in Tema, starting next month."
  }
  ```

The request schema has **no field for a worker id**, so a caller who obtained one cannot act
on it here even by accident. `note` is capped at 500 characters and is the only
employer-authored text a worker ever sees; it is always rendered as text, never as markup.

Response (201 Created): Returns the created invitation. Refused with `409` when an invitation
to that candidate is already awaiting a response, and with `403` when the account is not yet
approved.

### E. Sent Invitations
* **Endpoint:** `GET /api/v1/employers/offers`
* **Description:** Invitations this employer sent, with the workers they were addressed to.

Worker identity stays masked until the invitation is **accepted**. Before that the entry shows
only the skill and status; after it, the worker's name and contact details appear here and
nowhere else. The reveal is one-directional on purpose: the worker is choosing to be
contactable, and the employer has no reciprocal claim.

### F. Invitation Inbox (worker)
* `GET /api/v1/invites/offers` — invitations addressed to the signed-in worker, with a
  `pendingCount`. Each entry shows the employer's organization name and whether that account
  has been reviewed. The worker's own identity is never echoed back.
* `POST /api/v1/invites/offers/:offerId/respond` — records the answer:
  ```json
  { "response": "accepted" }
  ```

Answering an already-answered invitation is refused rather than overwritten, so a recorded
decision cannot be silently retracted; changing one's mind means a new invitation. Accepting is
the moment the worker releases their identity, which the interface states on the button rather
than letting it read as acknowledging a message.

### G. Record an Approval Decision (admin)
* **Endpoint:** `POST /api/v1/admin/employers/:employerId/approval`
* **Authorization:** admin role.
* **Request Body:**
  ```json
  { "status": "approved", "note": "Company documents checked." }
  ```

`status` accepts `approved`, `rejected`, and `pending`. `pending` is allowed as a reset so a
mistaken approval can be undone. The reviewer's id and the timestamp are stored rather than
inferred, because an approval that cannot be audited is not a control worth having.

> Administrators are provisioned by writing the role claim against the auth record. `admin` is
> deliberately **not** an accepted value for `POST /auth/register`; see `doc/13` E-024.

---

## 7. Standard Error Response Format
All error responses follow a consistent JSON structure:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid authentication token provided.",
    "status": 401
  }
}
```
