# AUTOMATION_WORKFLOW.md

## Web Application Automation & Decision Rules

This document defines how the AI agent should decide what it may do autonomously and what requires confirmation.

A web application may involve users, accounts, permissions, business logic, APIs, databases, payments, file uploads, external services, or deployment infrastructure.

---

# 1. SAFE AUTONOMOUS ACTIONS

The agent may normally perform routine development actions when they are within project scope.

Examples:

- Inspect files
- Read source code
- Create normal project files
- Edit relevant project files
- Run safe development commands
- Run tests
- Review changes
- Inspect Git status
- Inspect Git history
- Analyze errors
- Prepare plans
- Prepare reports
- Fix ordinary development errors
- Improve UI/UX within the requested scope

---

# 2. CONFIRMATION REQUIRED

Ask for confirmation before:

- Deleting important files
- Removing major functionality
- Making destructive changes
- Changing production systems
- Changing database schemas
- Deleting database data
- Making major dependency changes
- Changing external services
- Changing authentication architecture
- Changing authorization rules
- Changing payment configuration
- Deploying
- Creating commits
- Pushing to remote repositories
- Force-pushing
- Performing irreversible actions

---

# 3. SECRETS

Never:

- Expose secrets
- Print API keys unnecessarily
- Commit secrets
- Place private credentials in source code
- Send secrets to external services without authorization
- Read `.env` files unnecessarily

Use the project's approved environment-variable mechanism.

Public client-side configuration must be distinguished from actual private secrets.

---

# 4. AUTHENTICATION AND AUTHORIZATION

If the application uses authentication or authorization:

- Inspect the existing implementation first.
- Preserve session and token security.
- Verify access on the server side.
- Do not introduce new auth flows unless required.
- Do not weaken existing controls.

---

# 5. APIs

If the application uses APIs:

- Inspect the existing API structure first.
- Understand request and response formats.
- Preserve authentication requirements.
- Validate and sanitize input.
- Handle errors appropriately.
- Do not invent endpoints.
- Do not change external APIs without appropriate authorization.

If no API exists, do not create one unless the application actually requires it.

---

# 6. DATABASES AND USER DATA

If the application uses a database:

- Inspect the existing database architecture.
- Avoid destructive operations.
- Do not delete production data without explicit authorization.
- Verify user authorization on data operations.
- Treat database credentials as secrets.
- Ask before significant schema changes.

Do not blindly hard-delete records in applications with financial, legal, audit, or regulatory implications.

Preserve required audit and retention information.

Inspect the project's requirements and ask when the correct retention or deletion policy is unclear.

---

# 7. FILE UPLOADS

If the application supports file uploads:

- Inspect the existing upload flow.
- Validate file types and sizes.
- Store files safely.
- Do not allow uploaded files to be executed as code.
- Respect existing access rules.

---

# 8. DEPENDENCIES

Before adding a dependency:

- Determine whether it is actually necessary.
- Check whether the existing stack already provides the required capability.
- Prefer the smallest appropriate solution.
- Consider security and maintenance implications.

Significant dependency changes should be confirmed when they materially affect the project.

---

# 9. FILE OPERATIONS

The agent may normally:

- Read relevant project files.
- Create required files.
- Edit relevant files.

Before deleting or replacing important files, confirm when the action could cause data or functionality loss.

---

# 10. COMMANDS

Safe development commands may be executed as appropriate.

Commands that could:

- Delete data
- Delete important files
- Modify system configuration
- Modify the database
- Affect production
- Rewrite Git history

require appropriate confirmation.

---

# 11. GIT

The agent may inspect Git automatically.

The agent must not commit or push unless authorized.

Force-push requires explicit authorization.

Before committing:

- Check status.
- Review diff.
- Check intended files.
- Check for secrets.
- Confirm the commit scope.

---

# 12. DEPLOYMENT

Deployment is a consequential action.

Before deployment, verify:

- Build succeeds.
- Important tests pass.
- Intended files are included.
- Secrets are configured safely.
- The target environment is correct.

Ask for confirmation before deploying unless the user has explicitly authorized deployment as part of the current task.

---

# 13. DECISION RULE

When deciding whether to act:

### Safe + reversible + clearly within scope
→ Act.

### Potentially destructive or consequential
→ Ask first.

### Ambiguous requirement with significant consequences
→ Ask first.

### Secret or prohibited information
→ Do not expose it.

### When in doubt
→ Ask.