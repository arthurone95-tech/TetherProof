# 01-PRD-PRODUCT-REQUIREMENTS.md

**Product:** TetherProof

## 1. Executive Summary
The platform is an infrastructure-grade capability and verification network designed to eliminate the reliance on static résumés, unverified CVs, and high-friction traditional hiring. By providing an objective, portable, and privacy-preserving protocol for human capability, the system connects workers, employers, and training providers through real-world, verified execution data.

---

## 2. Product Vision & Goals
* **Objective:** Replace traditional proxy-based hiring (résumés, degrees, keywords) with true, behavior-and-execution-backed skill verification.
* **Core Value Proposition:** 
  * **For Workers:** Portable, fraud-resistant proof of capability that follows them across their careers.
  * **For Employers:** Instant, de-risked talent matching based on verified operational history rather than marketing claims.
  * **For Training Providers:** Real-time market demand feedback loops and micro-credentialing infrastructure.

---

## 3. Target User Personas
1. **The Worker (Primary):** White-collar and blue-collar professionals (e.g., software engineers, technicians, tradespeople, teachers) seeking an automated, effortless way to accumulate and showcase verified proof of work.
2. **The Employer (Secondary):** Hiring managers, factory operators, and enterprise HR teams looking to bypass resume spam and hire pre-verified, capable talent instantly.
3. **The Training Provider (Tertiary):** Vocational institutes, coding bootcamps, and trade schools wanting to issue tamper-proof micro-credentials and align curricula with actual market demand.

---

## 4. Scope and Core Features

### A. Worker Module (Capability Graph & Portfolio)
* **Zero-Friction Ingestion:** Automated telemetry connectors (for digital workers) and voice/photo-logged milestone entries (for trade and service workers).
* **Portable Profile:** A cryptographically secure, verifiable record of skills, projects, and customer-confirmed tasks.
* **Privacy Controls:** Ability to control data sharing and remain anonymous during initial employer discovery phases.

### B. Verification & Anti-Fraud Module (Trust Protocol)
* **Frictionless External Verification:** SMS web verification links for clients and supervisors to confirm work completions without downloading an app.
* **Graph Centrality Filtering:** Automated algorithms to detect and neutralize closed-loop collusion (e.g., users verifying friends), weighting each endorsement by how diverse the verifier's network is.
* **Device & Location Anchoring:** GPS comparison between the worker's recorded position and the client's position when they confirm, so a remote confirmation is visible. A party that shares no location is treated as neutral, not as failing.
* **Media Provenance Signals:** Metadata is inspected while it exists to establish whether a capture device was identified, whether the capture time was consistent, and whether the container matches its type — then the metadata is destroyed and only those three conclusions are kept. **AI-generated media is not and cannot be detected by these checks; no such claim is made.** See `doc/02` Feature 2.4 and `doc/13` E-019.

### C. Employer Module (Capability Matching)
* **Capability Specs:** Granular requirement builders replacing traditional job descriptions with verified skill and proof thresholds.
* **Zero-Knowledge Search:** Talent discovery based purely on capability scores and anonymized metrics.
* **Direct Offer Pipeline:** Streamlined invitation workflow that bypasses traditional resume queues.

### D. Training Provider Module (Market Feedback)
* **Micro-Credential Issuance:** Tools for instructors to sign off on practical student milestones.
* **Demand Insights Dashboard:** Live data feeds highlighting regional and industry skill shortages.

---

## 5. Non-Functional Requirements
* **Security & Privacy:** Strict data isolation between users; compliance with modern privacy standards; zero storage of raw private credentials.
* **Performance:** Rapid search query resolution across capability graphs; lightweight mobile-web responsiveness for low-bandwidth environments.
* **Usability:** Intuitive interfaces for both technical users (GitHub/Jira users) and non-technical trade workers (SMS/WhatsApp-driven flows).

---

## 6. Success Metrics
* Reduction in time-to-hire for employers.
* Higher retention and performance ratings for workers hired via verified proof vs. traditional résumés.
* Volume of valid, fraud-free micro-credentials minted on the network.
