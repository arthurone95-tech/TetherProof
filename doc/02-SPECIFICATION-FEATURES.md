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
endorsement diversity, and media provenance, and is either counted as verified or marked
`fraud_blocked`. The per-signal breakdown is stored so a blocked proof can be explained from
data rather than from logs.

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

### Feature 2.4: Media Provenance Signals
* **Description:** Provenance checks protecting the network from mislabelled or stitched-together upload attempts.
* **Behavior:** Derives three conclusions from file metadata **while that metadata still exists**, then discards the metadata and keeps only the conclusions: whether a capture device was identified, whether the capture time was internally consistent with the moment of submission, and whether the container is structurally what its declared type claims. No make, model, serial number, or timestamp is retained.
* **Explicitly not implemented: detection of AI-generated media.** No metadata check can reliably distinguish a generated image from a real one, and nothing in the system claims to do so. What the signals do establish is narrower and still useful: the absence of a camera signature (which capture devices reliably write), a contradictory capture time (after submission, or before 2005, where an unset clock and the 1970 epoch both land), and a container that does not match its type. These are weak evidence, scored as such. They can only lower a score, never raise it above neutral, so a clean-looking file earns nothing and no honest worker's upload is ever refused on their basis.
* **Consequence:** `metadata_status` remains `pending` and `flagged_ai_fake` is written nowhere. See `doc/13` E-019 for why this specification had to be corrected.

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

### Feature 4.4: Employer Verification (added during implementation)
* **Description:** An approval record per employer account.
* **Behavior:** Self-registration stays open for employers, because requiring approval before
  anyone can look at the product would leave nobody to approve. Sending an invitation is
  gated instead.
* **Implementation:** Approval is a row with a status, a reviewer, a timestamp, and an optional
  note, not a boolean on the user. The employer sees the status and the note but never who
  reviewed them: the employer needs to know a decision was made and what it was, and who made
  it is not theirs to see. Administrators are provisioned by writing the role claim against the
  auth record, never by self-registration — `admin` is deliberately excluded from the roles the
  public registration endpoint will accept (see `doc/13` E-024).

---

## 5. Module 4: Training Provider & Micro-Credentialing
### Feature 5.1: Institutional Milestone Issuance
* **Description:** Tooling for vocational schools, bootcamps, and trade institutes to endorse student progress.
* **Behavior:** Allows instructors to sign off on practical workshop tests, minting official dual-backed micro-credentials onto the student's capability graph.

### Feature 5.2: Real-Time Market Demand Dashboard
* **Description:** Live data feedback loop for educational program design.
* **Behavior:** Aggregates regional employment data and rejection metrics to show training providers which specific technical or hands-on skills are currently undersupplied in the market.
