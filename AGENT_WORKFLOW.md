# AGENT_WORKFLOW.md

## Standard Web Application Development Workflow

Apply the following workflow to development tasks unless the task clearly requires a different sequence.

---

## 1. INSPECT

Inspect the actual project before making changes.

Check:

* Project structure
* Relevant files
* Existing functionality
* Configuration
* Dependencies
* User model, roles, and permissions
* API and database usage
* Authentication and authorization logic
* Git state
* Existing documentation

Do not work from assumptions.

---

## 2. UNDERSTAND

Determine:

* What the application currently does
* What the user wants
* How the relevant code works
* What technologies are being used
* Who the users are and what they can do
* Whether APIs, databases, authentication, payments, or external services are involved
* What constraints exist
* What files are relevant

Ask when important requirements are genuinely ambiguous.

---

## 3. PLAN

Create a focused implementation plan.

The plan should identify:

* What will change
* Which files will change
* Major implementation steps
* How the changes will be tested

Avoid unnecessary work.

---

## 4. IMPLEMENT

Implement the requested changes.

Principles:

* Make focused changes.
* Preserve working functionality.
* Follow existing project conventions.
* Avoid unnecessary rewrites.
* Do not add unrelated features.
* Keep dependencies minimal.
* Preserve or improve security controls.

---

## 5. TEST

Verify the implementation using appropriate methods.

Examples:

* Unit tests
* Integration tests
* API testing
* End-to-end tests
* Browser testing
* Build verification
* Manual interaction testing
* Responsive testing
* Accessibility checks
* Security checks

Use the most practical verification available rather than performing unnecessary testing.

---

## 6. REVIEW

Review the completed work.

Check:

* Requirements
* Code correctness
* Authentication and authorization
* Data safety
* Security
* UI/UX
* Accessibility
* Responsive behavior
* Unintended changes
* Regression risks

---

## 7. REPORT

Report:

* What changed
* What was tested
* Test results
* Problems or limitations
* Security considerations
* Git state

Never overstate what was verified.

---

## 8. NON-TECHNICAL EXPLANATION

After the normal report, briefly explain in plain, easy-to-understand language:

* What the problem was.
* What was changed.
* What benefit the change provides.
* Who benefits from the change, such as the user, admin, business, or other relevant users.

Avoid unnecessary technical terms.

---

## 9. MY ACTION REQUIRED

After the normal report and non-technical explanation, clearly state whether there is anything the user personally needs to do.

If an action is required:

* Clearly state what the user needs to do.
* Provide step-by-step instructions when necessary to complete the action correctly.

If no action is required, state:

**No action required from me.**

---

## Workflow Principle

The workflow is adaptable.

Not every web application requires the same framework, features, or tests.

Apply the stages according to the actual project.
