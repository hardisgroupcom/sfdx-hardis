---
title: Backpromote to your dev sandbox (Beta)
description: Bring what your teammates merged in a parent branch into your developer sandbox, with the deployment actions of their Pull Requests
---
<!-- markdownlint-disable MD013 -->

# Backpromote to your dev sandbox (Beta)

> This feature is in Beta. Please report any issue or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

While you work on a User Story, your teammates merge theirs in the parent branch (`integration`, `uat`...). A **backpromote** brings into your own developer sandbox (or scratch org) what they merged since the last backpromote of that sandbox: the metadata, and the deployment actions their Pull Requests declared.

- **Simple:** one panel in VS Code, one command in a terminal, a handful of decisions.
- **Shared:** several people backpromote to the same sandbox over time, from different computers. The history of a sandbox lives in a **"Backpromotes" comment** on every Pull Request it received, and nowhere else.
- **Safe:** a deployment action runs at most once per sandbox, a conflict marker never reaches an org, a major org (production, or the org of a major branch) is never a target.

## Vocabulary

| Term | Meaning |
|------|---------|
| Parent branch | The major branch you backpromote from: `developmentBranch`, or one of `availableTargetBranches` of `config/.sfdx-hardis.yml`. Nothing else. |
| Target sandbox | Your developer sandbox or scratch org. A production org, or an org declared for a major branch in `config/branches`, is refused. |
| Sandbox name | Read from the instance URL (`mycompany--dev1.sandbox.my.salesforce.com` gives `dev1`), else from the username, else the org id. `--sandbox-name` overrides it. |
| Backpromote branch | `backpromote/<parent branch>/<sandbox name>`: a child of the parent branch that only holds the merges you made by hand. The deployment runs from it. |
| Start Pull Request | The first merged Pull Request included in the backpromote: it and everything merged after it, up to the head of the parent branch, form the **window**. |
| "Backpromotes" comment | The comment sfdx-hardis writes on every Pull Request of a window: one row per sandbox (date, user, complete or partial with the items left out), and one row per deployment action run by a backpromote. |

## From VS Code

Open the **Backpromote (Beta)** panel from the card below the DevOps Pipeline diagram, or from the commands panel. One page, read from top to bottom:

1. **Where:** the target sandbox (major orgs are greyed with the reason), the parent branch (hidden when only `developmentBranch` is allowed), and the merged Pull Requests, newest first. The ones your sandbox already received are greyed with their date; the first one not backpromoted yet is the default start.
2. **What:** the metadata of the window grouped by type, the deletions and the deployment actions, all ticked. Untick what must not go now. An item whose sandbox version differs from the parent branch version carries, on its own line, a select button **Overwrite / Keep org version / Merge** and a **Compare** button that opens the VS Code diff editor. **Merge** writes the file with conflict markers in the backpromote branch and opens the VS Code merge editor: solve it there, or copy the coding agent prompt (one prompt for every merge of the run) and let your agent solve it.
3. **Go:** the **Backpromote** button, enabled once no marker remains, runs the pre-deployment actions, the deployment, the deletions, the post-deployment actions, writes the "Backpromotes" comments and pushes the backpromote branch when it holds merges. The panel shows each step, then the result. A manual action is confirmed with its **Done in the sandbox** checkbox.

Your checkout stays on the backpromote branch after the run. **Back to my branch** checks your branch out again, restores the changes it had stashed, and proposes to merge the parent branch into it, so that your next `hardis:work:save` does not commit the backpromoted metadata as your own work.

A git provider token is required on your computer (`GITHUB_TOKEN`, `CI_SFDX_HARDIS_GITLAB_TOKEN`, `SYSTEM_ACCESSTOKEN` or `CI_SFDX_HARDIS_BITBUCKET_TOKEN`, for example in a `.env` file at the root of the repository): without it the history cannot be read and nothing can be recorded. The panel says so before anything else.

## From a terminal

```bash
sf hardis:work:backpromote --target-org dev1
```

The command asks the same questions as the panel: the parent branch, the start Pull Request, the items and deletions, one decision per file that differs (or one for all the remaining files), the deployment actions, and after the run the manual actions done by hand. With `--auto` every decision comes from the flags and nothing is asked; with `--plan --json` nothing is done and the plan is returned. See the [command page](hardis/work/backpromote.md) for the flags, the JSON and the agent mode.

## What a backpromote never does

- It never deploys to a production org or to the org of a major branch.
- It never commits on a major branch or on a promotion branch, and on your User Story branch it only commits your own uncommitted changes when you ask it to (the alternative is a stash): the backpromote itself only commits on `backpromote/<parent branch>/<sandbox name>`. `hardis:work:save` refuses to run from that branch.
- It never runs a deployment action twice in the same sandbox (`runOnlyOnceByOrg`), and it never touches the CI/CD "Deployment Actions" comment.
- It never deploys a file that still holds conflict markers.
- It never deploys the items of `package-no-overwrite.xml`: a dev sandbox is an org like the others for that rule.

## Configuration

| Key | Where | Meaning |
|-----|-------|---------|
| `developmentBranch`, `availableTargetBranches` | `config/.sfdx-hardis.yml` | The parent branches a backpromote may come from. |
| `backpromoteScanLimit` | `config/.sfdx-hardis.yml` | Number of merged Pull Requests read to find the last backpromote of a sandbox (default 100). Beyond it, the user picks the start. |
| Branch protection | Git provider | Pushes to `backpromote/*` must be allowed, and no CI job should run on those branches. |

## Sandbox refresh

A refreshed sandbox keeps its name but gets a new org id. Its old rows are history, not state: the Pull Requests show "before refresh", nothing is pre-selected, and the deployment actions count as not run yet.
