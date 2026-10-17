# 02-SPECIFICATION-FEATURES.md

**Product:** TetherProof

## 1. Overview
This document outlines the detailed functional requirements and feature specifications for the verified capability platform. It covers the core workflows across all three user segments: Workers, Employers, and Training Providers, along with the underlying trust and anti-fraud system.

---

## 2. Module 1: Worker Capability Ingestion & Profile
### Feature 1.1: Automated Telemetry Connector (Digital/Tech Workers)
* **Description:** Secure, non-invasive OAuth or token-based integrations with developer and project management tools (e.g., GitHub, Jira, Figma).
* **Behavior:** Automatically detects successful deployments, code merges, or completed project milestones and translates them into raw execution events without exposing private source code.

### Feature 1.2: Voice and Photo-Logged Milestone Entry (Trade/Service Workers)
* **Description:** A mobile-friendly logging interface designed for non-technical or physical trade workers.
* **Behavior:** Allows users to record a brief voice note (converted to structured text tags by speech-to-text processing) or snap a photo of completed work to initiate a verification sequence.

### Feature 1.3: Portable Capability Graph Dashboard
* **Description:** A unified visual representation of a worker’s verified skills and project history.
* **Behavior:** Replaces traditional static résumés with live, cryptographically anchored skill blocks (e.g., *Refrigeration Repair - Level 3, Verified 35 times*).

---

## 3. Module 2: Frictionless Verification & Anti-Fraud Engine

The four features below run as one engine. A confirmed endorsement is scored on proximity,
endorsement diversity, and media provenance, and comes out as one of three outcomes: **verified**,
**flagged**, or **fraud_blocked**. The per-signal breakdown is stored so a held proof can be
explained from data rather than from logs.

The three-way split is the policy, and it is deliberately asymmetric:

* **Verified** — the client confirmed and nothing withheld the record.
* **Flagged** — the signals did not agree. The record is withheld from counting as proof and
  queued for a person. It is explicitly *not* a finding of fraud.
* **Fraud-blocked** — reachable only through the admin review path (`doc/07`), never from a
  score.

A heuristic over weak signals cannot establish fraud, and a system that lets it try will
eventually brand an honest worker. The engine therefore decides what may be *trusted*, not who
is a liar: it withholds and a person decides. `fraud_blocked` is a word only a person can write.

Two properties hold throughout, and they constrain everything else:

* **A missing signal is neutral.** A client who declines geolocation, a proof with no
  supplied number, and an audio recording all yield an absent signal rather than a failing
  one. Otherwise anyone could defeat the engine by withholding data, and privacy-respecting
  users would be penalised for it.
* **A rejection is never scored.** A client reporting that work did not happen is not
  evidence of fraud, and blocking on it would let colluding clients generate free disputes
  against real workers.

### Feature 2.1: SMS/WhatsApp Web Verification Links
* **Description:** Zero-friction verification request system for clients, supervisors, or managers.
* **Behavior:** Generates a secure, one-time mobile-web link sent via SMS. The recipient can confirm completed work with a single tap ("Yes / No") without needing to download any mobile application.
* **Implementation:** The link is rendered and dispatched through a `MessageProvider` interface with a Twilio adapter and a log adapter. Twilio's Messages API is called with `fetch`, so no vendor SDK is added. An unconfigured deployment does not fail a proof submission: the worker receives the link in the API response and shares it manually, and the dispatch outcome is recorded on the verification row so a link that never arrived is visible rather than mysterious.

### Feature 2.2: Graph Centrality Collusion Filter
* **Description:** Automated anti-cheat algorithm to prevent closed-loop endorsement rings (e.g., friends mutually verifying each other).
* **Behavior:** Weights verifications based on network diversity. Verifications originating from isolated or repeated two-way connections are automatically down-weighted or discounted.
* **Implementation:** What makes an endorsement trustworthy is network diversity — a confirmation from someone who sees a wide range of workers carries more information than one confined to a single worker, and a ring defeats that by construction. A verifier is identified by a salted hash of their phone number; the number itself is never stored. Findings are: approvals confined to one worker, an unusually large share of a worker's proofs coming from one verifier, and mutual endorsement in both directions. A verifier seen for the first time is neutral, not suspicious — penalising new verifiers would punish exactly the growth the product wants.

### Feature 2.3: Device & GPS Location Anchoring
* **Description:** Spatial validation to ensure real-world proximity during physical job sign-offs.
* **Behavior:** Compares the GPS coordinate logged when the worker submits a task with the GPS coordinate of the client's device when the confirmation link is tapped.
* **Implementation:** Great-circle distance via the haversine formula, compared against a configurable threshold (default 2 km). The outcome is one of `within`, `outside`, or `unavailable`, kept distinct so a client who declined to share a location is never conflated with one standing at the job site. Both endpoints apply the same range validation; `999,999` is refused on submission and on confirmation.

#### Feature 2.4: Media Provenance Signals

> **Superseded in part — read with `apps/api/src/lib/media-integrity.ts` and `doc/13` E-019.**
> The submission-time gate described below now exists, and it is the only place an upload can be
> refused on integrity grounds. It refuses a **structurally invalid container** and flags an
> **internally contradictory capture time**; it still makes no claim whatsoever about AI-generated
> media, and absence of metadata is still never a finding. See "What this deliberately does not
> do" below, which remains accurate and is the reason the gate stops where it does.
>
> **Requirement disposition: partially delivered, and the gap is deliberate rather than
> overlooked.** A probabilistic detector was evaluated and rejected on evidence, not on effort —
> see `apps/api/src/lib/media-provenance.ts` for the benchmark figures and the reasoning. What is
> built is (a) the structural/contradiction gate below, and (b) a reader for **C2PA Content
> Credentials**, which is the one provenance signal that is cryptographically grounded rather than
> inferred. A file that declares itself generated is kept and marked for a human; it is never
> refused, because no detector was consulted and no signature was verified.
>
> The gate produces three outcomes, and the vocabulary is chosen so none of them can be read as a
> detection claim:
>
> | Outcome | Trigger | Effect |
> | --- | --- | --- |
> | `accepted` | Nothing blocking found. | Stored. |
> | `needs_review` | Structurally sound, but the capture time contradicts the upload moment. | Stored; the contradiction still reaches the trust engine. |
> | `rejected` | The bytes are not the container they declare. | Refused, with wording that does not describe any threshold. |
>
> **A file with no metadata is `accepted`.** Metadata is stripped by every messaging app and by
> this project's own scrubber, so its absence is the normal condition of most genuine evidence;
> treating it as a finding would refuse honest uploads while remaining trivially avoidable.

* **Description:** Provenance checks protecting the network from mislabelled or stitched-together upload attempts.
* **Behavior:** Derives three conclusions from file metadata **while that metadata still exists**, then discards the metadata and keeps only the conclusions: whether a capture device was identified, whether the capture time was internally consistent with the moment of submission, and whether the container is structurally what its declared type claims. No make, model, serial number, or timestamp is retained.
* **Explicitly not implemented: detection of AI-generated media.** No metadata check can reliably distinguish a generated image from a real one, and nothing in the system claims to do so. What the signals do establish is narrower and still useful: the absence of a camera signature (which capture devices reliably write), a contradictory capture time (after submission, or before 2005, where an unset clock and the 1970 epoch both land), and a container that does not match its type. These are weak evidence, scored as such. They can only lower a score, never raise it above neutral, so a clean-looking file earns nothing and no honest worker's upload is ever refused on their basis.
* **Consequence:** `metadata_status` remains `pending` and `flagged_ai_fake` is written nowhere. See `doc/13` E-019 for why this specification had to be corrected.
* **Why no hosted detector was integrated.** Independently benchmarked in 2026 across 16 detector
  families, 12 datasets and 291 generators, zero-shot accuracy spread 37 percentage points between
  the best and worst detector, and detection of current commercial generators (Flux Dev, Firefly
  v4, Midjourney v7) averaged **18–30%** — worse than the 50% a coin flip would give. A separate
  audit of five commercial tools on 15 **authentic** press photographs found they mislabelled real
  images as AI-generated between 6% and **40%** of the time. A detector that is wrong about modern
  generators most of the time and wrong about real photographs up to 40% of the time cannot decide
  whether a worker keeps a verification: the cost is asymmetric, and a false block takes a person's
  income while a missed synthetic image is still visible to the recipient looking at the photo.
  Integrating one would additionally require sending a worker's evidence to a third party, which
  the privacy model in `doc/08` already declines to do. Full figures are in
  `apps/api/src/lib/media-provenance.ts`.

---

## 4. Module 3: Employer Discovery & Capability Matching

Module 3 is built. The three features below are described as implemented, not as intended,
including the boundaries that were deliberately drawn.

Three properties hold throughout the module:

* **The worker is never an output.** No endpoint in this module returns a worker id, name,
  email, phone number, or avatar. A search result can be acted on and nothing more, and the
  only handle it carries is meaningless to any other employer.
* **Aggregates are derived, never stored.** Verified counts, trust scores, and last-verified
  timestamps are computed from the proof records at read time. A cached counter would drift
  from the proofs it summarises, and a counter that always reads zero would rank on a lie.
  Two dormant counter columns were removed for exactly this reason.
* **Approval gates contact, not discovery.** An employer may search as soon as the account
  exists. Sending an invitation is unsolicited contact with a real person, so it waits for a
  human decision. Gating search too would stop the product working while also stopping the
  abuse it exists to prevent.

### Feature 4.1: Capability Spec Builder
* **Description:** Replaces traditional job descriptions with strict operational criteria.
* **Behavior:** Allows hiring managers to define a required skill tag, a minimum verified proof
  count, and a maximum distance in kilometres. A spec can be paused without being deleted and
  resumed later.
* **Implementation:** The reference point for the distance filter is the employer's own saved
  location, so a search is run from where the employer actually is rather than from a
  coordinate typed into the search form. The proof threshold is capped at 500 and the radius at
  20,000 km rather than merely validated as positive: a threshold above what anyone could
  realistically accumulate would never match, and an employer who saved one would have built a
  spec that silently returns nothing forever. Failing at creation is kinder than a filter that
  quietly never fires.

### Feature 4.2: Zero-Knowledge Talent Search
* **Description:** Privacy-first candidate discovery engine.
* **Behavior:** Surfaces candidate cards based purely on verified performance metrics and skill
  scores, masking personal identity details until a mutual connection or invitation is accepted.
* **Implementation:** Each card carries a `candidateHandle`: an opaque, employer-scoped,
  expiring value the server resolves solely for the employer that search was run for. Knowing a
  handle does not let a second employer act on the same worker, and it reveals no worker id.
  A card carries the skill, the verified proof count, the mean fraud score of the verifications
  backing those proofs, the last verification time, and `distanceKm`.
* **On location:** Distance is returned as a number and never as a coordinate. A worker who has
  not shared a location is **not** excluded from results — a missing location is an absence of
  evidence, and dropping those workers would hide most of a network that has not opted into
  geolocation. Their card shows `Not shared` and is still actionable.

### Feature 4.3: Direct Invitation Pipeline
* **Description:** Streamlined connection workflow bypassing traditional resume screening queues.
* **Behavior:** Enables employers to send direct interview or job offers to pre-verified
  candidates based on their proven execution record. The worker accepts or declines, and one
  answer is final.
* **Implementation:** The identity reveal is deliberately asymmetric. Until a worker accepts,
  the employer sees nothing but a handle; the worker sees the employer's organization name and
  whether that account has been reviewed. Accepting is the moment the worker releases their
  identity, and the interface says so on the button rather than letting it read as
  acknowledging a message. A pending invitation cannot be sent twice, and a decision cannot be
  withdrawn, so the controls are not a toggle.

### Feature 4.4: Employer Verification (added during implementation, revised by migration `0012`)
* **Description:** An approval record per **business**, which is what grants the employer capability.
* **Behavior:** Forming a business stays open to any account, because requiring approval before
  anyone can ask would leave nobody able to ask. Sending an invitation is gated instead — and the
  gate is now an approved business with a membership, not a role the person claimed about
  themselves. A pending business is a working state, not a wall: the owner keeps their worker
  workspace, their credentials and everything else they had, and only hiring waits.
* **Implementation:** Approval is a row with a status, a reviewer, a timestamp, and an optional
  note, not a boolean on the business. The owner sees the status and the note but never who
  reviewed them: they need to know a decision was made and what it was, and who made it is not
  theirs to see. Administrators are provisioned by writing the claim against the auth record,
  never by anything a signup can reach — and `admin` is not a capability at all, so there is no
  row to insert (see `doc/13` E-024, E-055, E-056).

---

## 4A. Module 3.5: Capabilities and Workspaces (added by migration `0012`)

One account, several authorised areas, one sign-in.

### Feature 4.5: One account, several capabilities
* **Description:** An account holds a **set** of capabilities rather than a single role.
  The vocabulary is `worker`, `employer`, `training_provider`, `trainee`.
* **Behavior:** Registration asks for no role at all. The Create Account page creates one
  personal identity, and the person activates what they want from their dashboard afterwards.
  Asking at signup would be the same first-fork problem the change exists to remove: whichever
  role was picked first would be the only one the account could have, and the rest would need a
  second account with a second portfolio that could never be joined to the first.
* **Implementation:** `user_capabilities`, keyed `(user_id, capability)`. The `users.role` column
  was **dropped** rather than deprecated — leaving it would leave two sources of truth, and for a
  person holding two capabilities it would simply be wrong. `admin` is deliberately not a
  capability; it is read from the server-controlled claim and is exposed as `isAdmin`.

### Feature 4.6: The capability dashboard
* **Description:** The page an account comes to when it has no workspace yet, and the one it
  returns to whenever it wants another.
* **Behavior:** Lists all four capabilities, held or not. Hiding the two a person already has
  would make the page a to-do list rather than a menu, and would hide the fact that being both a
  worker and a student is supported rather than accidental. Capabilities that need approval say
  so and offer the route rather than a button — a button that leads to a refusal teaches the
  person the app disagrees with itself.
* **Implementation:** `GET /auth/capabilities` always returns all four, so the page renders the
  same set of rows whatever the account has. `worker` and `training_provider` are self-service
  (`POST`); `employer` opens the business form inline because setting up a business is how a
  person *earns* the capability and the two are one action to them. `worker` cannot be revoked,
  because it is what gives a person access to their own records.

### Feature 4.7: Joining a training institute
* **Description:** A student is a membership of an institute, and enrolment is what grants the
  `trainee` capability.
* **Behavior:** A person joins with an enrolment code or an invitation. If they already have an
  account the enrolment links to it; a second account is never created. Student access does not
  imply worker access, and worker access does not imply student access.
* **Implementation:** Enrolment calls `grant(studentId, 'trainee', 'enrolment', trainerId)` inside
  `redeemEnrolmentCode`, so the grant cannot be forgotten by a future route that enrols somebody,
  and the institute is recorded as the grantor. The student credential router was gated on
  `worker`, which meant somebody who had done no paid work could not be a student at all; it is
  now gated on `worker` **or** `trainee`. A student with no qualifying verified work must not
  become searchable to employers, and training credentials never count as customer-verified work.

### Feature 4.8: The role selector, in the header
* **Description:** Moving between the areas a person is authorised for.
* **Behavior:** One control in the header at every width, showing the active role. Tapping it
  lists **all four** roles: one they have switches them there, one they do not have opens that
  role's setup page, and the active one is marked. A bottom sheet on a phone, a dropdown on a
  desktop, because a dropdown anchored near the top of a small screen either overflows or needs
  scrolling. It is **not** a role *change*: nothing in it writes and nothing in it confirms, so
  switching alters what is on screen, never who somebody is and never their password.
* **Implementation:** `WorkspaceSwitcher`, one element whose positioning classes change at `md`
  rather than two components that could drift apart. Driven by the database-backed capability
  set, so a person cannot reach an area by being shown it — and neither can a modified client,
  because every route re-checks the same capabilities server-side.
* **Why not a floating button:** a pinned control has to compete with the bottom tab row for the
  thumb and will eventually sit over whichever dashboard control comes next. The header already
  carries the section title and the account menu, so a selector there is not competing for space,
  and it gives the active role a permanent identifiable home — a `+` says "add", and this mostly
  says "switch". Recorded as `doc/13` E-068.

### Feature 4.9: Roles & Profiles
* **Description:** The dedicated page for seeing and changing which roles an account holds.
  Reached from **Manage roles** at the bottom of the selector, and from the tab row of any
  account with no role set up yet.
* **Behavior:** Lists all four roles, held or not, with a one-line explanation of what each is
  for. Held ones link to their workspace; the rest offer the setup action. Self-service roles
  offer a button; roles needing somebody else's approval offer the route instead **with no
  button**, because a button that leads to a refusal teaches the person the app disagrees with
  itself.
* **Deliberately separate from account settings.** "My details" and "what I may do here" are
  different questions, and a role that is not yet set up has no details to edit — sending
  someone to that capability's settings page would show them an empty form for an organisation
  that does not exist. `/setup/[capability]` exists for exactly that case, and redirects to the
  real workspace once the role is held, so the rule holds however the link was produced.

### Feature 4.10: Per-role settings
* **Description:** Editing the details of the role you are currently working in.
* **Behavior:** One tab at the end of whichever workspace is open, and it means whatever that
  workspace calls it — "Organization" for an employer, "Institute details" for a training
  provider, "Your details" for a worker. Before `0012` the employer's business editor was the
  only such screen and there was no answer for the other roles.
* **Implementation:** `WORKSPACES[id].settingsHref` and `navFor` appends it, rather than each
  navigation array hand-writing a fourth tab — so a workspace cannot forget it, and the label
  follows the workspace instead of being copied four times.

### Feature 4.11: One linked personal portfolio
* **Description:** A person who is both a worker and a trainee uses one account and one identity.
* **Behavior:** The portfolio distinguishes customer-verified work with its evidence from
  institution-issued credentials and practical milestones. Holding a credential never makes an
  otherwise ineligible worker discoverable in employer search.
* **Implementation:** The public portfolio query was the single highest-risk line in this change —
  it filtered `users.role = 'worker'`, so a person with two capabilities would have kept every
  record, kept their proofs verified, and simply stopped appearing on their own public page. It
  now joins on the `worker` **capability** instead. This separation of evidence types is
  unchanged by `0012` and remains the point of the product.

---

## 5. Module 4: Training Provider & Micro-Credentialing

Both features below are built. They are described as implemented, not as intended, including
the boundaries that were deliberately drawn.

Three properties hold throughout the module:

* **A credential is not a customer-verified work proof.** This is the distinction the whole
  module turns on. A student accepting a credential agrees to hold an *institutional
  endorsement*; it does not assert that a customer watched the work happen, and it changes no
  number an employer searches on. A bootcamp that issued to a hundred students has endorsed a
  hundred students; it has not produced a hundred people whose work was confirmed by
  employers, and nothing in the product lets the two be summed. This is structural — the
  status enum has no `verified` value, the search aggregates never read the credential table,
  and the student's credential response shares no type with the worker overview.
* **An institute cannot finalise a credential alone.** Signing off produces
  `awaiting_student`; only the student can move it. See Feature 5.1 for why the second
  signature is theirs.
* **Demand is read from the platform, not from a third party.** The figures on the dashboard
  are derived from employer searches and worker capability blocks. No external labour-market
  feed is involved, because wiring one up would mean sending aggregate demand off-platform,
  which the privacy model in `doc/08` §3 declines to do elsewhere.

### Feature 5.1: Institutional Milestone Issuance
* **Description:** Tooling for vocational schools, bootcamps, and trade institutes to endorse student progress.
* **Behavior:** Allows instructors to sign off on practical workshop tests, minting official dual-backed micro-credentials onto the student's capability graph.
* **Implementation:** "Dual-backed" is used above without the second backing party being
  defined, and the only reading consistent with this platform's purpose is two independent
  parties: the institute, and the student the credential is about. Every other proof here works
  the same way — a worker's own claim is never sufficient on its own — and an institute that
  could write straight to a student's capability graph would make its own graduates the most
  credentialed people on the network, which is exactly what an endorsement should be worth
  something about. The status enum therefore has no `issued` and no `verified` value: signing
  off yields `awaiting_student`, and only the student can accept or decline. The answer is
  final, so a second tap is a 409 rather than a silent overwrite of a decision the institute has
  already acted on.

  A student joins an institute's roster by redeeming a code the institute published, so being
  on a roster is something they did. The roster table has no email, phone, or location column
  at all: an institute needs a name to sign a milestone and nothing more, and a roster is the
  kind of table that quietly becomes a contact list. The code is stored only as a SHA-256
  digest and is returned exactly once. Milestones are addressed by enrolment id, so no request
  can name somebody who is not already on the issuing institute's roster.

  The credential names the institute *and* the instructor who signed it off, shown to the
  student and to nobody else. An endorsement with nobody's name on it is precisely the kind of
  claim this platform exists to make attributable, so the issuer is part of the evidence rather
  than a detail withheld from it.

### Feature 5.2: Real-Time Market Demand Dashboard
* **Description:** Live data feedback loop for educational program design.
* **Behavior:** Aggregates regional employment data and rejection metrics to show training providers which specific technical or hands-on skills are currently undersupplied in the market.
* **Implementation:** Derived entirely from rows the platform already holds. Demand is employer
  capability specs that are currently running — a paused spec is excluded, because a filter
  nobody is running is not a vacancy. Supply is worker capability blocks, which counts what
  people *offer* rather than what has been verified, because the question a curriculum faces
  is how many people are competing for the work. `gapScore` is demand minus supply, floored at
  zero so an oversupplied skill can never read as a shortage.

  Micro-credentials are **not** counted as supply. Otherwise an institute's own graduates would
  inflate the very shortage figure it uses to justify its curriculum.

  Two limitations are stated on the page rather than buried in the schema. A skill nobody has
  searched for is not a skill nobody needs — only one nobody has written down. And the
  rejection metrics are network totals, not per skill: `direct_offers` records the spec an
  invitation came from and no skill at all, so a per-skill rejection count would silently
  describe only the invitations whose employer happened to save a spec, and would read as a
  complete picture of why candidates are turned down when it is not one.
