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
    "fullName": "Ama Mensah",
    "redirectOrigin": "https://app.example.com"
  }
  ```
At least one of `phoneNumber` or `email` is required. Passwords must be at least 12 characters and include an uppercase letter, a lowercase letter, and a number.

Those rules are defined once, in `passwordProblems()` in `@tetherproof/shared`, and both this schema and the web registration form check the same list — so the two cannot disagree about what is acceptable. A refusal comes back with its field-level reasons in `details` (see **§9**), which is how a client knows whether to correct the email or the password.

`redirectOrigin` is **optional**. It is the origin a confirmation link returns to when the member taps the link in their email, and becomes `${redirectOrigin}/auth/callback`. Supplied by the web client, which knows the origin the request actually arrived on; a caller talking to the API directly may omit it, in which case the API falls back to `NEXT_PUBLIC_SITE_URL`, then `WEB_BASE_URL`, then the first entry in `CORS_ORIGINS`, and finally to Supabase's own Site URL.

It is accepted only as an origin — `http` or `https`, no path, no credentials — and only when it is one of those configured origins, or a `localhost` / `127.0.0.1` address outside production. Anything else is refused with a field-level reason rather than dropped, because an unchecked value here turns every confirmation email into an open redirect carrying a session: an attacker who requested a code for somebody else's address would otherwise receive that person's tokens at a host they control. See `lib/redirect.ts` and `doc/13` E-031.

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

  `redirectOrigin` is optional and means the same thing it does at registration: where a confirmation link should return the person who taps it, restricted to the same set of addresses. It is accepted here as well as there because a member who never received their first link asks for a second one through this endpoint, and the second link must go to the right place too.
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

`avatarUrl` is **not the stored path** and is not a URL the client ever supplied: it is a
short-lived signed URL minted at read time (5-minute expiry) from whatever object the account
currently has, or `null` when there is none. A missing or unreadable object degrades to `null`
rather than failing the read, because the app layout depends on this endpoint and must never
redirect somebody to sign in because their photo is broken. Only the endpoints in **H** and
**I** can write the column.

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
    "locationGps": "5.6037,-0.1870"
  }
  ```

No `avatarUrl` field exists here, and one sent anyway is stripped by validation before it can
reach the write. The schema deliberately accepts no client-supplied avatar URL — arbitrary
third-party URLs would be rendered as a person's photo, and the URL is not how a photo is
stored. A profile image is written only through the multipart endpoints **H** (upload) and
**I** (remove), which scrub the bytes and store a random-UUID object the client cannot
influence.

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

A profile image, when one is set, is also removed here. Its path is read before the account
delete (the deletion trigger scrubs every `profiles` column, so reading afterwards would see
nothing) and the object is then removed through the Storage API, counted in `mediaRemoved`.

---

### H. Upload Profile Photo
* **Endpoint:** `POST /api/v1/auth/avatar`
* **Description:** Sets or replaces the caller's profile image. Any authenticated role may call it.
* **Authorization:** `Authorization: Bearer <access_token>`
* **Rate limit:** 20 requests per 15 minutes per IP — the same limiter as proof uploads,
  because re-encoding an image is the same class of work.
* **Request Body (Multipart Form-Data):**

  `avatar_file` is the photo, as multipart binary. Accepted types are `image/jpeg`,
  `image/png`, `image/webp`, and `image/heic` — images only, and every type must be
  scrubbable. Files are size-capped by `STORAGE_MAX_AVATAR_BYTES` (default 5 MB) twice: by
  multer before a byte is buffered, and by the `profile-avatars` bucket itself.

  The bytes are scrubbed of metadata exactly as proof media are (sharp re-encoding drops
  EXIF and any GPS block), and the object is stored under a random UUID in the caller's own
  folder. Uploading a replacement removes the previous object, and only after the profile row
  already points at the new one — a failure partway through can orphan a file but can never
  leave the profile pointing at a photo the user replaced.

Response (201 Created):

```json
{ "avatarUrl": "https://signed-url…" }
```

`avatarUrl` is a fresh short-lived signed URL (5-minute expiry), minted from the object that
was just stored. It is **never** a path from storage and never a caller-invented address.

### I. Remove Profile Photo
* **Endpoint:** `DELETE /api/v1/auth/avatar`
* **Description:** Removes the caller's profile image, if there is one. Idempotent — an
  account with no photo still answers success with `null`, exactly as account deletion does
  for media that is already gone.
* **Authorization:** `Authorization: Bearer <access_token>`

Response (200 OK): `{ "avatarUrl": null }`. The profile row is cleared before the object is
deleted, so a removal that fails partway never leaves the profile pointing at a photo its
owner asked to delete.

---

### J. Confirmation Link Return (`/auth/callback`)

* **Route:** `GET /auth/callback` in `apps/web` — a web route, not an API endpoint.

The API never redirects anyone itself. It tells Supabase Auth where a confirmation link should
return the person who taps it (`redirectOrigin`, see **A** and **B**), Supabase verifies the token
in the email first and only then redirects, and this route is what receives the result. It accepts
both shapes Supabase can send:

* `?code=...` — the PKCE exchange, completed server-side with `exchangeCodeForSession`.
* `#access_token=...&refresh_token=...` — the implicit flow, read in the browser because a URL
  fragment is never transmitted to a server, and handed to a server action.

Either way the tokens are validated with Supabase before anything is stored: the refresh token is
exchanged, and only Supabase's answer becomes the application's `tp_session` cookie. The reader
then lands on the page for their role. On any refusal the credentials are cleared and the route
says the link could not be used, without distinguishing an expired token from a replayed one.

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

`verifierPhone` is optional and **is not collected by the web client any more.** The worker no longer
enters the client's number when logging work; they receive the link and share it themselves. The
field and the dispatch path it feeds are retained deliberately, so automatic delivery can be switched
on later without changing this contract. When supplied, **only a salted hash is stored** — the number
itself is used once, to address the message, and is never written to any table or log. See
`doc/08` §4.

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

**From the web client it is now always `false`,** because that client never sends a number. The
field remains so the provider integration stays wired and a future automatic-dispatch flow has
somewhere to report to; nothing about the messaging module was removed.

### B. List Own Proofs

* **Endpoint:** `GET /api/v1/workers/proofs`
* **Description:** The worker's logbook: every proof they submitted, newest first.
  Returns only the caller's own rows, and media URLs are short-lived signed links minted for this
  exact request (5-minute expiry), so a row whose media was later removed cannot leak its file.
* **Authorization:** worker.

Response (200 OK):

```json
{
  "proofs": [
    {
      "id": "uuid",
      "skillTag": "Solar Panel Installation",
      "description": "Replaced two cracked panels and re-commissioned the string.",
      "submissionGps": "5.6037,-0.1870",
      "createdAt": "2026-10-07T12:00:00.000Z",
      "verificationStatus": "pending",
      "mediaKind": "image",
      "mediaUrl": "https://…/signed…"
    }
  ]
}
```

`mediaKind` is derived from the stored content type or extension (`image` or `audio`), and
`mediaUrl` is a signed storage URL for the worker's own media — an image for a photo proof, and
for a recording the URL the player needs. `verificationStatus` is one of `pending`, `verified`,
`rejected`, `flagged`, `fraud_blocked`. `flagged` means the record is withheld pending human
review and is explicitly **not** a finding of fraud; `fraud_blocked` means a person upheld it
after review and is reachable only through `POST /api/v1/admin/proof-review/{proofId}`.

### C. Get One Proof

* **Endpoint:** `GET /api/v1/workers/proofs/{id}`
* **Description:** One of the caller's proofs with its verification state, for the log detail
  screen and its correction form.
* **Authorization:** worker.
* **Path:** `{id}` must be a UUID. A non-UUID value, an unknown id, or another worker's id all
  return the same `404` so the endpoint cannot be used to probe which ids exist or belong to
  whom.

Response (200 OK): the list item shape above plus the fields the screen needs:

```json
{
  "proof": {
    "id": "uuid",
    "skillTag": "Solar Panel Installation",
    "description": "Replaced two cracked panels and re-commissioned the string.",
    "submissionGps": "5.6037,-0.1870",
    "createdAt": "2026-10-07T12:00:00.000Z",
    "verificationStatus": "pending",
    "mediaKind": "image",
    "mediaUrl": "https://…/signed…",
    "editable": true,
    "verificationOutstanding": true,
    "verificationLinkExpired": false,
    "verificationExpiresAt": "2026-10-14T12:00:00.000Z"
  }
}
```

`editable` is the freeze rule and follows the **link**, not a delivery. Since the work-logging form
no longer collects a number, dispatch is never attempted, so a rule keyed on delivery would sit
permanently false and quietly stop freezing anything. The record is therefore held still from the
moment a link is issued until it is answered or runs out, and `editable` becomes true again once a
link has lapsed without an answer — so a worker who spots a mistake after the seven days can still
correct it.

* `verificationOutstanding` — a link is live and can still be answered.
* `verificationLinkExpired` — a link was issued and ran out unanswered. Distinct from the above,
  because only this state has something to replace.
* `verificationExpiresAt` — when the live link stops working (`null` once used, expired, or
  concluded).

### D. Update One Proof

* **Endpoint:** `PATCH /api/v1/workers/proofs/{id}`
* **Description:** Corrects a proof before it is sent out for confirmation — the description,
  the skill, and/or the location. Media is immutable: a file was scrubbed and stored once, and
  replacing it after the fact would defeat confirmation, so there is no media field on this
  endpoint at all.
* **Authorization:** worker; the row must be the caller's own.
* **Request Body:** a JSON object with at least one of `description` (10–2000 characters),
  `skillTag` (2–160), or `submissionGps` — a range-checked `lat,lon` pair, or `null` to remove
  the stored location. An empty object is refused.
* **Freeze rule (checked at the write, not the read):** an edit is refused with `409
  CONFLICT` once a verification row for this proof has `dispatch_status = 'sent'` — even if that
  link later failed to arrive — or once the proof is no longer `pending`. The page shows the edit
  form only when `editable` is true, but a save that races a dispatched link is still refused
  here, so the rule holds even if two tabs disagree.

Possible errors: `400 VALIDATION_ERROR` (empty body, out-of-range or malformed coordinates),
`404` (unknown or non-owned id, or non-UUID id), `409 CONFLICT` (frozen for the reasons above).

### E. Own Overview

* **Endpoint:** `GET /api/v1/workers/overview`
* **Description:** The dashboard's numbers — the worker's own logs, verifications, and
  invitations — plus the three most recent proofs for a "recent work" strip.
* **Authorization:** worker.

Response (200 OK):

```json
{
  "totalLogs": 4,
  "verifiedLogs": 2,
  "awaitingVerificationLogs": 1,
  "pendingInvitations": 1,
  "recent": [ { "…": "three most recent ProofListItem entries, newest first" } ]
}
```

All counts are scoped to the caller, and the same care as the list applies: recent entries carry
signed media URLs minted for this request only.

---

## 5. Verification Endpoints (SMS Loop)

### A. Get Verification Details
* **Endpoint:** `GET /api/v1/verifications/{token}`
* **Description:** Public endpoint reached from the shared confirmation link by the person who
  received or supervised the work. **No account and no session are required** — the token is the
  only credential, which is the property the recipient page depends on.

Response (200 OK):

```json
{
  "skillTag": "Refrigeration Repair",
  "taskSummary": "Replaced commercial compressor and fixed electrical fault.",
  "status": "awaiting_response",
  "expiresAt": "2026-10-14T12:00:00.000Z",
  "respondedAt": null,
  "skillLevel": 2,
  "loggedAt": "2026-10-11T09:00:00.000Z",
  "mediaKind": "image",
  "mediaUrl": "https://…/signed…",
  "mediaUnavailable": false
}
```

* `skillLevel` is the tier the worker **claims** for this skill (1–3), shown so the recipient can
  read the claim rather than infer it. It is not a verification of that tier.
* `mediaUrl` is a **short-lived signed URL minted for this request** (5 minutes), not a stored
  address. The bucket stays private and no storage credential leaves the API. A signing failure
  yields `mediaUrl: null` with `mediaUnavailable: true` rather than failing the read, because the
  decision is still answerable without the picture.
* `mediaUnavailable` distinguishes "the file could not be loaded" from "no file was attached", so an
  absent photograph is never mistaken for withheld evidence.

Deliberately excluded: worker identity, the verifier's phone number, GPS telemetry, the fraud
score, and the bucket-relative storage path. None of them are needed to judge whether a job was
done, and a name on the page would tell anyone holding a forwarded link who works with them.

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

The trust engine runs synchronously **before** the proof status is written, so a held record is
never briefly overwritten with `verified`. The score combines proximity (strongest, being the
only signal grounded in an independent physical fact), endorsement diversity, and media
provenance (weakest, since all three ultimately rest on data a motivated party controls).
Missing signals contribute nothing in either direction, so withholding data is not a way to
defeat the engine.

`verificationStatus` is `verified`, `rejected`, or `flagged` — **never `fraud_blocked`**.
Blocking is not a scoring outcome. `fraud_blocked` is set only by an administrator reviewing
the record (see *Proof review* below), because an automated heuristic over a self-declared
location and a metadata-stripped photo cannot establish fraud.

Note that `status` reports what the **client** did, which is not always what happened to the
**proof**: a client confirming from another continent gets `status: "confirmed"` — they did
confirm it — alongside `verificationStatus: "flagged"` and `withheld: true`, because the
endorsement does not count.

`withheld` and `withheldReason` tell the client the platform's own assessment as well as their
answer, so the confirmation page can never imply that tapping Confirm made the record trusted
proof. `withheldReason` is written for a human to read and never contains a score or a
threshold: a worker can act on "the file you uploaded carried no capture details", and on
nothing else.

A `rejected` response is never scored and never blocked, whatever the other signals say.
Scoring rejections would let colluding clients manufacture free disputes against real workers.

Possible errors: `400` invalid response or malformed coordinates, `404` invalid link, `409` link
already used, `410` link expired.

---

## 5A. Replacing a Confirmation Link

### A. Request a Fresh Link
* **Endpoint:** `POST /api/v1/workers/proofs/{id}/verification/resend`
* **Description:** Issues a replacement confirmation link for a log whose earlier link lapsed
  unanswered, or which was never handed over. Worker only; the proof must belong to the caller.
* **Response:** `{ "verificationToken", "verificationExpiresAt", "verificationLinkSent" }` — the
  token is returned once, as at submission.

Because no client number is stored, a replacement cannot re-message anyone and is **not** a
redelivery of the old request — it is a new one. Distinguishing the two matters: the old token is
retired rather than left usable.

* **Refused with `409`** while a link is still live, and once the log has reached a verdict. A
  worker cannot mint a competing request while the person they already sent it to is still holding
  it, and cannot re-open a concluded record.
* **Refused with `404`** for a log that is not the caller's.

**One request, one decision.** The replacement runs in a single transaction that first retires
every unanswered request for the proof and then issues the new one. Without that step a proof can
end up with two answerable requests at once: the previous row stops being read as current, but its
token still resolves to a live `response = 'none'` row and would still accept a decision, so
whichever answer landed last would win. Only **unanswered** rows are retired — a recorded
confirmation or rejection is never touched, so replacing a link cannot erase a decision.

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

## 6A. Proof Review Endpoints

A record the engine withheld is recoverable. This section is the route back to a worker's
income, and the only place `fraud_blocked` can be written anywhere in the system.

### A. Ask for a Withheld Record to Be Reviewed (worker)
* **Endpoint:** `POST /api/v1/workers/proofs/:proofId/appeal`
* **Authorization:** worker role, and the record must be theirs.
* **Request Body:** none. The appeal deliberately takes no free text; the reviewer needs the
  evidence and the recorded signals, both already on the record.

```json
{ "proofId": "…", "reviewStatus": "appealed" }
```

The record stays withheld while it waits. An appeal is a request for a person to look, not a
reprieve, and presenting it as one would promise an outcome the platform has not reached.

Refusals: `404` if the record is not the caller's — an id belonging to someone else is reported
exactly as an unknown one, so a proof id cannot be probed. `409` if the record was never
withheld, or has already been appealed or reviewed.

### B. List Withheld Records (admin)
* **Endpoint:** `GET /api/v1/admin/proof-review`
* **Authorization:** admin role.
* **Response:**
  ```json
  {
    "items": [
      {
        "proofId": "…",
        "skillTag": "Solar Panel Installation",
        "description": "Fitted and commissioned a rooftop solar array.",
        "flagReason": "Held for review: the confirmation came from a different place…",
        "flaggedAt": "2026-10-11T12:09:34.000Z",
        "reviewStatus": "appealed",
        "verificationStatus": "flagged",
        "fraudScore": 0.125,
        "clientResponse": "confirmed"
      }
    ]
  }
  ```

No worker identity, name, email, or contact handle appears here. The question a reviewer answers
— was this automated decision fair — is answerable from the evidence and the signals alone.

### C. Record a Review Decision (admin)
* **Endpoint:** `POST /api/v1/admin/proof-review/:proofId`
* **Authorization:** admin role.
* **Request Body:**
  ```json
  { "outcome": "overturned" }
  ```

`outcome` accepts `upheld` and `overturned`:

* **`overturned`** returns the record to `verified` and sets `restoredAt`. Refused unless the
  client actually confirmed — overturning a rejection would convert "the client says this did
  not happen" into a badge, which is an override of the only party who was there, not a review.
* **`upheld`** sets `fraud_blocked`. This is the only path to that status in the entire system.

Both store the reviewer's own id, taken from the session and never from the request body, so a
decision cannot be attributed to somebody who did not make it. Both are terminal: a second
decision returns `409`, and the guard sits in the `WHERE` clause so two reviewers acting at
once cannot both land.

**The engine's findings are not deleted by an appeal.** They live on the verification row and
remain readable in the queue. An appeal that erased the reason would let anyone clear a genuine
finding simply by objecting to it.

Anonymised records — retained after a worker deleted their account — are excluded from the
queue, since there is no worker to restore anything for.

---

## 6B. Training Provider Endpoints

The training provider's workspace (`doc/02` Module 4) and the student's own side of it. Every
route requires a valid access token. `/trainers/*` requires the `training_provider` role and
`/workers/credentials` and `/workers/enrolment` require `worker`; both are enforced at the
router mount, so a wrong role is a 403 on the whole group rather than on whichever handler
happened to check.

### A. Institute Dashboard
* `GET /api/v1/trainers/overview`

One read answers every figure on the dashboard, so the tiles cannot disagree with each other or
with the pages they point at. Returns `studentCount`, `awaitingCredentials`,
`acceptedCredentials`, `organizationName`, and `topDemandSkills`.

### B. Student Roster
* `GET /api/v1/trainers/roster` — the institute's own students.
* `POST /api/v1/trainers/roster/code` — create or rotate the enrolment code.
* `DELETE /api/v1/trainers/roster/{enrolmentId}` — remove a student.

Response (200 OK):
```json
{
  "students": [
    {
      "enrolmentId": "6b1f1f0a-1c2d-4e3f-8a9b-0c1d2e3f4a5b",
      "fullName": "Ama Mensah",
      "credentialCount": 2,
      "pendingCount": 1,
      "enrolledAt": "2026-10-15T09:12:00Z"
    }
  ],
  "hasActiveCode": true,
  "organizationName": "Accra Technical Institute"
}
```

A roster entry carries a name and nothing else. There is no email, phone, or location on the
table, and no endpoint here can return one — an institute needs a name to sign a milestone and
nothing more, and a roster is the kind of table that quietly becomes a contact list.

**Enrolment runs through a code, not a form.** A student redeems a code the institute published,
so being on a roster is something they did. The alternative — an institute typing student
addresses into a form — would have the platform collecting the personal details of people who
never asked to be in one. Only a SHA-256 digest of the code is stored, and the raw value is
returned exactly once, in the response to `POST /roster/code`; `hasActiveCode` reports whether
one is live without ever returning it. Rotating invalidates the previous code but touches
nobody already enrolled, because enrolment is a row rather than a property of the code.

Removing a student **keeps** the credentials they already hold. Leaving a course does not
un-take a practical somebody sat, and deleting the endorsement would leave the institute with
no record of what it certified.

### C. Milestone Issuer
* `GET /api/v1/trainers/credentials` — what this institute has signed off.
* `POST /api/v1/trainers/credentials` — sign off a practical.

Request:
```json
{
  "enrolmentId": "6b1f1f0a-1c2d-4e3f-8a9b-0c1d2e3f4a5b",
  "skillTag": "Refrigeration Repair",
  "milestoneTitle": "Refrigeration workshop practical 3",
  "skillLevel": 2,
  "note": "Passed the compressor fault-finding practical."
}
```

Addressed by `enrolmentId` and never by a student id, email, or name. There is no shape of this
request that could name somebody who is not already on the issuing institute's roster, and a
second institute's enrolment id is a 404 rather than a 403 — a 403 would confirm the row
exists.

**This endpoint cannot produce a credential a student holds.** Signing off creates a row in
`awaiting_student`, and only the student can move it. `doc/02` §5.1 calls a micro-credential
"dual-backed" without defining the second backing party, and the only reading consistent with
this platform's purpose is two independent parties: the institute and the student. The worst
outcome of a compromised or careless institute account is therefore a pile of unanswered
notifications, not a network full of fabricated verified experience.

### D. Market Demand
* `GET /api/v1/trainers/demand` — `limit` (1–50, default 12).

Response (200 OK):
```json
{
  "skills": [
    {
      "skillTag": "Solar Panel Installation",
      "activeSearches": 4,
      "availableWorkers": 1,
      "demandPerWorker": 4,
      "gapScore": 3
    }
  ],
  "totals": {
    "activeSearches": 12,
    "availableWorkers": 9,
    "invitationsSent": 31,
    "invitationsAccepted": 18,
    "invitationsDeclined": 6,
    "institutions": 4
  },
  "generatedAt": "2026-10-15T09:40:11.402Z"
}
```

Derived entirely from rows the platform already holds. Demand is employer capability specs
that are currently running; supply is worker capability blocks. **No external labour-market
feed is involved** and no number here came from a third party.

**No credential contributes to supply.** Otherwise an institute's own graduates would inflate
the very shortage figure it uses to justify its own curriculum.

`gapScore` is `demand minus supply`, floored at zero, so an oversupplied skill can never read
as a shortage. A skill nobody has searched for is **not** a skill nobody needs — only one
nobody has written down.

`invitationsSent`, `invitationsAccepted` and `invitationsDeclined` are network totals and are
deliberately **not** broken down per skill. `direct_offers` records the spec an invitation came
from and no skill at all, so a per-skill rejection count would silently describe only the
invitations whose employer happened to save a spec, and would read as a complete picture of why
candidates are turned down when it is not one.

### E. Student Credentials
* `POST /api/v1/workers/enrolment` — redeem an institute's code.
* `GET /api/v1/workers/credentials` — what is waiting, and what the student holds.
* `POST /api/v1/workers/credentials/{credentialId}` — accept or decline.

Request to answer:
```json
{ "response": "accepted" }
```

`response` is `accepted` or `declined`. The verb is deliberate: the student is agreeing to hold
the endorsement, **not** vouching for the skill. Nothing in this request can be read as a
claim that the work was independently verified.

One answer, and it is final. A second attempt is a 409 rather than a silent overwrite, because
an institute acts on what it is told and reporting a replacement as a recording would be worse
than saying it had already been answered. A credential belonging to somebody else is a 404, not
a 403.

Response (200 OK):
```json
{
  "awaiting": [
    {
      "id": "9c2e3d4a-1b2c-4d5e-8f90-1a2b3c4d5e6f",
      "skillTag": "Refrigeration Repair",
      "skillLevel": 2,
      "milestoneTitle": "Refrigeration workshop practical 3",
      "note": "Passed the compressor fault-finding practical.",
      "status": "awaiting_student",
      "organizationName": "Accra Technical Institute",
      "instructorName": "Kwesi Boateng",
      "issuedAt": "2026-10-15T09:20:00Z",
      "answeredAt": null
    }
  ],
  "accepted": [],
  "declinedCount": 0
}
```

`organizationName` and `instructorName` are both returned, because a credential is worthless
as evidence without knowing who stands behind it — an unattributed endorsement is exactly the
kind of claim this platform exists to make attributable. They are shown to the student, who is
the party entitled to ask who signed a record about them, and to nobody else.

Both are resolved through a fallback chain — the account's organization name, then its profile
name, then its own name in `auth.users`. The earlier fields are optional and a `profiles` row
only exists for an account that registered through the public form, so reading them directly
produced credentials that named nobody (`doc/13` E-054). `instructorName` is null only when
the account carries no name in any of the three; the credential then survives as the
institute's record and is shown as unattributed rather than credited to whoever signed it next.

**`accepted` does not mean verified.** It records that the student agreed to hold the
endorsement. Accepting writes nothing to `work_proof_logs` or `verifications` and moves no
number an employer searches on: `verifiedProofs` and `verifiedTotal` derive from proofs and
never read `micro_credentials`. A bootcamp that issued to a hundred students has endorsed a
hundred students; it has not produced a hundred people whose work was confirmed by customers,
and nothing in this response lets the two be summed together. The awaiting and accepted buckets
are returned separately and are deliberately different shapes from the worker overview, so a
client cannot add them together by accident.

`declined` is stored rather than deleted, so "the student refused this" is never
indistinguishable from "this was never offered", and an institute cannot quietly re-approach
somebody by issuing a slightly different milestone.

---

## 7. Location Endpoints

A single public helper behind the web app's "Use my location": it turns the
phone's GPS coordinates into a place/area name, so a worker sees "Patrice
Lumumba Road, Accra, Ghana" instead of being asked to read a number pair. It is
public (like the health probe) because naming a coordinate pair carries no
per-account data; the CORS allow-list and a rate limiter are what keep the
surface honest.

### A. Reverse Geocode

* **Endpoint:** `GET /api/v1/locations/reverse?lat={lat}&lon={lon}`
* **Description:** Names the place nearest a coordinate pair. The name is
  presentation only — the web app keeps the coordinates as the stored record —
  and it is never persisted on a proof.
* **Query Parameters:** `lat` and `lon` in decimal degrees, coerced from text
  and range-checked (`lat` −90..90, `lon` −180..180).
* **Authorization:** none.
* **Rate limit:** 60 requests per 15 minutes per IP.

Response (200 OK):

```json
{
  "placeName": "Patrice Lumumba Road, Accra, Ghana"
}
```

`placeName` may be `null` when the provider has nothing to call that spot.

Possible errors: `400` malformed or out-of-range coordinates (`VALIDATION_ERROR`,
with the offending parameter under `details`), `429` too many requests, `503`
the geocoding provider did not answer (`SERVICE_UNAVAILABLE`) — the caller
keeps the coordinates either way.

Both sides of the lookup soften one transient failure before reporting it: the
service retries once with a short backoff before it answers `503`, and the web
app's own name lookup tries once more with 500 ms between attempts. A name is
presentation — nothing on the proof depends on it — so the extra attempt buys
most of the value of reliability for almost none of the cost of a hung request.

The provider is Nominatim (OpenStreetMap), reached only from
`apps/api/src/modules/locations/service.ts`, which is the one file that knows
the remote address. Requests carry an identifying User-Agent and a 6-second
timeout, satisfying the provider's usage policy at the low volume this endpoint
sees.

---

## 9. Standard Error Response Format
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

A validation refusal adds `details`, an array of the individual problems. `message` describes the
request; `details` describes the mistake, and it is the part a person can act on:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body failed validation.",
    "status": 400,
    "details": [
      { "path": "password", "message": "Password must be at least 12 characters." },
      { "path": "password", "message": "Password must include a number." }
    ]
  }
}
```

`path` is the dotted path into the submitted body, so a client can place each message beside the
field it belongs to rather than showing all of them as one undifferentiated block. Clients should
treat `details` as optional and read it defensively: several endpoints use the same field for other
shapes of information. Ignoring it entirely is what turned every distinct registration mistake into
the same unusable sentence — see `doc/13` E-030.

Two codes carry endpoint-specific meaning worth naming:

* **`404` for `PATCH/POST /workers/proofs/{id}`-style routes.** A non-UUID id, an unknown id, and
  another user's id all answer `404`, so the route cannot be used to enumerate what exists or
  whose it is. `PATCH` is additionally denied for rows the caller does not own, before any
  content validation, so a probe learns nothing from the different messages either.
* **`409 CONFLICT` on `PATCH /workers/proofs/{id}`.** Returned once a confirmation link has been
  dispatched for the proof or it is no longer `pending`: the entry is frozen because somebody may
  already have acted on what is written. The message says why, since the condition is temporal
  rather than a mistake in the request.
