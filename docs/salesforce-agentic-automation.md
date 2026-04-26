---
title: sfdx-hardis with AI Coding Agents
description: How to drive Salesforce DevOps tasks non-interactively with Claude Code, GitHub Copilot, Gemini CLI, Cursor, and other AI coding agents using the --agent flag
---
<!-- markdownlint-disable MD013 -->

# sfdx-hardis with AI Coding Agents

sfdx-hardis is built to work seamlessly with **AI coding agents** such as [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [GitHub Copilot](https://github.com/features/copilot), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Cursor](https://www.cursor.com/), [OpenAI Codex](https://openai.com/codex), and any other agent that can run shell commands and understands skills.

Over **130 commands** expose an `--agent` flag that switches to a fully **non-interactive, automation-safe** execution mode - no prompts, no blocking, predictable outputs.

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

### Devops

| Command                                                                               | What an agent can do                                                                                                                    |
|---------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| [**hardis:org:retrieve:packageconfig**](hardis/org/retrieve/packageconfig.md)         | Retrieve installed packages from an org and optionally update project config                                                            |
| [**hardis:org:retrieve:sources:analytics**](hardis/org/retrieve/sources/analytics.md) | Retrieve the full CRM Analytics configuration from an org                                                                               |
| [**hardis:project:create**](hardis/project/create.md)                                 | Scaffold a new SFDX project with sfdx-hardis configuration                                                                              |
| [**hardis:project:deploy:smart**](hardis/project/deploy/smart.md)                     | Smart-deploy SFDX sources with delta, dependency resolution, and pre/post hooks                                                         |
| [**hardis:scratch:pull**](hardis/scratch/pull.md)                                     | Pull the latest metadata changes from a scratch org into the local SFDX project                                                         |
| [**hardis:scratch:push**](hardis/scratch/push.md)                                     | Push local SFDX project metadata to the scratch org                                                                                     |
| [**hardis:work:new**](hardis/work/new.md)                                             | Create a new User Story Git branch and optionally provision a scratch org or sandbox - required flags: `--task-name`, `--target-branch` |
| [**hardis:work:resetselection**](hardis/work/resetselection.md)                       | Soft-reset staged commits to re-evaluate which changes go into the merge request                                                        |
| [**hardis:work:save**](hardis/work/save.md)                                           | Clean metadata, update `package.xml` / `destructiveChanges.xml`, commit, and push - optional: `--targetbranch`, `--noclean`, `--nogit`  |

### Monitoring

| Command                                                                                           | What an agent can do                                                                         |
|---------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| [**hardis:lint:access**](hardis/lint/access.md)                                                   | Check that all custom elements are accessible through at least one Permission Set or Profile |
| [**hardis:lint:metadatastatus**](hardis/lint/metadatastatus.md)                                   | Detect inactive metadata components in local project files                                   |
| [**hardis:lint:missingattributes**](hardis/lint/missingattributes.md)                             | Identify custom fields that have no description (documentation enforcement)                  |
| [**hardis:lint:unusedmetadatas**](hardis/lint/unusedmetadatas.md)                                 | Find custom labels and permissions that are defined but never referenced in code             |
| [**hardis:org:diagnose:apex-api-version**](hardis/org/diagnose/apex-api-version.md)               | Find Apex classes deployed with API versions below a configurable threshold                  |
| [**hardis:org:diagnose:audittrail**](hardis/org/diagnose/audittrail.md)                           | Export Setup Audit Trail to CSV, highlighting suspect admin actions                          |
| [**hardis:org:diagnose:deployments**](hardis/org/diagnose/deployments.md)                         | Query DeployRequest records to analyze recent deployments and validations                    |
| [**hardis:org:diagnose:flex-queue**](hardis/org/diagnose/flex-queue.md)                           | Count `AsyncApexJob` records in the Apex flex queue (status = Holding)                       |
| [**hardis:org:diagnose:instanceupgrade**](hardis/org/diagnose/instanceupgrade.md)                 | Show the scheduled date of the next Salesforce major release for the org's instance          |
| [**hardis:org:diagnose:legacyapi**](hardis/org/diagnose/legacyapi.md)                             | Detect calls to retired or soon-to-be-retired API versions                                   |
| [**hardis:org:diagnose:licenses**](hardis/org/diagnose/licenses.md)                               | Full overview of Salesforce license consumption                                              |
| [**hardis:org:diagnose:minimalpermsets**](hardis/org/diagnose/minimalpermsets.md)                 | Find permission sets with very few permissions (possible candidates for cleanup)             |
| [**hardis:org:diagnose:releaseupdates**](hardis/org/diagnose/releaseupdates.md)                   | Export Release Updates to CSV and flag those requiring action                                |
| [**hardis:org:diagnose:storage-stats**](hardis/org/diagnose/storage-stats.md)                     | Analyze data storage consumption by object with flexible grouping                            |
| [**hardis:org:diagnose:underusedpermsets**](hardis/org/diagnose/underusedpermsets.md)             | Identify permission sets and groups that are rarely assigned                                 |
| [**hardis:org:diagnose:unsecure-connected-apps**](hardis/org/diagnose/unsecure-connected-apps.md) | Find Connected Apps with insecure OAuth settings                                             |
| [**hardis:org:diagnose:unused-apex-classes**](hardis/org/diagnose/unused-apex-classes.md)         | List async Apex classes (Batch/Queueable/Schedulable) not called for 365+ days               |
| [**hardis:org:diagnose:unused-connected-apps**](hardis/org/diagnose/unused-connected-apps.md)     | Find Connected Apps with no recent OAuth usage                                               |
| [**hardis:org:diagnose:unusedlicenses**](hardis/org/diagnose/unusedlicenses.md)                   | Identify Permission Set License Assignments no longer linked to an active Permission Set     |
| [**hardis:org:diagnose:unusedusers**](hardis/org/diagnose/unusedusers.md)                         | List users who have not logged in for N days - flag: `--days` (default 180)                  |
| [**hardis:org:monitor:all**](hardis/org/monitor/all.md)                                           | Run all configured monitoring checks, generate reports, and send notifications               |
| [**hardis:org:monitor:backup**](hardis/org/monitor/backup.md)                                     | Retrieve a full metadata backup of the org                                                   |
| [**hardis:org:monitor:errors**](hardis/org/monitor/errors.md)                                     | Check for Apex and Flow errors in the org                                                    |
| [**hardis:org:monitor:health-check**](hardis/org/monitor/health-check.md)                         | Run the Salesforce Security Health Check and report the score                                |
| [**hardis:org:monitor:limits**](hardis/org/monitor/limits.md)                                     | Check org limits and alert when thresholds are approaching                                   |
| [**hardis:project:audit:apiversion**](hardis/project/audit/apiversion.md)                         | Find metadata deployed below a configurable API version threshold                            |
| [**hardis:project:audit:callincallout**](hardis/project/audit/callincallout.md)                   | Identify Apex methods performing both DML and HTTP callouts in the same transaction          |
| [**hardis:project:audit:duplicatefiles**](hardis/project/audit/duplicatefiles.md)                 | Detect duplicate metadata files in the project tree                                          |
| [**hardis:project:audit:remotesites**](hardis/project/audit/remotesites.md)                       | Audit Remote Site Settings for completeness and security                                     |
| [**hardis:project:lint**](hardis/project/lint.md)                                                 | Run Mega-Linter across the full project for style, quality, and security checks              |
| [**hardis:project:metadata:findduplicates**](hardis/project/metadata/findduplicates.md)           | Find duplicate metadata definitions across the project                                       |

### Documentation

| Command                                                                               | What an agent can do                                                                                                     |
|---------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------|
| [**hardis:doc:extract:permsetgroups**](hardis/doc/extract/permsetgroups.md)           | Generate a detailed report of Permission Set Group assignments and included permission sets                              |
| [**hardis:doc:fieldusage**](hardis/doc/fieldusage.md)                                 | Display where custom fields are referenced across metadata components (impact analysis)                                  |
| [**hardis:doc:flow2markdown**](hardis/doc/flow2markdown.md)                           | Convert a Salesforce Flow metadata file into a human-readable Markdown description                                       |
| [**hardis:doc:mkdocs-to-cf**](hardis/doc/mkdocs-to-cf.md)                             | Publish MkDocs-generated documentation to Cloudflare Pages                                                               |
| [**hardis:doc:mkdocs-to-confluence**](hardis/doc/mkdocs-to-confluence.md)             | Synchronize MkDocs documentation to a Confluence space                                                                   |
| [**hardis:doc:mkdocs-to-salesforce**](hardis/doc/mkdocs-to-salesforce.md)             | Publish MkDocs documentation as Salesforce Knowledge articles                                                            |
| [**hardis:doc:object-field-usage**](hardis/doc/object-field-usage.md)                 | Measure field-level data completeness across sObjects for documentation and cleanup planning                             |
| [**hardis:doc:override-prompts**](hardis/doc/override-prompts.md)                     | Manage prompt override files for customizing AI-generated documentation output                                           |
| [**hardis:doc:packagexml2markdown**](hardis/doc/packagexml2markdown.md)               | Convert a `package.xml` into a human-readable Markdown change summary                                                    |
| [**hardis:doc:plugin:generate**](hardis/doc/plugin/generate.md)                       | Generate reference documentation for a Salesforce CLI plugin                                                             |
| [**hardis:doc:project2markdown**](hardis/doc/project2markdown.md)                     | Generate the full Salesforce project documentation as Markdown - objects, flows, profiles, Apex, LWC, packages, and more |
| [**hardis:project:generate:flow-git-diff**](hardis/project/generate/flow-git-diff.md) | Generate a visual Flow diff markdown between two commits for deployment review                                           |

### Org Utils

| Command                                                                                                       | What an agent can do                                                                |
|---------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| [**hardis:datacloud:extract:agentforce-conversations**](hardis/datacloud/extract/agentforce-conversations.md) | Export Agentforce conversation logs from Data Cloud for analysis                    |
| [**hardis:datacloud:extract:agentforce-feedback**](hardis/datacloud/extract/agentforce-feedback.md)           | Export user feedback records from Agentforce sessions in Data Cloud                 |
| [**hardis:datacloud:sql-query**](hardis/datacloud/sql-query.md)                                               | Run ad-hoc or predefined SQL queries on Data Cloud objects                          |
| [**hardis:org:community:update**](hardis/org/community/update.md)                                             | Programmatically publish or unpublish a Salesforce Community                        |
| [**hardis:org:data:delete**](hardis/org/data/delete.md)                                                       | Delete data from a Salesforce org using an SFDMU workspace configuration            |
| [**hardis:org:data:export**](hardis/org/data/export.md)                                                       | Export data from a Salesforce org using an SFDMU workspace configuration            |
| [**hardis:org:data:import**](hardis/org/data/import.md)                                                       | Import structured data into a Salesforce org from an SFDMU workspace                |
| [**hardis:org:files:export**](hardis/org/files/export.md)                                                     | Mass-download files attached to Salesforce records                                  |
| [**hardis:org:files:import**](hardis/org/files/import.md)                                                     | Mass-upload files and attach them to Salesforce records                             |
| [**hardis:org:fix:listviewmine**](hardis/org/fix/listviewmine.md)                                             | Fix list views whose scope `Mine` must be replaced with `Everything` for deployment |
| [**hardis:org:multi-org-query**](hardis/org/multi-org-query.md)                                               | Run a SOQL query against multiple orgs and aggregate results                        |
| [**hardis:org:purge:apexlog**](hardis/org/purge/apexlog.md)                                                   | Delete accumulated Apex debug logs from an org                                      |
| [**hardis:org:purge:flow**](hardis/org/purge/flow.md)                                                         | Delete obsolete Flow versions to reduce storage and technical debt                  |
| [**hardis:org:purge:profile**](hardis/org/purge/profile.md)                                                   | Remove permission attributes from Profiles after migrating to Permission Sets       |
| [**hardis:org:test:apex**](hardis/org/test/apex.md)                                                           | Run Apex tests in the target org and report pass / fail / coverage results          |
| [**hardis:org:user:activateinvalid**](hardis/org/user/activateinvalid.md)                                     | Fix `.invalid` email suffixes on sandbox users so they can log in                   |
| [**hardis:org:user:freeze**](hardis/org/user/freeze.md)                                                       | Freeze user logins (temporarily suspend access without deactivating)                |
| [**hardis:org:user:unfreeze**](hardis/org/user/unfreeze.md)                                                   | Unfreeze previously frozen users to restore their access                            |

### Metadata Utils

| Command                                                                                           | What an agent can do                                                                          |
|---------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| [**hardis:misc:purge-references**](hardis/misc/purge-references.md)                               | Remove or replace stale string references across metadata files                               |
| [**hardis:org:generate:packagexmlfull**](hardis/org/generate/packagexmlfull.md)                   | Generate a complete `package.xml` covering all metadata in an org, including managed packages |
| [**hardis:packagexml:append**](hardis/packagexml/append.md)                                       | Merge additional `package.xml` files into the project's main package.xml                      |
| [**hardis:packagexml:remove**](hardis/packagexml/remove.md)                                       | Remove specific types or members from a `package.xml` file                                    |
| [**hardis:project:clean:emptyitems**](hardis/project/clean/emptyitems.md)                         | Remove empty metadata XML items that produce unnecessary deployment noise                     |
| [**hardis:project:clean:filter-xml-content**](hardis/project/clean/filter-xml-content.md)         | Filter out specific XML nodes from metadata files using configurable rules                    |
| [**hardis:project:clean:flowpositions**](hardis/project/clean/flowpositions.md)                   | Normalize Flow element coordinates to reduce position-only git diffs                          |
| [**hardis:project:clean:hiddenitems**](hardis/project/clean/hiddenitems.md)                       | Remove metadata items that are hidden / private in the org and not deployable                 |
| [**hardis:project:clean:listviews**](hardis/project/clean/listviews.md)                           | Remove list views referencing unavailable fields or objects                                   |
| [**hardis:project:clean:manageditems**](hardis/project/clean/manageditems.md)                     | Remove managed package metadata items from the local project                                  |
| [**hardis:project:clean:minimizeprofiles**](hardis/project/clean/minimizeprofiles.md)             | Strip profiles down to the minimum permissions needed for the project                         |
| [**hardis:project:clean:orgmissingitems**](hardis/project/clean/orgmissingitems.md)               | Remove metadata from the project that is absent from the target org                           |
| [**hardis:project:clean:profiles-extract**](hardis/project/clean/profiles-extract.md)             | Extract profile access data into CSV / Excel persona-centric reports                          |
| [**hardis:project:clean:references**](hardis/project/clean/references.md)                         | Remove hardcoded user references, minimize profiles, and apply other automated cleaning rules |
| [**hardis:project:clean:retrievefolders**](hardis/project/clean/retrievefolders.md)               | Retrieve report and dashboard folder metadata to keep the project in sync with the org        |
| [**hardis:project:clean:sensitive-metadatas**](hardis/project/clean/sensitive-metadatas.md)       | Remove sensitive values (credentials, tokens) from metadata before committing                 |
| [**hardis:project:clean:standarditems**](hardis/project/clean/standarditems.md)                   | Remove references to standard Salesforce items not needed in the project                      |
| [**hardis:project:clean:systemdebug**](hardis/project/clean/systemdebug.md)                       | Strip `System.debug()` statements from Apex code before deployment                            |
| [**hardis:project:clean:xml**](hardis/project/clean/xml.md)                                       | Remove XML elements using glob patterns and XPath expressions                                 |
| [**hardis:project:convert:profilestopermsets**](hardis/project/convert/profilestopermsets.md)     | Convert Profile permissions into equivalent Permission Sets                                   |
| [**hardis:project:fix:profiletabs**](hardis/project/fix/profiletabs.md)                           | Manage tab settings inside profile XML files                                                  |
| [**hardis:project:fix:v53flexipages**](hardis/project/fix/v53flexipages.md)                       | Fix Flexipage metadata incompatibilities introduced by API v53                                |
| [**hardis:project:generate:bypass**](hardis/project/generate/bypass.md)                           | Generate bypass custom permissions and fields for automations on selected sObjects            |
| [**hardis:project:metadata:activate-decomposed**](hardis/project/metadata/activate-decomposed.md) | Activate decomposed metadata support for all supported types in the project                   |

### Package

| Command                                                                 | What an agent can do                                                     |
|-------------------------------------------------------------------------|--------------------------------------------------------------------------|
| [**hardis:package:create**](hardis/package/create.md)                   | Scaffold a new Salesforce package definition                             |
| [**hardis:package:install**](hardis/package/install.md)                 | Install a managed or unlocked package by its `04t` ID                    |
| [**hardis:package:mergexml**](hardis/package/mergexml.md)               | Merge multiple `package.xml` files into one                              |
| [**hardis:package:version:create**](hardis/package/version/create.md)   | Build a new immutable package version                                    |
| [**hardis:package:version:list**](hardis/package/version/list.md)       | List all available versions of a package with their IDs and status       |
| [**hardis:package:version:promote**](hardis/package/version/promote.md) | Promote a package version to released status for production installation |

### Miscellaneous

| Command                                                                                 | What an agent can do                                                                                          |
|-----------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| [**hardis:auth:login**](hardis/auth/login.md)                                           | Log in to a Salesforce org interactively or via JWT / connected-app OAuth                                     |
| [**hardis:cache:clear**](hardis/cache/clear.md)                                         | Clear the sfdx-hardis local cache (useful when encountering stale metadata or config data)                    |
| [**hardis:config:get**](hardis/config/get.md)                                           | Read and display the merged project / branch / user configuration for the current project                     |
| [**hardis:git:pull-requests:extract**](hardis/git/pull-requests/extract.md)             | Extract pull/merge request data from GitHub, GitLab, or Azure DevOps for reporting and auditing               |
| [**hardis:mdapi:deploy**](hardis/mdapi/deploy.md)                                       | Deploy a Metadata API format directory or zip to a Salesforce org                                             |
| [**hardis:misc:custom-label-translations**](hardis/misc/custom-label-translations.md)   | Isolate and export specific custom label translations                                                         |
| [**hardis:misc:servicenow-report**](hardis/misc/servicenow-report.md)                   | Retrieve Salesforce user stories and enrich them with ServiceNow data                                         |
| [**hardis:misc:toml2csv**](hardis/misc/toml2csv.md)                                     | Convert TOML structured data files to CSV format for reporting                                                |
| [**hardis:org:connect**](hardis/org/connect.md)                                         | Authenticate to an existing Salesforce org and register it in the local project config                        |
| [**hardis:org:create**](hardis/org/create.md)                                           | Provision a new sandbox with the automated setup steps defined in project config                              |
| [**hardis:org:retrieve:sources:dx**](hardis/org/retrieve/sources/dx.md)                 | Retrieve metadata from an org in SFDX source format                                                           |
| [**hardis:org:retrieve:sources:dx2**](hardis/org/retrieve/sources/dx2.md)               | Pull metadata from any org with fine-grained control via `package.xml`                                        |
| [**hardis:org:retrieve:sources:metadata**](hardis/org/retrieve/sources/metadata.md)     | Retrieve metadata using Metadata API format into the local project                                            |
| [**hardis:org:retrieve:sources:retrofit**](hardis/org/retrieve/sources/retrofit.md)     | Retrofit an existing org into an SFDX project by retrieving all current metadata                              |
| [**hardis:project:deploy:notify**](hardis/project/deploy/notify.md)                     | Send deployment or simulation status notifications to configured team channels                                |
| [**hardis:project:deploy:quick**](hardis/project/deploy/quick.md)                       | Quickly deploy a previously validated set of changes                                                          |
| [**hardis:project:deploy:simulate**](hardis/project/deploy/simulate.md)                 | Dry-run a deployment to check what would be deployed without touching the org                                 |
| [**hardis:project:deploy:sources:metadata**](hardis/project/deploy/sources/metadata.md) | Deploy sources in Metadata API format to a target org                                                         |
| [**hardis:project:deploy:start**](hardis/project/deploy/start.md)                       | Run a full deployment pipeline (sfdx-hardis wrapper for `sf project deploy start`) with error tips            |
| [**hardis:project:deploy:validate**](hardis/project/deploy/validate.md)                 | Check-only validate a deployment without applying changes to the org                                          |
| [**hardis:project:generate:gitdelta**](hardis/project/generate/gitdelta.md)             | Generate a `package.xml` delta from git history using sfdx-git-delta                                          |
| [**hardis:project:skills:import**](hardis/project/skills/import.md)                     | Import AI coding agent skill configurations from a remote repository into `.claude/`                          |
| [**hardis:scratch:create**](hardis/scratch/create.md)                                   | Provision a complete scratch org including package installation, metadata deployment, and data initialization |
| [**hardis:scratch:delete**](hardis/scratch/delete.md)                                   | Delete one or more scratch orgs to free up limits                                                             |
| [**hardis:scratch:pool:localauth**](hardis/scratch/pool/localauth.md)                   | Authenticate locally to a scratch org fetched from the pool                                                   |
| [**hardis:scratch:pool:refresh**](hardis/scratch/pool/refresh.md)                       | Rebuild and replenish all scratch orgs in the configured pool                                                 |
| [**hardis:scratch:pool:reset**](hardis/scratch/pool/reset.md)                           | Empty and reinitialize the scratch org pool (full rebuild)                                                    |
| [**hardis:scratch:pool:view**](hardis/scratch/pool/view.md)                             | Display pool status - capacity, available, expired, and in-use orgs                                           |
| [**hardis:source:deploy**](hardis/source/deploy.md)                                     | Deploy local SFDX project sources to a Salesforce org                                                         |
| [**hardis:source:push**](hardis/source/push.md)                                         | Push local SFDX sources to a scratch org                                                                      |
| [**hardis:source:retrieve**](hardis/source/retrieve.md)                                 | Retrieve metadata from an org and update local SFDX sources                                                   |
| [**hardis:work:refresh**](hardis/work/refresh.md)                                       | Pull latest changes from target branch, merge, and push to the current scratch org or sandbox                 |

---

## See Also

- [Using AI Coding Agents - Detailed Guide](salesforce-ci-cd-agent-skills.md) - step-by-step skills for Claude Code, Copilot, and other agents
- [Coding Agent Auto-Fix](salesforce-deployment-agent-autofix.md) - auto-fix deployment errors with AI agents
- [AI Setup](salesforce-ai-setup.md) - configure LLM providers (Claude, OpenAI, Gemini, Ollama) for sfdx-hardis AI features
- [Deployment Agent](salesforce-deployment-agent-home.md) - AI-assisted deployment error resolution
