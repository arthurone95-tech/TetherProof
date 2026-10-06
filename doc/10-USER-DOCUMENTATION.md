# 10-USER-DOCUMENTATION.md

**Product:** TetherProof

## 1. Overview
This document outlines the user-facing guides, onboarding flows, and help documentation for the verified capability platform. It ensures that all three user segments—Workers, Employers, and Training Providers—can easily navigate and utilize the platform without friction.

---

## 2. Onboarding & Account Creation
* **Universal Sign-Up:** Users access the platform via any mobile or desktop web browser. They register using a mobile phone number or email address and select their primary role (`Worker`, `Employer`, or `Training Provider`).
* **Role-Based Redirection:** Upon login, users are automatically routed to their tailored dashboard interface optimized for their specific workflow.

### Creating Your Account
Enter your name, your email address, and a password of at least 12 characters that includes an
uppercase letter, a lowercase letter, and a number — `Sunrise2026Falls` would do — then type it a
second time in the confirmation box. The two must be the same, and if they are not the form says so
under the second box instead of letting a mistyped password become an account you cannot sign in to.

Underneath sits a strength bar reading **Weak**, **Medium**, or **Strong**, which changes as you
type. It reads Weak until the password meets the rules, Medium once it does, and Strong from
sixteen characters. The minimum itself stays at twelve. Every password box on this page — the two
here and the one on sign-in — also has an eye button beside it: the text is hidden as dots to start,
and pressing the button shows what you actually typed.

If your password does not meet the rules, the reason appears directly under the password box, naming
what is missing, so there is no guessing which rule you broke. The same applies to an email address
the platform will not accept: the message shows against that field.

Once the account exists, the form takes you to the confirmation screen itself rather than leaving a
link at the bottom of the page to find. That screen tells you a code was sent, names the address it
went to with the middle of it masked — `p***@example.com` — and has your email address filled in
already. Type the code from the email into the box underneath and press **Confirm and sign in**.
Until then you have an account but not a working session, which is why the screen also offers to
send the code again if it does not arrive.

That message may also contain a link. Opening it confirms the account and signs you in straight
away, taking you to the page for your role — no code to type. The link works from any port or
address the platform is running on, because it is built from the page you registered on rather than
written down in advance. If it has already been opened, or a day has passed, it will say so and
point you back to sign in, where a fresh code can be requested.

### Deleting Your Account
From the signed-in home page, open **Delete your account**, then **Delete your account** again on
the confirmation page. You are signed out and taken back to the landing page, which tells you the
deletion went through.

What that does:

* Your account, your profile, your name, your contact details, and your location are removed
  straight away.
* The work you logged **stays on the platform**, with everything that identifies you taken off it —
  the description is replaced, and the coordinates recorded with it are cleared. The skill, the
  verification, and the date remain.
* Your uploaded photo or audio file is removed from storage as part of the same action. If any
  file could not be removed at the moment you asked, the page says how many are still on their
  way out rather than claiming a clean result.

The work stays because proof counts are shared: if one person's records vanished, the totals other
people rely on would quietly change, and so would the reputation built on them. This is the same
reason the confirmation page states it plainly rather than promising that everything disappears.

Deletion cannot be undone, and there is no way to get the account back afterwards.

---

## 3. Worker User Guide (Portfolio & Proofs)
* **Building Your Profile:** Workers don't write traditional resumes. Instead, they select their trade or profession (e.g., *Refrigeration Technician, Teacher, Software Engineer*) and add skill tags.
* **Logging Completed Work:**
  * *For Field/Trade Workers:* Tap **"Log Work via Voice"** to speak a brief description, or tap **"Add Photo Proof"** to snap a picture of completed work.
  * *For Digital Workers:* Connect automated telemetry (GitHub, Jira) to log project milestones seamlessly.
* **Getting Client Verification:** Once a task is logged, the app sends a quick text or WhatsApp message to the client. When the client taps "Yes," the verified milestone instantly boosts the worker's secure capability score.
* **Responding to Direct Offers:** Workers check their **Offers Inbox** for direct interview invitations from employers, which they can accept or decline with a single tap.

---

## 4. Employer User Guide (Hiring & Talent Discovery)
* **Creating a Capability Spec:** Instead of writing a long, biased job description, employers define precise operational requirements: required skill tags, minimum verified execution counts, and location radius.
* **Zero-Knowledge Talent Search:** Search the talent pool based purely on verified performance scores and execution metrics. Candidate personal details remain anonymized to prevent hiring bias.
* **Sending Direct Offers:** When an employer finds a worker matching their capability threshold, they trigger a **Direct Offer**, instantly connecting with pre-verified talent and bypassing traditional resume spam.

---

## 5. Training Provider Guide (Schools & Institutes)
* **Registering the Institute:** Vocational schools, trade academies, and bootcamps register as verified educational partners and link their student rosters.
* **Issuing Practical Milestones:** Instructors use the milestone issuer tool to sign off on student workshop tests, minting dual-backed micro-credentials onto the student's live capability graph.
* **Using Market Demand Insights:** Training directors review live regional data feeds to identify local skill shortages and update classroom training in real time to match actual market demand.
