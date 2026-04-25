---
title: sfdx-hardis with AI Coding Agents
description: How to drive Salesforce DevOps tasks non-interactively with Claude Code, GitHub Copilot, Gemini CLI, Cursor, and other AI coding agents using the --agent flag
---
<!-- markdownlint-disable MD013 -->

# sfdx-hardis with AI Coding Agents

sfdx-hardis is built to work seamlessly with **AI coding agents** such as [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [GitHub Copilot](https://github.com/features/copilot), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Cursor](https://www.cursor.com/), [OpenAI Codex](https://openai.com/codex), and any other agent that can run shell commands and understands skills.

Over **70 commands** expose an `--agent` flag that switches to a fully **non-interactive, automation-safe** execution mode - no prompts, no blocking, predictable outputs.

---

## Why sfdx-hardis + AI Agents?

Salesforce DevOps involves many repetitive, multi-step operations: creating feature branches, cleaning metadata, deploying sources, diagnosing orgs, managing users and licenses... These tasks are ideal for AI agents:

- **Save tokens and time**: agents read clean terminal output instead of navigating verbose interactive UIs.
- **Zero prompt interruptions**: the `--agent` flag disables every interactive prompt, applying sensible defaults.
- **Fail fast**: if a required parameter is missing, the command exits immediately with a descriptive error listing available options.
- **Composable**: commands can be chained as agent tool calls or shell scripts.
- **Works everywhere**: any agent that understands skills and can run shell commands can drive sfdx-hardis - Claude Code, Copilot, Gemini, Cursor, Codex, or your own automation.

---

## The `--agent` Flag

Add `--agent` to any supported command to enable non-interactive mode:

```bash
# Create a new User Story branch without any prompts
sf hardis:work:new --agent --task-name "PROJ-123 Add account scoring" --target-branch integration

# Run a full org health check
sf hardis:org:monitor:all --agent --target-org myorg@example.com

# Diagnose unused users
sf hardis:org:diagnose:unusedusers --agent --days 180 --target-org myorg@example.com
```

In agent mode:

- All interactive `prompts()` calls are **disabled**.
- Required inputs must be provided as **CLI flags** - the command fails with a clear error if they are missing.
- Optional inputs apply **sensible defaults** (documented per command).

---

## Quick Start: Register sfdx-hardis as Agent Skills

All major coding agents support **skills** - markdown files that describe how to perform a task. Create skill files in your project and the agent will know how to drive sfdx-hardis.

**`<skills-folder>/new-user-story.md`**

```markdown
# New Salesforce User Story

When the user asks to start a new Salesforce User Story, run:

sf hardis:work:new --agent --task-name "<TICKET-ID> <description>" --target-branch <branch>

- Replace <TICKET-ID> and <description> with values from the user's request.
- Check config/.sfdx-hardis.yml for available target branches (usually `integration`).
- Do not pass --open-org unless explicitly asked.
```

**`<skills-folder>/save-work.md`**

```markdown
# Save Salesforce User Story

When the user asks to save or publish their Salesforce work:

1. Remind the user to stage and commit their pending metadata changes with git.
2. Run: sf hardis:work:save --agent

This will clean sources, update package.xml, and push to the remote.
If the target branch cannot be auto-resolved, add --targetbranch <branch>.
```

The skills folder depends on your agent:

| Agent          | Skills folder      |
|----------------|--------------------|
| Claude Code    | `.claude/skills/`  |
| GitHub Copilot | `.github/copilot/` |
| Gemini CLI     | `.gemini/skills/`  |
| Cursor         | `.cursor/skills/`  |
| OpenAI Codex   | `.codex/skills/`   |

See [Using AI Coding Agents](salesforce-ci-cd-agent-skills.md) for more detailed skill examples including org diagnostics.

---

## Docker Images with Agent CLIs Pre-installed

For CI/CD pipelines that need to run sfdx-hardis **and** an AI agent CLI in the same container:

```yaml
# GitHub Actions
image: hardisgroupcom/sfdx-hardis-ubuntu-with-agents:latest

# GitLab CI
image: hardisgroupcom/sfdx-hardis-with-agents:latest
```

These images include Claude Code, OpenAI Codex, Gemini CLI, GitHub Copilot, and Cursor pre-installed.

See [Installation](installation.md) for all available image variants.

---

## All Agent-Ready Commands

The table below lists every sfdx-hardis command that supports `--agent`. Click the command name to open its full reference page.

### Development Workflow

| Command                                                             | What an agent can do                                                                                                                    |
|---------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| [**hardis:work:new**](hardis/work/new.md)                           | Create a new User Story Git branch and optionally provision a scratch org or sandbox - required flags: `--task-name`, `--target-branch` |
| [**hardis:work:save**](hardis/work/save.md)                         | Clean metadata, update `package.xml` / `destructiveChanges.xml`, commit, and push - optional: `--targetbranch`, `--noclean`, `--nogit`  |
| [**hardis:work:refresh**](hardis/work/refresh.md)                   | Pull latest changes from target branch, merge, and push to the current scratch org or sandbox                                           |
| [**hardis:work:resetselection**](hardis/work/resetselection.md)     | Soft-reset staged commits to re-evaluate which changes go into the merge request                                                        |
| [**hardis:scratch:create**](hardis/scratch/create.md)               | Provision a complete scratch org including package installation, metadata deployment, and data initialization                           |
| [**hardis:scratch:delete**](hardis/scratch/delete.md)               | Delete one or more scratch orgs to free up limits                                                                                       |
| [**hardis:project:create**](hardis/project/create.md)               | Scaffold a new SFDX project with sfdx-hardis configuration                                                                              |
| [**hardis:project:skills:import**](hardis/project/skills/import.md) | Import AI coding agent skill configurations from a remote repository into `.claude/`                                                    |

### Source Retrieval & Deployment

| Command                                                                                           | What an agent can do                                                                                                                                  |
|---------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| [**hardis:project:deploy:smart**](hardis/project/deploy/smart.md)                                 | Smart-deploy SFDX sources with delta, dependency resolution, and pre/post hooks                                                                       |
| [**hardis:project:deploy:simulate**](hardis/project/deploy/simulate.md)                           | Dry-run a deployment to check what would be deployed without touching the org                                                                         |
| [**hardis:project:generate:gitdelta**](hardis/project/generate/gitdelta.md)                       | Generate a `package.xml` delta from git history using sfdx-git-delta                                                                                  |
| [**hardis:project:generate:flow-git-diff**](hardis/project/generate/flow-git-diff.md)             | Generate a visual Flow diff markdown between two commits                                                                                              |
| [**hardis:project:generate:bypass**](hardis/project/generate/bypass.md)                           | Generate bypass custom permissions and fields for automations on selected sObjects                                                                    |
| [**hardis:project:metadata:activate-decomposed**](hardis/project/metadata/activate-decomposed.md) | Activate decomposed metadata support for all supported types in the project                                                                           |
| [**hardis:org:retrieve:packageconfig**](hardis/org/retrieve/packageconfig.md)                     | Retrieve installed packages from an org and optionally update project config - flags: `--packages`, `--update-existing-config`, `--update-all-config` |
| [**hardis:org:retrieve:sources:analytics**](hardis/org/retrieve/sources/analytics.md)             | Retrieve the full CRM Analytics configuration from an org                                                                                             |
| [**hardis:org:retrieve:sources:dx2**](hardis/org/retrieve/sources/dx2.md)                         | Pull metadata from any org with fine-grained control via `package.xml`                                                                                |

### Org Diagnostics

| Command                                                                                           | What an agent can do                                                                     |
|---------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------|
| [**hardis:org:diagnose:unusedusers**](hardis/org/diagnose/unusedusers.md)                         | List users who have not logged in for N days - flag: `--days` (default 180)              |
| [**hardis:org:diagnose:unusedlicenses**](hardis/org/diagnose/unusedlicenses.md)                   | Identify Permission Set License Assignments no longer linked to an active Permission Set |
| [**hardis:org:diagnose:licenses**](hardis/org/diagnose/licenses.md)                               | Full overview of Salesforce license consumption                                          |
| [**hardis:org:diagnose:legacyapi**](hardis/org/diagnose/legacyapi.md)                             | Detect calls to retired or soon-to-be-retired API versions                               |
| [**hardis:org:diagnose:apex-api-version**](hardis/org/diagnose/apex-api-version.md)               | Find Apex classes deployed with API versions below a configurable threshold              |
| [**hardis:org:diagnose:audittrail**](hardis/org/diagnose/audittrail.md)                           | Export Setup Audit Trail to CSV, highlighting suspect admin actions                      |
| [**hardis:org:diagnose:deployments**](hardis/org/diagnose/deployments.md)                         | Query DeployRequest records to analyze recent deployments and validations                |
| [**hardis:org:diagnose:flex-queue**](hardis/org/diagnose/flex-queue.md)                           | Count `AsyncApexJob` records in the Apex flex queue (status = Holding)                   |
| [**hardis:org:diagnose:instanceupgrade**](hardis/org/diagnose/instanceupgrade.md)                 | Show the scheduled date of the next Salesforce major release for the org's instance      |
| [**hardis:org:diagnose:releaseupdates**](hardis/org/diagnose/releaseupdates.md)                   | Export Release Updates to CSV and flag those requiring action                            |
| [**hardis:org:diagnose:storage-stats**](hardis/org/diagnose/storage-stats.md)                     | Analyze data storage consumption by object with flexible grouping                        |
| [**hardis:org:diagnose:minimalpermsets**](hardis/org/diagnose/minimalpermsets.md)                 | Find permission sets with very few permissions (possible candidates for cleanup)         |
| [**hardis:org:diagnose:underusedpermsets**](hardis/org/diagnose/underusedpermsets.md)             | Identify permission sets and groups that are rarely assigned                             |
| [**hardis:org:diagnose:unsecure-connected-apps**](hardis/org/diagnose/unsecure-connected-apps.md) | Find Connected Apps with insecure OAuth settings                                         |
| [**hardis:org:diagnose:unused-apex-classes**](hardis/org/diagnose/unused-apex-classes.md)         | List async Apex classes (Batch/Queueable/Schedulable) not called for 365+ days           |
| [**hardis:org:diagnose:unused-connected-apps**](hardis/org/diagnose/unused-connected-apps.md)     | Find Connected Apps with no recent OAuth usage                                           |

### Org Monitoring

| Command                                                                   | What an agent can do                                                           |
|---------------------------------------------------------------------------|--------------------------------------------------------------------------------|
| [**hardis:org:monitor:all**](hardis/org/monitor/all.md)                   | Run all configured monitoring checks, generate reports, and send notifications |
| [**hardis:org:monitor:backup**](hardis/org/monitor/backup.md)             | Retrieve a full metadata backup of the org                                     |
| [**hardis:org:monitor:errors**](hardis/org/monitor/errors.md)             | Check for Apex and Flow errors in the org                                      |
| [**hardis:org:monitor:health-check**](hardis/org/monitor/health-check.md) | Run the Salesforce Security Health Check and report the score                  |
| [**hardis:org:monitor:limits**](hardis/org/monitor/limits.md)             | Check org limits and alert when thresholds are approaching                     |

### User Management

| Command                                                                   | What an agent can do                                                 |
|---------------------------------------------------------------------------|----------------------------------------------------------------------|
| [**hardis:org:user:freeze**](hardis/org/user/freeze.md)                   | Freeze user logins (temporarily suspend access without deactivating) |
| [**hardis:org:user:unfreeze**](hardis/org/user/unfreeze.md)               | Unfreeze previously frozen users to restore their access             |
| [**hardis:org:user:activateinvalid**](hardis/org/user/activateinvalid.md) | Fix `.invalid` email suffixes on sandbox users so they can log in    |

### Data & Files Management

| Command                                                         | What an agent can do                                                     |
|-----------------------------------------------------------------|--------------------------------------------------------------------------|
| [**hardis:org:data:export**](hardis/org/data/export.md)         | Export data from a Salesforce org using an SFDMU workspace configuration |
| [**hardis:org:data:import**](hardis/org/data/import.md)         | Import structured data into a Salesforce org from an SFDMU workspace     |
| [**hardis:org:data:delete**](hardis/org/data/delete.md)         | Delete data from a Salesforce org using an SFDMU workspace configuration |
| [**hardis:org:files:export**](hardis/org/files/export.md)       | Mass-download files attached to Salesforce records                       |
| [**hardis:org:files:import**](hardis/org/files/import.md)       | Mass-upload files and attach them to Salesforce records                  |
| [**hardis:org:multi-org-query**](hardis/org/multi-org-query.md) | Run a SOQL query against multiple orgs and aggregate results             |
| [**hardis:datacloud:sql-query**](hardis/datacloud/sql-query.md) | Run ad-hoc or predefined SQL queries on Data Cloud objects               |

### Metadata Cleaning & Quality

| Command                                                                               | What an agent can do                                                                          |
|---------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| [**hardis:project:clean:references**](hardis/project/clean/references.md)             | Remove hardcoded user references, minimize profiles, and apply other automated cleaning rules |
| [**hardis:project:clean:orgmissingitems**](hardis/project/clean/orgmissingitems.md)   | Remove metadata from the project that is absent from the target org                           |
| [**hardis:project:clean:profiles-extract**](hardis/project/clean/profiles-extract.md) | Extract profile access data into CSV / Excel persona-centric reports                          |
| [**hardis:project:clean:xml**](hardis/project/clean/xml.md)                           | Remove XML elements using glob patterns and XPath expressions                                 |
| [**hardis:project:fix:profiletabs**](hardis/project/fix/profiletabs.md)               | Manage tab settings inside profile XML files                                                  |
| [**hardis:org:purge:flow**](hardis/org/purge/flow.md)                                 | Delete obsolete Flow versions to reduce storage and technical debt                            |
| [**hardis:org:purge:apexlog**](hardis/org/purge/apexlog.md)                           | Delete accumulated Apex debug logs from an org                                                |
| [**hardis:org:purge:profile**](hardis/org/purge/profile.md)                           | Remove permission attributes from Profiles after migrating to Permission Sets                 |
| [**hardis:org:generate:packagexmlfull**](hardis/org/generate/packagexmlfull.md)       | Generate a complete `package.xml` covering all metadata in an org, including managed packages |

### Code Quality (Lint)

| Command                                                               | What an agent can do                                                                         |
|-----------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| [**hardis:lint:access**](hardis/lint/access.md)                       | Check that all custom elements are accessible through at least one Permission Set or Profile |
| [**hardis:lint:unusedmetadatas**](hardis/lint/unusedmetadatas.md)     | Find custom labels and permissions that are defined but never referenced in code             |
| [**hardis:lint:missingattributes**](hardis/lint/missingattributes.md) | Identify custom fields that have no description (documentation enforcement)                  |
| [**hardis:lint:metadatastatus**](hardis/lint/metadatastatus.md)       | Detect inactive metadata components in local project files                                   |
| [**hardis:misc:purge-references**](hardis/misc/purge-references.md)   | Remove or replace string references across metadata files (advanced refactoring)             |

### Package Management

| Command                                                                 | What an agent can do                                                     |
|-------------------------------------------------------------------------|--------------------------------------------------------------------------|
| [**hardis:package:install**](hardis/package/install.md)                 | Install a managed or unlocked package by its `04t` ID                    |
| [**hardis:package:create**](hardis/package/create.md)                   | Scaffold a new Salesforce package definition                             |
| [**hardis:package:version:create**](hardis/package/version/create.md)   | Build a new immutable package version                                    |
| [**hardis:package:version:promote**](hardis/package/version/promote.md) | Promote a package version to released status for production installation |
| [**hardis:package:mergexml**](hardis/package/mergexml.md)               | Merge multiple `package.xml` files into one                              |

### Documentation Generation

| Command                                                                               | What an agent can do                                                                                                     |
|---------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------|
| [**hardis:doc:project2markdown**](hardis/doc/project2markdown.md)                     | Generate the full Salesforce project documentation as Markdown - objects, flows, profiles, Apex, LWC, packages, and more |
| [**hardis:doc:object-field-usage**](hardis/doc/object-field-usage.md)                 | Measure field-level data completeness across sObjects for documentation and cleanup planning                             |
| [**hardis:project:generate:flow-git-diff**](hardis/project/generate/flow-git-diff.md) | Generate a visual markdown diff of Flow changes between two commits                                                      |

### Git & Reporting

| Command                                                                               | What an agent can do                                                                            |
|---------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| [**hardis:git:pull-requests:extract**](hardis/git/pull-requests/extract.md)           | Extract pull/merge request data from GitHub, GitLab, or Azure DevOps for reporting and auditing |
| [**hardis:misc:servicenow-report**](hardis/misc/servicenow-report.md)                 | Retrieve Salesforce user stories and enrich them with ServiceNow data                           |
| [**hardis:misc:custom-label-translations**](hardis/misc/custom-label-translations.md) | Isolate and export specific custom label translations                                           |
| [**hardis:org:connect**](hardis/org/connect.md)                                       | Authenticate to a Salesforce org for one-off tasks                                              |
| [**hardis:org:create**](hardis/org/create.md)                                         | Provision a new sandbox environment with automated setup                                        |

### Community (Salesforce Sites)

| Command                                                           | What an agent can do                                         |
|-------------------------------------------------------------------|--------------------------------------------------------------|
| [**hardis:org:community:update**](hardis/org/community/update.md) | Programmatically publish or unpublish a Salesforce Community |

---

## See Also

- [Using AI Coding Agents - Detailed Guide](salesforce-ci-cd-agent-skills.md) - step-by-step skills for Claude Code, Copilot, and other agents
- [Coding Agent Auto-Fix](salesforce-deployment-agent-autofix.md) - auto-fix deployment errors with AI agents
- [AI Setup](salesforce-ai-setup.md) - configure LLM providers (Claude, OpenAI, Gemini, Ollama) for sfdx-hardis AI features
- [Deployment Agent](salesforce-deployment-agent-home.md) - AI-assisted deployment error resolution
