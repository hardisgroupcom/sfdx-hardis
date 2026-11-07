---
title: Development orgs list
description: With sfdx-hardis, know which developer sandboxes and scratch orgs your team works in, the major branch each of them targets, and when each one needs a backpromote
---
<!-- markdownlint-disable MD013 MD033 -->

# Development orgs list

While developers build User Stories in their sandboxes and scratch orgs, the team merges other User Stories in the major branch these orgs target (`integration`, `uat`...). Every merge is something the orgs do not have yet, until their owner runs a [backpromote](salesforce-devops-backpromote.md).

sfdx-hardis keeps the list of these development orgs, with the branch each of them targets, its owner and its users. For each org, it counts the Pull Requests merged into its target branch since its last backpromote, so its owner knows when to run the next one.

## Where you see it

- **In VS Code**, the DevOps Pipeline shows your development orgs under their target branch, with the number of Pull Requests they miss. The toggle at the top shows **your orgs** (the default: you are their owner or one of their users), **all** the orgs, or **none**. Click an org to see what it misses, and to run a backpromote, edit it or remove it.
- **On your git provider**, the list is a "Development Orgs Dashboard": an issue on GitHub and GitLab, a work item on Azure DevOps, a dedicated Pull Request on Bitbucket. sfdx-hardis rewrites its text at every update: never edit it by hand.
- **In a terminal**, [hardis:project:dev-org:list](hardis/project/dev-org/list.md) prints the list (`--mine` for your orgs only).

## How an org gets in the list

You have nothing to do: sfdx-hardis registers the org you work with when you

- start a User Story in it ([New User Story](salesforce-devops-create-new-user-story.md)): you become one of its users, and its owner when it is new;
- save a User Story from it ([Save / Publish](salesforce-devops-publish-user-story.md));
- run a [backpromote](salesforce-devops-backpromote.md) on it: the date of the backpromote is where the count starts again;
- create a sandbox with [hardis:org:create](hardis/org/create.md): you are asked who owns it and which branch it targets.

A **release manager** who creates a sandbox for somebody else registers it, or changes its target branch, owner and users, from the DevOps Pipeline ("Register a dev org" in the settings menu, or Edit in the window of an org), or with [hardis:project:dev-org:register](hardis/project/dev-org/register.md):

```sh
sf hardis:project:dev-org:register --target-org my-dev-sandbox --target-branch integration --owner "Jane Doe <jane.doe@example.com>" --users "john.smith@example.com"
```

Registering needs a git provider token: in VS Code, connect to your git provider from the DevOps Pipeline. Without it, the commands only say they could not register the org.

## Rules

- **One target branch per org.** When you start a User Story in an org with another target branch than the registered one, sfdx-hardis warns you and keeps the registered branch. A release manager changes it with `--target-branch`.
- **What is counted.** Every Pull Request merged into the target branch since the last backpromote from that branch, or since the org was registered when it never received one. A Pull Request that only moves others (a major branch merged into the next one, a promotion) counts as one, and shows the Pull Requests it carries.
- **When it is counted.** The deployment job of a major branch counts again after each merge, for the orgs that target it. In VS Code, the Refresh button of an org counts again on demand. The DevOps Pipeline reads the last count again once an hour, when you click its Refresh button, and when you start, save or backpromote a User Story: its automatic reloads, which follow the jobs, do not.
- **Stale orgs.** An org with no User Story started or saved and no backpromote for 30 days is marked stale. It stays in the list: removing it is a decision of the release manager.
- **Refreshed sandbox.** A refreshed sandbox has a new org id: when it is registered again, it replaces its old entry, as a new sandbox.
- **Expired scratch org.** It leaves the list on its own.
- **Deleted sandbox.** Remove it from the list in VS Code, or with [hardis:project:dev-org:remove](hardis/project/dev-org/remove.md).
- **Who can see it.** Everyone who can read the repository sees the names and emails of the owners and users.

## Configuration

| Key | Default | What it does |
|-----|---------|--------------|
| `enableDevOrgsRegistry` | `true` | Set it to `false` in `config/.sfdx-hardis.yml` to turn the list off. |
| `devOrgsStaleDays` | `30` | Days without activity before an org is marked stale. |

Both can be set from the Pipeline Settings of the VS Code extension.

When no development org was ever registered, the deployment jobs only look for the dashboard (one call to the git provider) and do nothing else.

## How it works

- The dashboard holds one comment per org and one comment per target branch with the Pull Requests merged into it. The text of the dashboard is rebuilt from these comments.
- An update writes the new comment of an org before it deletes the old one. When the old one cannot be deleted (written by another account), the newest one counts, and a deployment job deletes the leftovers later.
- A removal is a comment too: the org stays hidden even when its comments cannot be deleted.
- The merged Pull Requests are read from the git provider, on their merge date, at most 180 days back.
