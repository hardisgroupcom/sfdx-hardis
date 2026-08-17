---
title: Salesforce Full Sandbox Refresh - Save & Restore Everything
description: Learn how to refresh a full Salesforce sandbox without losing Connected Apps, External Client Apps, certificates, custom settings, and records
---
<!-- markdownlint-disable MD013 -->

## Overview

Refreshing a sandbox in Salesforce **wipes all configuration and credentials** that were set up after its creation. This includes:

- **Connected Apps** (Consumer Key & Secret lost)
- **External Client Apps** (OAuth credentials lost)
- **External OAuth authentications** (OwnBackup, Microsoft Power Platform and other tools connected via "Log in with Salesforce": all their tokens are revoked)
- **Certificates** (deleted from the org)
- **SAML SSO configurations** (certificates detached)
- **Named Credentials, External Credentials & Auth Providers** (secrets and authenticated principals wiped)
- **Scheduled jobs and scheduled flows** (deactivated)
- **Custom Settings** (data erased)
- **Records** (data erased)
- **Other metadata** you chose to preserve

sfdx-hardis provides two commands that together make sandbox refreshes painless:

| Step               | Command                                | What it does                           |
|--------------------|----------------------------------------|----------------------------------------|
| **Before refresh** | `sf hardis:org:refresh:before-refresh` | Backs up everything that would be lost |
| **After refresh**  | `sf hardis:org:refresh:after-refresh`  | Restores everything from the backup    |

Both commands are available in the contextual actions in VsCode extension feature **Orgs Manager**.

<iframe width="560" height="315" src="https://www.youtube.com/embed/cMzzWDIARbo" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

---

## Prerequisite: Migrate Connected Apps to External Client Apps

Since Spring'26, it is not possible to create Connected Apps except if you submit a request via a Salesforce Case. Concretely: **a Connected App deleted by a sandbox refresh can not be restored**, while an External Client App can be recreated with the same credentials.

The before-refresh command handles this for you: it lists the Connected Apps that have no matching External Client App, warns that they will probably be lost, and pauses so you can convert them in Setup (App Manager). Once you confirm, it re-checks the org and saves the newly converted External Client Apps with their credentials.

When you migrate a Connected App to an External Client App, the credentials are preserved and the app keeps working without any change for the users. You can migrate as many Connected Apps as you need.

Since Winter '26, External Client Apps also support automated OAuth credential rotation, one more reason to prefer them over Connected Apps.

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
| Manual actions inventory                   | `scripts/sandbox-refresh/<sandbox>/manual-restore-inventory.json` (+ `.csv` and `xls/*.xlsx` for human reading) |

### Connected Apps and External Client Apps deletion

In order to be able to recreate Connected Apps and External Client Apps with the same credentials, they need to be deleted from the org before the refresh. The command will automatically delete them after saving their details, and will keep a log of what was deleted so that they can be re-created in the after-refresh step.

### What cannot be restored: the manual actions inventory

Some items have no credentials to save, so no tool can restore them. The before-refresh command detects them and writes them to `manual-restore-inventory.json`, which the after-refresh command turns into a checklist:

- **External OAuth authentications**: tools like OwnBackup or Microsoft Power Platform connect through "Log in with Salesforce". Their Connected App belongs to the vendor's org, so there is no Consumer Secret to back up. After the refresh, someone has to log in to the sandbox again from each tool. The command lists these apps with their users and last-used dates, by querying `ConnectedApplication` and `OauthToken`.
- **Auth Providers, Named Credentials and External Credentials**: their metadata is saved and restored, but Salesforce never includes secrets or authenticated principals in metadata. They must be re-entered or re-authenticated by hand.
- **Scheduled jobs and scheduled flows**: a refresh deactivates them. The inventory keeps the list of active jobs (name, type, cron expression, owner), and one Apex script per user is generated under `apex-scripts/` to reschedule the Scheduled Apex jobs. A scheduled job runs as the user who scheduled it, so each script must be executed as its user: as an admin, use "Login As" (Setup > Users) then paste the script content in Developer Console > Execute Anonymous. The after-refresh command offers to run your own script directly. Scheduled Flows re-create their schedule automatically once the Flow is active.

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
7. **Connected Apps** - discouraged and declined by default: the deploy is rejected unless Connected Apps creation has been activated via a Salesforce Support case. Convert them to External Client Apps before the refresh instead.
8. **Manual actions checklist** - external OAuth authentications to re-authorize, secrets to re-enter (Auth Providers, Named & External Credentials), scheduled jobs to re-enable (the command runs your own reschedule script and gives "Login As" + Execute Anonymous instructions for the other users' scripts), plus reminders for org settings reset by the refresh (email deliverability, `.invalid` user emails, endpoint URLs, Experience Cloud sites, Shield tenant secret rotation)

Each step asks for confirmation before making changes to the org. All performed and pending actions land in a CSV report, so it can be used as a handover document.

---

## Frequently Asked Questions

**Can I run the commands in CI/CD pipelines?**

No, this is a sensitive operation that requires supervision from a human.

**Why can't the commands restore my OwnBackup (or other external tool) connection?**

Tools like OwnBackup authenticate with "Log in with Salesforce": their Connected App lives in the vendor's org, so there is no Consumer Secret to save on your side, and all OAuth tokens are revoked by the refresh. Nobody can restore these connections automatically. The commands list them instead (with the users who were connected), so you know exactly which tools to reconnect after the refresh.

**What if I refreshed without running the before-refresh command first?**

Unfortunately there is no way to recover credentials that were not saved. For future refreshes, always run the before-refresh command first.

**Where are the backups stored?**

Under `scripts/sandbox-refresh/<sandbox-name>/` inside your SFDX project. Do not commit and push these backups to source control, they contain sensitive credentials.

**What happens if I run before-refresh twice on the same sandbox?**

The command first detects the existing backup folder and asks whether you want to continue with it or restart from scratch. Restarting requires a second confirmation, then deletes the whole existing backup folder (including saved credentials, so be sure). If you continue, each section detects the previous run and asks whether you want to retrieve again (default: keep the existing backup). If you confirm a new retrieve, certificates and custom settings are cleanly replaced (previous files deleted first). Metadata, Connected Apps and External Client Apps are retrieved on top of the existing files without deleting anything: files of apps already deleted from the org are kept on purpose, they are your backup. The manual actions inventory and reschedule scripts are regenerated, except when the new collection comes back empty, in which case the previous ones are kept.

The actions report is cumulative across runs: it contains everything taken into account by all runs for the sandbox (with a run date on each line). Rows from sections that clean-replace their data (certificates, custom settings) are replaced when the section is re-executed; rows describing backup content still on disk are kept. The history is written to disk after each section, so a run interrupted before the end (killed process, cancelled prompt) still leaves the completed sections in the next report.

**Can I prepare the refresh of several sandboxes at the same time?**

Yes. Each sandbox gets its own backup folder under `scripts/sandbox-refresh/` (named after its instance URL), its own saved selections in `config/.sfdx-hardis.yml` (under `refreshSandboxConfig.sandboxes`), and its own actions report. Running the commands for one sandbox never overwrites the backups or choices of another.

**Does this work for Full sandboxes, Partial Copy, and Developer sandboxes?**

Yes, all sandbox types are supported as long as you can authenticate to them with the Salesforce CLI.

---

## Related commands

- [`sf hardis:org:refresh:before-refresh`](hardis/org/refresh/before-refresh.md): Full command reference
- [`sf hardis:org:refresh:after-refresh`](hardis/org/refresh/after-refresh.md): Full command reference
