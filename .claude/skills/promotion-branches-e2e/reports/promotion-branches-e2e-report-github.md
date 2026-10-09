# Promotion branches, deployment actions and backpromote: end to end test on GitHub

**Date:** 2026-10-09 (supersedes the run of 2026-10-08 on `feat/readable-pr-comments`)
**Why this run:** the four providers in a row on `e2e-updates`, GitHub last, with the visual check
of the Pull Request comments added to the skill during the run (section 5quater).

**Repositories under test** (private, created empty for this run):

- sections 4, 4bis, 4ter, 5bis, 5quater, 6, 6quater, 6sexies and 7bis: `nvuillam/sfdx-hardis-promo-e2e-42`
- backpromote (Beta), section 6bis: `nvuillam/sfdx-hardis-promo-e2e-43`
- real CI with `e2e-updates` linked by `sf plugins link`, section 6quinquies:
  `nvuillam/sfdx-hardis-promo-e2e-ci-1`

**Salesforce org:** the Developer Edition org of `E2E_ORG` (also the Dev Hub). Scratch orgs
`promo-e2e-dev` (also `DEV_ORG` of 6quater and 6sexies) and `promo-e2e-dev2`.
**sfdx-hardis:** `e2e-updates` with the fixes of the run, through `bin/dev.js`. The CI jobs link the
branch as pushed (W0).
**vscode-sfdx-hardis:** `e2e-updates` at `dbc7e197`, compiled with `yarn compile`.

___

## Counts

| Section                                                                             | Checks                            | OK  | FAIL |
|-------------------------------------------------------------------------------------|-----------------------------------|-----|------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                | 42  | 0    |
| 6: edge cases, groups g1 to g6                                                      | 47                                | 47  | 0    |
| 6quater: gate, recovery, set-status ahead, forecast, developer org (replay)         | 21                                | 21  | 0    |
| 6sexies: identical actions, I1 to I10                                               | 24                                | 24  | 0    |
| 6bis: backpromote B0 to B16, C1 to C4 (-43)                                         | 63                                | 63  | 0    |
| 6quinquies: real CI, W0 to W9, X1, X2 (ci-1)                                        | 22                                | 22  | 0    |
| 4ter: single Pull Request window, simulated jobs (-42)                              | 47 Pull Requests                  | 47  | 0    |
| 4ter: single Pull Request window, real CI jobs (ci-1, X1)                           | 1                                 | 1   | 0    |
| 5bis: comment audit (-42)                                                           | 1084 checks over 53 Pull Requests | all | 0    |
| 5bis: comment audit of the real CI comments (ci-1)                                  | 265 checks over 9 Pull Requests   | all | 0    |
| 5quater: visual check of the comments (-42, fixtures included)                      | 12 types, 1 warning               | 12  | 0    |
| 5quater: visual check (-43, backpromote)                                            | 1 type                            | 1   | 0    |
| 5quater: visual check (ci-1, comments of real jobs)                                 | 8 types                           | 8   | 0    |
| 7bis: single place in the diagram (-42)                                             | 1                                 | 1   | 0    |
| 7ter: flag-off A/B against `origin/main` (`0424af86d`), second pair                 | 0 differing lines                 | 1   | 0    |

Section 6quater first ended with 20 OK and 1 FAIL: check A5 (a draft is only warned) got exit code 2
and "command hardis:project:deploy:smart not found". The cause was this run, not the product: the
jobs execute the TypeScript sources as they are on disk, and a source file was being edited for
the Azure DevOps fix at that second. Replayed on the same repository with `DA_RUN=2`: 21 OK. The
runbook now says so under its traps.

___

## Results by group

### Sections 3, 4 and 4bis (-42): 42 OK

Stories S1 to S7 (#1 to #7), promotions P1 to P5, release notes, second go-live, retrofit, and the
six DevOps Pipeline checkpoints.

### Section 6, edge cases (-42): 47 OK

Groups g1 to g6.

### Section 6quater, deployment actions (-42): 21 OK on the replay

Groups A, B, C and D (developer org `promo-e2e-dev`).

### Section 6sexies, identical actions (-42): 24 OK

I1 to I10, with the backpromote plan and run of the window (I7, I8).

### Section 6bis, backpromote (-43): 63 OK

B0 to B16 and C1 to C4.

### Section 6quinquies, real CI on GitHub Actions (ci-1): 22 OK

| Job                          | Mode    | Result                 | Queued | Ran   |
|------------------------------|---------|------------------------|--------|-------|
| ci-check-c1                  | real CI | failure (expected, W1) | 0 s    | 317 s |
| ci-check-c1-rerun            | real CI | success                | 331 s  | 248 s |
| ci-check-c2-draft            | real CI | success                | 0 s    | 331 s |
| ci-deploy-integration-c1     | real CI | failure (expected, W4) | 0 s    | 274 s |
| ci-check-c3                  | real CI | success                | 0 s    | 273 s |
| ci-deploy-integration-c3     | real CI | success                | 0 s    | 279 s |
| ci-check-promotion-uat       | real CI | failure (expected, W5) | 0 s    | 245 s |
| ci-check-promotion-uat-rerun | real CI | success                | 295 s  | 267 s |
| ci-deploy-uat-promotion      | real CI | success                | 0 s    | 253 s |
| ci-check-no-safe-dir         | real CI | failure (expected, W8) | 0 s    | 227 s |
| ci-check-c5                  | real CI | success                | 0 s    | 341 s |
| ci-check-c6                  | real CI | success                | 0 s    | 335 s |
| ci-deploy-integration-c5     | real CI | success                | 0 s    | 283 s |
| ci-deploy-integration-c6     | real CI | success                | 0 s    | 277 s |
| ci-check-promotion-identical | real CI | success                | 0 s    | 274 s |
| ci-deploy-uat-identical      | real CI | success                | 0 s    | 293 s |

16 jobs, all real CI, none simulated. The "queued" seconds of the two re-runs are the time of the
first attempt, which a re-run of the same run id carries. The jobs ran the branch with the fixes of
the night (Azure DevOps and Bitbucket providers, `set-status`): nothing changed for GitHub.

### Section 7ter, flag-off regression against main (-42)

Run last, alone, since it switches the sfdx-hardis checkout: a feature Pull Request into uat (#59)
and a uat to preprod Pull Request (#60), left open, validated, then uat deployed and the release
notes built, with `enablePromotionBranches: false`, by the branch and by `origin/main`, twice. The
second pair is compared: `TOTAL DIFFERING LINES: 0`. A project that does not use the feature gets
the same jobs from the branch, with the fixes of the night, as from main.

### Section 5quater, visual check (new in this run)

GitHub comments are drawn through `POST /markdown` (the renderer of the comments), headless.

| Repository | Types checked                                                                                                                                                                                                            | Result           |
|------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------|
| -42        | backpromotes, deployment-actions, +manual, deployment-failed, deployment-success, +manual, promotion-description, +conflicts, validation-failed, validation-failed+manual, validation-success, validation-success+manual | 11 OK, 1 warning |
| -43        | backpromotes                                                                                                                                                                                                             | OK               |
| ci-1       | the eight types the real jobs left                                                                                                                                                                                       | 8 OK             |

The warning is the conflict prompt of a promotion description, a code block that scrolls.
`validation-failed` and `validation-failed+manual` come from `visual-fixtures.sh`, which leaves a
story with a class that does not compile and a story stopped at the manual action gate, both open.

Every picture was then read against the checklist of the runbook (25 for -42 and -43). No markup
is broken: banners, tables, emoji, checkboxes, folds and code blocks are drawn, nothing is left as
text. What the reading found is about content, below.

___

## What the run found

Nothing that breaks on GitHub. The reading of the pictures found things the checks cannot see:

| Finding                                                                                                                                                                                                      | Status                                                                                                                                                                                                                                          |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| The Backpromotes comment of a story whose actions were run in a developer org with `action:run --dev-org` said "No sandbox received this Pull Request yet · 2 to do by hand" above the list of those actions | fixed: "Deployment actions tried in 1 developer org, not backpromoted there yet"                                                                                                                                                                |
| The Tickets fold of the validation comments lists words that are not tickets: `prmerge-57` and `recovery-2`                                                                                                  | harness for the first (the simulator checks the merge ref out as a branch named `prmerge-<n>`, a real job has no such branch), open for the second: the generic ticket pattern takes any `word-number` of a title, here "E2E-401 S8 recovery-2" |
| "To do by hand in `uat` before the deployment" heads a box that is already ticked, when the action was marked as done ahead                                                                                  | open, wording                                                                                                                                                                                                                                   |
| The fold says "24 Pull Requests" and the line under it "(25 Pull Requests)" on a major-to-major Pull Request: one of the two counts the Pull Request itself                                                  | open, minor                                                                                                                                                                                                                                     |
| "Results by org" tables with a Note column wrap the date as "2026-10-" / "08"                                                                                                                                | open, cosmetic                                                                                                                                                                                                                                  |
| The summary row shows a clock for "3 after the merge" while the table under it shows the same actions with the skipped dot                                                                                   | open, cosmetic                                                                                                                                                                                                                                  |
| `validation-failed` comments have no navigation line                                                                                                                                                         | to confirm: a failed validation is the only comment of its Pull Request                                                                                                                                                                         |

___

## What this run did not cover

- **The real comment column of GitHub**: the visual check draws GitHub's own HTML in a plain
  frame. `--render page` with a logged-in Chrome would show the page.
- **Flow diff and MegaLinter comments**: no story holds a Flow and no job posts a MegaLinter
  comment. The Code Quality tab of the Pull Request window is not exercised.
- **Step B17** (terminal prompts of backpromote) and a real production org.
- The window of a promotion or major-to-major Pull Request is not compared, and nothing of the
  extension is rendered or clicked.
- The four pipeline levels share one Salesforce org.

___

## Left behind

`nvuillam/sfdx-hardis-promo-e2e-42` (with #57 and #58 left failed on purpose, #59 and #60 open for
the A/B), `-43` and `-ci-1`. The `gh` token has no `delete_repo` scope
(`gh auth refresh -h github.com -s delete_repo` before `gh repo delete`).
