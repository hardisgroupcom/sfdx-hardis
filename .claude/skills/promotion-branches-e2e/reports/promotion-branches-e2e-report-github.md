# Promotion branches, deployment actions and backpromote: end to end test on GitHub

**Date:** 2026-10-08 (supersedes the run of 2026-10-07)
**Why this run:** sfdx-hardis #2316 rewrites every Pull Request comment the CLI writes (validation,
deployment, Deployment Actions, Flow diff, Backpromotes) in a new layout: verdict, table of checks,
"needs you" blocks, folded details. Several commands read those comments back (the checkbox of a
manual action, `action:list --with-status`, `set-status`, the forecast, the Backpromotes history),
and the extension reads them for the tabs of its single Pull Request window. This run proves that
none of them lost anything with the new layout.

**Repositories under test (private, created empty for this run):**

- sections 4, 4ter, 5bis, 6, 6quater, 6sexies and 7bis: `nvuillam/sfdx-hardis-promo-e2e-38`
- backpromote (Beta), section 6bis: `nvuillam/sfdx-hardis-promo-e2e-40`
- real CI workflows with `feat/readable-pr-comments` linked by `sf plugins link`, section 6quinquies:
  `nvuillam/sfdx-hardis-promo-e2e-41`

Two runs were stopped and started again on a fresh repository, both for the network, not the
product: `-37` (section 4 step 12, `git fetch` answered "Connection was reset", every later step of
the section failed after it) and `-39` (step B9, a Salesforce call answered `ConnectTimeoutError`
after 10 seconds; the steps after it build on its state).

**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (orgfarm Developer Edition, Dev Hub).
Scratch orgs `promo-e2e-dev` (also `DEV_ORG` of 6quater) and `promo-e2e-dev2`, reset to the base
project by the backpromote setup. No other org was touched.
**sfdx-hardis:** `feat/readable-pr-comments` at `bab772965`, compiled, through `bin/run.js`. CI jobs of
-41 link the same branch (W0 asserts it).
**vscode-sfdx-hardis:** `feat/readable-pr-comments` at `f91668cc`, compiled with `yarn compile`.

___

## Counts

| Section                                                                             | Checks                            | OK  | FAIL |
|-------------------------------------------------------------------------------------|-----------------------------------|-----|------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                | 42  | 0    |
| 6: edge cases, groups g1 to g5                                                      | 44                                | 44  | 0    |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                  | 21                                | 21  | 0    |
| 6sexies: identical actions, I1 to I10                                               | 24                                | 24  | 0    |
| 6bis: backpromote B0 to B16, C1 to C4 (-40)                                         | 63                                | 63  | 0    |
| 6quinquies: real CI, W0 to W9 (-41)                                                 | 19                                | 19  | 0    |
| 4ter: single Pull Request window, simulated jobs (-38)                              | 46 Pull Requests                  | 46  | 0    |
| 4ter: single Pull Request window, real CI jobs (-41)                                | 7 Pull Requests                   | 7   | 0    |
| 5bis: Pull Request comment audit (-38)                                              | 1076 checks over 52 Pull Requests | all | 0    |
| 5bis: comment audit of the real CI comments (-41)                                   | 265 checks over 9 Pull Requests   | all | 0    |
| 7bis: single place in the diagram (-38)                                             | 1                                 | 1   | 0    |
| 7ter: flag-off A/B                                                                  | not run                           |     |      |

___

## What the new layout had to keep

| Reader                                                                            | Proven by                                          | Result |
|-----------------------------------------------------------------------------------|----------------------------------------------------|--------|
| The checkbox of a manual action, ticked in the comment, read by the re-run        | W2 (real CI), 6quater gate                         | OK     |
| `action:list --with-status` and the forecast, from the Deployment Actions comment | 6quater, 6sexies, W5b, W6c                         | OK     |
| `set-status` (the Mark as done button), here and ahead in the next branch         | 6quater, W6                                        | OK     |
| An action shared by two stories run once, the copy recorded as done               | 6sexies, W9, W9b                                   | OK     |
| The Validation, Deployment and Deployment Actions tabs of the extension           | 4ter on -38 and -41, merged Pull Requests included | OK     |
| The Backpromotes history (rows per sandbox and per action, a refreshed sandbox)   | C1 to C4                                           | OK     |

___

## What this run changed in the harness

- `check-backpromote-comments.cjs` expected the old visible cell `| devorg1 <sub>orgId</sub> |`. The
  new layout keeps the org id in the hidden data only, and shows it in the visible text when a
  refreshed sandbox kept its name (two rows, same name, other org id): `devorg1 (00D...)`. The check
  now follows that rule and also asserts that a single sandbox shows no org id. C1 failed on `-39`
  for that reason alone, then passed on its saved dump with the new check, then on `-40`.

No product defect was found.

___

## What this run did not cover

- GitLab is not in this report: it was run the same day on `gl-15` (131/131, single Pull Request
  window 46/46, audit 1076 checks), see `promotion-branches-e2e-report-gitlab.md`.
- Azure DevOps and Bitbucket: not run (Bitbucket still needs a new token).
- 7ter, the flag-off A/B diff: not run. The change is in the comment layout, which the A/B normalises
  out of the job logs, so it would not have said anything about it.
- The four pipeline levels share one Salesforce org, so deployment action state is keyed by org
  branch, not by distinct orgs.
- The extension webview DOM is not clicked: 4ter calls the same data functions the window calls.
