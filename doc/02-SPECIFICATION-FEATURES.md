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
### Feature 2.1: SMS/WhatsApp Web Verification Links
* **Description:** Zero-friction verification request system for clients, supervisors, or managers.
* **Behavior:** Generates a secure, one-time mobile-web link sent via SMS or WhatsApp. The recipient can confirm completed work with a single tap ("Yes / No") without needing to download any mobile application.

### Feature 2.2: Graph Centrality Collusion Filter
* **Description:** Automated anti-cheat algorithm to prevent closed-loop endorsement rings (e.g., friends mutually verifying each other).
* **Behavior:** Weights verifications based on network diversity. Verifications originating from isolated or repeated two-way connections are automatically down-weighted or discounted.

### Feature 2.3: Device & GPS Location Anchoring
* **Description:** Spatial validation to ensure real-world proximity during physical job sign-offs.
* **Behavior:** Compares the GPS coordinate logged when the worker submits a task with the GPS coordinate of the client's device when the confirmation link is tapped.

### Feature 2.4: AI-Fake Image/Video Detector
* **Description:** Synthetic media scanner protecting the network from AI-generated or scraped portfolio elements.
* **Behavior:** Inspects file metadata (timestamps, camera signatures, and device data) to reject fake or AI-synthesized upload attempts.

---

## 4. Module 3: Employer Discovery & Capability Matching
### Feature 4.1: Capability Spec Builder
* **Description:** Replaces traditional job descriptions with strict operational criteria.
* **Behavior:** Allows hiring managers to define required skill tags, minimum verified execution counts, and geographic/delivery zones.

### Feature 4.2: Zero-Knowledge Talent Search
* **Description:** Privacy-first candidate discovery engine.
* **Behavior:** Surfaces candidate cards based purely on verified performance metrics and skill scores, masking personal identity details until a mutual connection or invitation is accepted.

### Feature 4.3: Direct Invitation Pipeline
* **Description:** Streamlined connection workflow bypassing traditional resume screening queues.
* **Behavior:** Enables employers to send direct interview or job offers to pre-verified candidates based on their proven execution record.

---

## 5. Module 4: Training Provider & Micro-Credentialing
### Feature 5.1: Institutional Milestone Issuance
* **Description:** Tooling for vocational schools, bootcamps, and trade institutes to endorse student progress.
* **Behavior:** Allows instructors to sign off on practical workshop tests, minting official dual-backed micro-credentials onto the student's capability graph.

### Feature 5.2: Real-Time Market Demand Dashboard
* **Description:** Live data feedback loop for educational program design.
* **Behavior:** Aggregates regional employment data and rejection metrics to show training providers which specific technical or hands-on skills are currently undersupplied in the market.
