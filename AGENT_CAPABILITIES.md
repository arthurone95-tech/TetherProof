# AGENT_CAPABILITIES.md

This document defines the general development capabilities available to the AI agent for web application projects.

The capabilities that apply to a particular project depend on its architecture, requirements, and permissions.

---

## 1. Inspect

The agent can:

- Inspect project structure.
- Read relevant source files.
- Examine configuration.
- Inspect existing functionality.
- Inspect the user model and data flow.
- Inspect authentication and authorization logic.
- Inspect API and database usage.
- Inspect dependencies.
- Inspect Git status and history.
- Identify project architecture and limitations.
- Analyze errors and existing behavior.

---

## 2. Create

The agent can create new project files when required.

Examples include:

- Frontend components and pages
- Backend routes and services
- API-related files
- Database models, migrations, and seeds
- Configuration files
- Tests
- Documentation
- Scripts
- Deployment-related files

Only create files that are required by the task.

---

## 3. Edit

The agent can modify existing project files to implement requested improvements or fixes.

Principles:

- Preserve existing functionality.
- Match project conventions.
- Avoid unrelated rewrites.
- Keep changes focused.
- Do not degrade security controls.

---

## 4. Execute

The agent can run appropriate development commands permitted by the project.

Examples:

- Syntax checks
- Tests
- Build commands
- Development servers
- Linting
- Formatting
- Migration commands where appropriate
- Project inspection commands

Do not execute destructive or unauthorized commands.

---

## 5. Test

The agent can verify implemented changes using available testing methods.

Examples:

- Unit tests
- Integration tests
- API checks
- End-to-end tests
- Browser verification
- Manual verification
- Build verification
- Responsive checks
- Accessibility checks
- Security checks

Never claim an unexecuted test passed.

---

## 6. Review

The agent can review changes for:

- Correctness
- Security
- Auth and authorization coverage
- Data safety
- Requirement coverage
- Unintended changes
- UI/UX consistency
- Accessibility
- Maintainability
- Performance concerns
- Potential regressions

---

## 7. Git

When authorized, the agent can:

- Inspect status
- Inspect history
- Review diffs
- Stage intended files
- Create commits
- Inspect branches
- Inspect remotes
- Push changes

Commit and push operations require authorization according to project rules.

---

## 8. External Services

When appropriate and authorized, the agent can work with project integrations such as:

- Databases
- Authentication and identity providers
- Payment services
- Object storage and file hosting
- Real-time services
- Email and notification services
- Analytics services
- Cloud platforms
- Hosting providers
- CMS systems

The agent must first inspect the existing integration and understand its requirements.

---

## 9. Report

The agent can provide development reports containing:

- Changes made
- Files changed
- Tests performed
- Results
- Problems
- Security considerations
- Limitations
- Git state

---

## Capability Principle

Capabilities do not automatically grant permission to perform every action.

The agent must follow:

- `AGENTS.md`
- `AGENT_WORKFLOW.md`
- `AUTOMATION_WORKFLOW.md`
- `opencode.json`

Actual project requirements and permissions determine what actions are appropriate.