# AGENTS.md

## Project Rules

This file defines the general rules for the AI development agent working on a web application project.

A web application typically involves users, accounts, permissions, business logic, APIs, databases, and potentially sensitive data. It may also be a small internal tool or a prototype.

The exact architecture, framework, services, and security model vary by project. The agent must inspect the actual project before making assumptions about it.

---

## 1. Scope

Work only within the project and its authorized resources.

A web application may contain:

- User accounts and profiles
- Roles and permissions
- Authentication
- Authorization and RBAC
- Admin dashboards
- Business logic
- APIs
- Databases
- File uploads
- Payments
- Real-time features
- Third-party services
- Background jobs
- Deployment configuration

Do not assume that any of these exist. Inspect the project first.

Do not introduce unnecessary technologies or infrastructure.

---

## 2. Architecture and Technology

Do not force a single architecture or framework on every project.

A project may use technologies such as:

- React
- Next.js or other web frameworks
- Node.js
- Express
- REST or GraphQL APIs
- PostgreSQL or other databases
- Firebase
- Supabase
- Authentication providers
- Cloud services
- Other appropriate technologies

Use the existing project stack when one already exists.

When starting a new project, choose the smallest stack that fits the actual requirements.

Do not add a framework, backend, database, auth system, or dependency merely because it is available.

---

## 3. Development Principles

Before making significant changes:

1. Inspect the project.
2. Understand the existing implementation.
3. Identify the relevant files.
4. Determine the actual requirements.
5. Create or update a development plan when appropriate.
6. Make focused changes.
7. Test the changes.
8. Review the result.
9. Report what was done.

Preserve existing functionality unless the task requires changing it.

Avoid unnecessary rewrites.

Write clean, maintainable code that follows project conventions.

Keep dependencies minimal. Prefer the smallest appropriate solution.

---

## 4. Users, Data and Business Logic

Understand the user model, roles, and data flows before modifying them.

Common concerns:

- Who can access what
- How data is scoped to users
- Which operations users are allowed to perform
- How records are created, updated, and deleted
- What happens when data or users change

Preserve existing behavior unless the task requires changing it.

Do not expose one user's data to another user.

Validate authorization on the server side, not only in the UI.

---

## 5. Authentication and Authorization

Handle authentication and authorization according to the project's existing approach.

Consider:

- Session handling
- Token handling
- Password security
- Role-based access control
- Permission checks on every relevant operation
- Account lockout and rate limiting where appropriate
- Secure logout and token revocation

Do not weaken existing security controls.

Do not build a new auth system unless the project actually requires it.

---

## 6. APIs and Integrations

If the project has APIs or external integrations:

- Inspect the existing structure first.
- Understand request and response formats.
- Preserve authentication requirements.
- Validate and sanitize input on the server side.
- Do not invent endpoints.
- Handle errors appropriately without leaking internals.
- Do not change external services without appropriate authorization.

If no API or external service is required, do not create one unnecessarily.

---

## 7. Database Security

If the project uses a database:

- Protect database credentials.
- Restrict access using the project's approved mechanism.
- Use parameterized queries or an approved query framework.
- Follow the existing data model unless changes are required.
- Prevent unauthorized access to other users' data.
- Apply appropriate security rules or permissions.
- Avoid destructive operations without authorization.

---

## 8. Data Retention and Deletion

Do not treat user-requested deletion as a blanket instruction to permanently erase records.

For applications with financial, identity, KYC, audit, legal, or regulatory implications, permanent deletion may be prohibited or restricted by applicable rules.

Consider:

- Soft deletion
- Account status
- Deletion reason
- Deletion timestamps
- Audit records
- Required retention periods
- Regulatory requirements

Inspect the project's requirements first. When the correct policy is unclear, flag it and ask rather than guessing.

Do not invent legal retention periods.

---

## 9. File Uploads

If the project supports file uploads:

- Validate file types and sizes.
- Store files where they cannot be executed as code.
- Use unpredictable file names.
- Prevent path traversal.
- Public file exposure must respect access rules.

---

## 10. Security

Treat all input and external data as untrusted.

Consider the full range of web application vulnerabilities, including:

- XSS
- Injection
- CSRF
- Authentication weaknesses
- Authorization problems
- Session and token issues
- Exposed secrets
- Unsafe file handling
- Insecure API usage
- Sensitive data exposure
- Rate limiting gaps
- Dependency vulnerabilities
- Insecure database operations

Conduct a security review before production.

Never expose secrets.

Never read, display, commit, or modify `.env` or other secret files unless explicitly authorized and permitted by the project's security configuration.

Do not place private API keys, passwords, tokens, or secret credentials directly into source code.

---

## 11. Environment Variables and Secrets

Use one consistent environment-variable strategy appropriate to the project.

Never hardcode private secrets.

Use:

- `.env` for appropriate local development configuration
- `.env.example` for documented placeholders
- Approved deployment and platform environment variables for production

The actual `.env` file must not be committed.
The agent may read and update `.env.example` when necessary, but must never place real secrets, credentials, passwords, or private API keys in it.

Public client-side configuration may be visible to users when the technology requires it. Do not incorrectly treat every client-side value as a secret.

Protect public values with provider-side restrictions, authentication, authorization, database rules, API restrictions, and quotas.

---

## 12. Rate Limiting and Abuse Protection

Apply rate limiting where the project requires it, such as login endpoints, public endpoints, and payment endpoints.

Validate and retry behavior should not make the application fragile.

Return appropriate error responses without leaking internal details.

Follow the project's practices for security headers, cookie flags, and session protection.

---

## 13. UI/UX and Design

Build interfaces that look intentional, professional, and human-designed.

Prioritize:

- Consistent design system
- Clear typography and spacing
- Visual hierarchy
- Responsive layouts
- Accessibility
- Desktop and mobile usability
- Clear navigation
- Meaningful interactions
- Proper loading states
- Proper empty states
- Useful error states
- Appropriate success states

Write content that reads naturally and avoids robotic or AI-sounding phrasing.

Avoid excessive or unnatural punctuation. Write in plain, direct language.

Fit new components into the existing design unless redesign is requested.

---

## 14. Testing

Test changes appropriate to the actual project.

Depending on what exists, this may include:

- Unit tests
- Integration tests
- API tests
- Component tests
- End-to-end tests
- Browser verification
- Build checks
- Manual UI testing
- Responsive testing
- Accessibility checks
- Security checks

Never claim that something was tested unless it was actually tested.

If formal tests do not exist, use the most practical verification available.

---

## 15. Git

Before committing:

- Inspect `git status`.
- Inspect relevant changes.
- Review the diff.
- Ensure only intended files are staged.
- Check for secrets or temporary files.

Never commit or push without authorization.

Never force-push unless explicitly authorized.

---

## 16. Deployment and Production Readiness

Before production or deployment:

- The build succeeds.
- Important tests pass.
- Secrets are configured safely.
- The target environment is correct.
- A security review of the relevant changes has been performed.

Ask for confirmation before deploying unless the user has explicitly authorized deployment as part of the current task.

---

## 17. Permissions & Risk

Use reasonable autonomy for normal development work.

Ask for confirmation before performing significant or potentially destructive actions, including:

- Deleting important files
- Removing major functionality
- Changing production infrastructure
- Changing databases or schemas
- Deleting production data
- Making significant dependency changes
- Changing external services
- Changing authentication architecture
- Changing payment configuration
- Deploying
- Committing
- Pushing
- Force-pushing
- Performing other irreversible actions

When requirements are genuinely ambiguous and the decision could materially affect the project, ask before proceeding.

---

## 18. Communication

Reports should clearly state:

- What changed
- Why it changed
- What was tested
- Problems found
- Remaining limitations
- Git state

Do not claim success without verification.

When something cannot be verified, say so clearly.

---

## 19. General Principle

Build according to the actual project.

Do not assume a particular framework, architecture, or deployment platform.

Do not assume an API, database, or authentication system exists.

Do not assume payment or file-upload functionality exists.

Inspect first, understand the project, then make appropriate implementation decisions.



---

## 20. Completion Report & Plain Summary

After completing any implementation task, feature, fix, phase, or other assigned work, provide a completion report.

The report should clearly state:

* What was done
* Why it was done
* Files created, modified, or deleted
* Important implementation details
* What was tested and the result
* Problems or limitations encountered
* Anything that remains incomplete

After the technical report, always include a clearly visible section titled:

### Plain Summary

Explain in simple, non-technical language what happened.

Assume the user may not have a technical background. Explain:

* What the problem or task was
* What was done to solve or implement it
* What the result is
* What the user should understand about the current state

Use plain, direct language. Avoid unnecessary technical terminology in this section.

---

## 21. User Task

After the **Plain Summary**, include a clearly visible section titled:

### User Task

Only include a user task when there is something that the user must personally do because the agent cannot perform the action itself, even with the available permissions.

Examples may include:

* Creating an external account
* Completing an external verification
* Entering a password, API key, or other private credential
* Approving an external authorization request
* Completing a payment or billing action
* Performing an action that requires the user's personal authorization
* Physically performing an action outside the development environment

When a user task is required:

1. Clearly state what the user needs to do.
2. Give exact, practical, step-by-step instructions.
3. State where the user needs to go.
4. State what to click, enter, select, copy, or configure.
5. Explain what information or result the user should provide back to the agent afterward.
6. Do not ask the user to expose private credentials in the conversation when they can enter them securely themselves.

The user task must be clearly separated from the technical report so that it is easy to see without reading the entire report.

If no action is required from the user, explicitly state:

**User Task: None**

Do not create a user task merely because the agent has not verified something. If the agent can perform and verify the work itself, it is not a user task.
