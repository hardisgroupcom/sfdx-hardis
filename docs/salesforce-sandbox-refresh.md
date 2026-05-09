---
title: Salesforce Full Sandbox Refresh - Save & Restore Everything
description: Learn how to refresh a full Salesforce sandbox without losing Connected Apps, External Client Apps, certificates, custom settings, and records
---
<!-- markdownlint-disable MD013 -->

## Overview

Refreshing a sandbox in Salesforce **wipes all configuration and credentials** that were set up after its creation. This includes:

- **Connected Apps** (Consumer Key & Secret lost)
- **External Client Apps** (OAuth credentials lost)
- **Certificates** (deleted from the org)
- **SAML SSO configurations** (certificates detached)
- **Custom Settings** (data erased)
- **Records** (data erased)
- **Other metadata** you chose to preserve

sfdx-hardis provides two commands that together make sandbox refreshes painless:

| Step               | Command                                | What it does                           |
|--------------------|----------------------------------------|----------------------------------------|
| **Before refresh** | `sf hardis:org:refresh:before-refresh` | Backs up everything that would be lost |
| **After refresh**  | `sf hardis:org:refresh:after-refresh`  | Restores everything from the backup    |

Both commands are available in the contextual actions in VsCode extension feature **Orgs Manager**.

> **The first run must always be interactive.** The interactive prompts let you choose which Connected Apps, External Client Apps, Custom Settings and data workspaces to back up, and persist your choices to `refreshSandboxConfig` in `config/.sfdx-hardis.yml`. Once that block exists, subsequent runs can be invoked non-interactively by an AI agent or CI job using the `--agent` flag (see [Agent / non-interactive mode](#agent--non-interactive-mode)).

<iframe width="560" height="315" src="https://www.youtube.com/embed/cMzzWDIARbo" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

---

## Prerequisite: Migrate Connected Apps to External Client Apps

Since Spring'26, it is not possible to create Connected Apps except if you submit a request via a Salesforce Case.

It is therefore recommended to **migrate Connected Apps to External Client Apps before refreshing the sandbox**, as External Client Apps can be recreated with the same credentials without needing a Salesforce Case.

When you migrate a Connected App to an External Client App, the credentials are preserved and the app keeps working without any change for the users. You can migrate as many Connected Apps as you need.

## Step 1: Back up before the refresh

Run this command while connected to the sandbox you are about to refresh:

```shell
sf hardis:org:refresh:before-refresh --target-org <sandbox-alias>
```

The command is **fully interactive** - it will guide you through each section and let you choose what to save.

### What gets saved

| Item                                       | Where it is stored                                                           |
|--------------------------------------------|------------------------------------------------------------------------------|
| External Client Apps (+ OAuth credentials) | `scripts/sandbox-refresh/<sandbox>/force-app/…/externalClientApps/`          |
| Connected Apps (+ Consumer Secrets)        | `scripts/sandbox-refresh/<sandbox>/force-app/…/connectedApps/`               |
| Certificates                               | `scripts/sandbox-refresh/<sandbox>/force-app/…/certs/`                       |
| SAML SSO configs                           | `scripts/sandbox-refresh/<sandbox>/force-app/…/samlssoconfigs/`              |
| Custom Settings (as JSON)                  | `scripts/sandbox-refresh/<sandbox>/savedCustomSettings/`                     |
| Records (via SFDMU)                        | `scripts/sandbox-refresh/<sandbox>/data/`                                    |
| Other metadata                             | `scripts/sandbox-refresh/<sandbox>/manifest/package-metadata-to-restore.xml` |

### Connected Apps and External Client Apps deletion

In order to be able to recreate Connected Apps and External Client Apps with the same credentials, they need to be deleted from the org before the refresh. The command will automatically delete them after saving their details, and will keep a log of what was deleted so that they can be re-created in the after-refresh step.

---

## Step 2: Refresh the sandbox in Salesforce

Trigger the sandbox refresh normally from **Salesforce Setup → Sandboxes**. 
Wait until the refresh is complete and you can log in again.

> **Important:** Do **not** run the after-refresh command until the sandbox is fully refreshed and accessible.

---

## Step 3: Restore after the refresh

Once the refreshed sandbox is available, run:

```shell
sf hardis:org:refresh:after-refresh --target-org <refreshed-sandbox-alias>
```

The command will ask you to pick the backup folder created in Step 1, then restore each item in the correct order.

### What gets restored (in order)

1. **Certificates** - re-deployed via Metadata API
2. **Other metadata** - deployed from `package-metadata-to-restore.xml`
3. **SAML SSO configs** - XML is updated with the restored certificates and deployed
4. **Custom Settings** - records are re-imported from the saved JSON files
5. **Records** - data is re-imported via SFDMU workspaces
6. **External Client Apps** - all 5 metadata types deployed with their original OAuth credentials
7. **Connected Apps** - re-deployed with the saved Consumer Secrets (only if Connected Apps creation has been activated via a Salesforce Support case)

Each step asks for confirmation before making changes to the org.

---

## Agent / non-interactive mode

Both `before-refresh` and `after-refresh` can be invoked non-interactively with the `--agent` flag, so AI agents and automation pipelines can run them end-to-end. **However, this mode is intended for repeat runs only - the first run must always be interactive.**

> **WARNING - run with extreme caution.** Sandbox refresh is a sensitive operation. `before-refresh` may delete Connected Apps and External Client Apps from the source sandbox, and writes Consumer Secrets and OAuth credentials to disk. `after-refresh` deploys credentials and metadata to a freshly-refreshed org. A misconfigured agent run can destroy credentials in the wrong org or restore stale data over fresh data. Always validate the resolved selections, the target org, and the backup folder before letting an agent run these commands unattended. Never commit the `scripts/sandbox-refresh/<sandbox>/` folder to version control - it contains plaintext Consumer Secrets and OAuth credentials.

### Why the first run must be interactive

The interactive prompts collect choices that have no safe default for an automated run:

- which Connected Apps to back up / restore
- which External Client Apps to back up / restore
- which Custom Settings to export / re-import
- which SFDMU data workspaces to export / re-import

These choices are saved to the `refreshSandboxConfig` block of `config/.sfdx-hardis.yml` (and committed to git like the rest of your project config). Once present, agent-mode runs reuse them automatically.

If you run with `--agent` before any of these choices have been made (and without explicit CLI flags), the command **fails fast** - it never silently expands to "all".

### Selection precedence in agent mode

For each item type, agent mode applies the first non-empty source from this list:

1. CLI flag (`--all`, `--name`, `--all-external-client-apps`, `--external-client-apps`, `--all-custom-settings`, `--custom-settings`, `--all-data-workspaces`, `--data-workspaces`)
2. The matching `refreshSandboxConfig.*` entry in `config/.sfdx-hardis.yml`
3. Otherwise: abort

### Typical agent-mode invocations

After running interactively at least once on this sandbox so that `refreshSandboxConfig` is populated:

```shell
# Re-run a backup using the previously saved selections
sf hardis:org:refresh:before-refresh --agent --target-org <sandbox-alias> --delete

# Restore from the most recently produced backup folder
sf hardis:org:refresh:after-refresh --agent --target-org <refreshed-sandbox-alias>
```

To override or bypass `refreshSandboxConfig` from the command line:

```shell
sf hardis:org:refresh:before-refresh --agent --target-org <sandbox-alias> \
  --all \
  --all-external-client-apps \
  --all-custom-settings \
  --all-data-workspaces \
  --delete

sf hardis:org:refresh:after-refresh --agent --target-org <refreshed-sandbox-alias> \
  --save-project-path scripts/sandbox-refresh/<sandbox> \
  --name "App1,App2" \
  --external-client-apps "EcaA,EcaB" \
  --custom-settings "MyCs1__c,MyCs2__c" \
  --data-workspaces "scripts/data/Accounts,scripts/data/Contacts"
```

### Things agent mode does NOT prompt for

- **Connected App Consumer Secrets** that the automated browser flow cannot extract: the command **fails** in agent mode (no manual fallback).
- **SAML SSO Config certificates**: the most recent active certificate created within the last year is auto-picked. If no such certificate exists, that SAML SSO Config is **skipped** with a warning.
- **Cached folders** (`connectedApps/`, `externalClientApps/`, `package-metadatas-to-save.xml`): if a previous run left them on disk, agent mode reuses them as-is. Delete them manually before running if you want a fresh retrieval.

---

## Frequently Asked Questions

**Can I run the commands in CI/CD pipelines?**

The first run must be interactive (a human must pick what to back up and restore). Once `refreshSandboxConfig` is committed to your project, subsequent runs can be triggered by an agent or CI job using `--agent`. Treat each automated run as a sensitive operation - validate the target org and the resolved selections before letting it proceed.

**What if I refreshed without running the before-refresh command first?**

Unfortunately there is no way to recover credentials that were not saved. For future refreshes, always run the before-refresh command first.

**Where are the backups stored?**

Under `scripts/sandbox-refresh/<sandbox-name>/` inside your SFDX project. Do not commit and push these backups to source control, they contain sensitive credentials.

**Does this work for Full sandboxes, Partial Copy, and Developer sandboxes?**

Yes, all sandbox types are supported as long as you can authenticate to them with the Salesforce CLI.

---

## Related commands

- [`sf hardis:org:refresh:before-refresh`](hardis/org/refresh/before-refresh.md): Full command reference
- [`sf hardis:org:refresh:after-refresh`](hardis/org/refresh/after-refresh.md): Full command reference
