# 05-UI-UX-DOCUMENTATION.md

**Product:** TetherProof

## 1. Overview
This document defines the user interface (UI) and user experience (UX) standards for the verified capability platform. Because the platform serves both technical desk workers and hands-on trade workers, the design must prioritize extreme simplicity, mobile responsiveness, and zero-friction interactions.

---

## 2. Core Design Principles
* **Mobile-First for Field Users:** Trade workers (e.g., refrigeration technicians, builders, drivers) interact with the platform almost exclusively via mobile browsers. Interfaces must feature large touch targets, minimal typing, and fast loading times on lower-bandwidth networks.
* **Desktop Efficiency for Enterprises:** Employers and training administrators handling high-volume searches and data management use desktop views optimized for data density and structured filtering.
* **Zero-Friction External Views:** Client verification pages (accessed via SMS/WhatsApp links) must require zero app installation, zero sign-up, and complete their action in a single tap.
* **Human & Intentional Aesthetics:** Avoid robotic or cluttered layouts. Use clean typography, intuitive spacing, and clear visual hierarchy.

### 2.1 Iconography
* **One icon set, from Lucide:** every icon is imported by name from `lucide-react`. A product whose subject is verified capability cannot have three icon families — mismatched geometry is what makes an interface read as unfinished. Hand-drawn SVG is not accepted.
* **One stroke weight:** Lucide's default is 2, slightly heavier than this interface has always used, so each icon passes `strokeWidth={ICON_STROKE_WIDTH}` (`1.8`) rather than relying on the default. The constant lives in `apps/web/src/components/ui/icon.ts` and is the only place the weight is defined.
* **Size comes from Tailwind:** icons are sized by a class at the call site (`h-6 w-6`, `h-5 w-5`, `h-4 w-4`) so they sit on the same scale as the text and boxes around them, at any breakpoint. Icons are vectors, so a larger size on a wide screen stays sharp.
* **Colour is inherited:** icons are never given a colour of their own — they take `currentColor` from the container, which is how hover and active states already work.
* **Meaning never rests on the icon alone:** a decorative icon is `aria-hidden`; an icon that is the only content of a control carries an `aria-label` on the control, so a screen reader announces the action and not the shape.

---

## 3. Persona-Specific UI Views & Flows

### A. Worker Dashboard (Mobile-Optimized)
* **Home / Capability Profile:** A clean view showing the user's verified skill blocks with score badges and proof counts.
* **Quick Log Bar:** Prominent floating action buttons for **"Log Work via Voice"** and **"Add Photo Proof."**
* **Incoming Offers Inbox:** A dedicated tab for direct employer interview invitations with simple "Accept" or "Decline" toggles.

### B. Employer Dashboard (Desktop-Optimized)
* **Capability Spec Builder:** A step-by-step form replacing traditional job descriptions to set skill tags, verified execution counts, and location radiuses.
* **Zero-Knowledge Talent Feed:** An anonymized candidate card grid displaying proof metrics, verified execution counts, and trust scores without revealing PII.
* **Direct Invite Action:** A single-click modal to dispatch direct offers to selected candidate tokens.

### C. Training Provider Dashboard (Desktop/Tablet)
* **Student Roster:** List of enrolled learners linked to the institute.
* **Milestone Issuer:** Quick-action tool for instructors to sign off on practical workshop tests.
* **Market Demand Chart:** Visual data widget highlighting regional skill gaps and unmet employer demand.

### D. External Client Verification Page (SMS / WhatsApp Link View)
* **Layout:** Ultra-lightweight, single-screen mobile web page.
* **Content:** Displays task summary (e.g., *"Did Ama service your commercial fridge on Oct 3?"*).
* **Action:** Two large, high-contrast buttons: **[Yes, Work Completed]** and **[No / Report Issue]**. Instant success confirmation screen upon tapping.

---

## 4. UI States & Feedback
* **Loading States:** Clear skeleton loaders or subtle spinners during telemetry syncs and search queries.
* **Empty States:** Friendly, instructive empty states for new users (e.g., *"No verified skills yet. Tap below to log your first work milestone!"*).
* **Error States:** Human-readable error notifications (e.g., *"Photo metadata could not be verified. Please use a standard camera picture."*).

---

## 5. Responsive Breakpoints
* **Mobile (up to 767px):** Single-column layouts. Worker Dashboard, Training Provider roster lists, and the External Client Verification Page render at this size by default. Navigation collapses into a bottom tab bar with large touch targets.
* **Tablet (768px to 1023px):** Two-column card grids for the Training Provider Dashboard and Capability Spec forms. The External Client Verification Page remains single-screen.
* **Desktop (1024px and above):** Multi-column data-dense layouts for the Employer Dashboard, Zero-Knowledge Talent Feed, and Market Demand Chart. The Worker Dashboard expands to show the full capability graph.

---

## 6. Accessibility Standards
* **Semantic Structure:** Every view uses landmark elements, a single page-level heading, and hierarchical headings. Capability graph blocks are exposed as lists, not as unsemantic containers.
* **Keyboard Navigation:** All interactive controls, including the **"Log Work via Voice"** and **"Add Photo Proof"** buttons and the client confirmation buttons, are reachable and operable by keyboard with a visible focus indicator.
* **Contrast:** Text and interactive elements meet WCAG 2.1 AA contrast ratios. The **[Yes, Work Completed]** and **[No / Report Issue]** buttons maintain high contrast in both default and pressed states.
* **Status Messaging:** Verification outcomes, offer acceptances, and error notifications are announced to assistive technology through appropriate live regions rather than relying on colour or icon changes alone.
* **Media Alternatives:** Voice-logged milestones expose their speech-to-text transcription as selectable text, and uploaded photo proofs require descriptive alternative text supplied by the worker.

---

## 7. Brand & Content Voice
* **Product Name:** The platform is referred to as **TetherProof** in all user-facing copy.
* **Plain, Direct Language:** Interface labels, instructions, and error messages use short sentences and everyday words. Avoid jargon, internal terminology, and technical identifiers that only make sense to engineers.
* **No Exposed Internals:** Error messages never reveal stack traces, database details, or third-party service names. They state what happened in user terms and what the user can do next.
* **Neutral and Respectful:** Copy addresses users by role rather than by assumed identity, and avoids language that could be read as dismissive of non-technical work.

---

## Update 2026-11-14

Labels across nav tabs, headings and buttons now use one word per concept: Hiring / Business for
employers; Institute for training providers; My training for students; Log work for workers.
Training providers have their own details page at /trainer/details. The worker dashboard heading is
``Your work record`` and the public-page pill reads ``Public page: On / Off`` linking to Privacy.
