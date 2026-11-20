# Promotion branches, deployment actions and backpromote: end to end test on GitHub

**Date:** 2026-10-31 (supersedes the run of 2026-10-14)
**Why this run:** regression check of `main` after the release of 8.21.0 (detectManualCherryPicks,
#2417; NO_DELTA keyword matching, #2431). Run with every other e2e scenario the same night.

**Repositories under test** (private, created empty for this run):

- sections 3, 4, 4bis, 4ter, 5bis, 5quater, 6, 6quater, 6sexies and 7bis: `nvuillam/sfdx-hardis-promo-e2e-58`
- backpromote (Beta), section 6bis: `nvuillam/sfdx-hardis-promo-e2e-60` (`-59` stopped at its setup, see "Found")
- real CI, section 6quinquies: `nvuillam/sfdx-hardis-promo-e2e-ci-4`

**Salesforce org:** the Developer Edition org of `E2E_ORG`. Backpromote scratch orgs `promo-e2e-dev`
and `promo-e2e-dev2`, created from `DevHub` by this run (the `E2E_ORG` Dev Hub had no free slot).
**sfdx-hardis:** `main` at `da92636cb` (8.21.0), `bin/dev.js` for the simulators, cloned and linked by
the real CI jobs. **vscode-sfdx-hardis:** `main` at `5ed4c6d4`, compiled with `yarn compile`.

___

## Counts

| Section                                                          | Checks                            | OK  | FAIL | Not covered                                         |
|------------------------------------------------------------------|-----------------------------------|-----|------|-----------------------------------------------------|
| 3, 4 and 4bis: stories, promotions, go-lives, retrofit, pipeline | 42                                | 42  | 0    |                                                     |
| 6: edge cases, groups g1 to g6                                   | 47                                | 47  | 0    |                                                     |
| 6quater: gate, recovery, set-status ahead, forecast, dev org     | 21                                | 21  | 0    |                                                     |
| 6sexies: identical actions, I1 to I10                            | 24                                | 24  | 0    |                                                     |
| Visual fixtures (VE, VG)                                         | 2                                 | 2   | 0    |                                                     |
| 6bis: backpromote B0 to B16, C1 to C4 (`-60`)                    | 63                                | 63  | 0    |                                                     |
| 6quinquies: real CI, W0 to W9, X1, X2 (`ci-4`)                   | 22                                | 11  | 11   | the 11 FAIL are jobs GitHub never started (billing) |
| 4ter: single Pull Request window (`-58`)                         | 49 Pull Requests                  | 49  | 0    |                                                     |
| 5bis: comment audit (`-58`)                                      | 1161 checks over 55 Pull Requests | all | 0    |                                                     |
| 5bis: comment audit (`-60`, backpromote)                         | 88 checks over 11 Pull Requests   | all | 0    |                                                     |
| 5quater: visual check (`-58`)                                    | 11 types, 1 warning               | 11  | 0    |                                                     |
| 5quater: visual check (`-60`, Backpromotes comment)              | 1 type                            | 1   | 0    |                                                     |
| 7bis: single place in the diagram (`-58`)                        | 1                                 | 1   | 0    |                                                     |
| 6septies: org initialization and scratch org pool (`-58`)        | 37                                | 37  | 0    | third run, see below                                |
| 7ter: flag-off A/B against `origin/main`                         | -                                 |     |      | not run, see below                                  |

6quater and 6sexies ran a second time with `DEV_ORG` set to the scratch org `promo-e2e-dev`
(`DA_RUN=2`, `IA_RUN=2`, new stories on the same repository): group D and I7 pass, so do all the
others again.

___

## Real CI (section 6quinquies)

W0 to W3 ran in GitHub Actions and passed (link of `main`, the manual action gate, the tick, the
draft). From W4 on, GitHub refused to start any job of the account: *"The job was not started because
recent account payments have failed or your spending limit needs to be increased"*. Every job failed
in 3 seconds without a step. W4 to W9 are therefore **not covered** on GitHub, not product failures.
The same scenario passed on GitLab CI the same night (21 OK, W8 SKIP by design).

X1 (PR modal of the real jobs) and X2 (pipeline) passed on what existed.

## Found during the run

- **Harness, section 6septies, O11d**: the check of a change made in the org replaced `base` in the
  `PromoE2EShared` label, but the earlier sections had left `two` there, so nothing was deployed
  and the pull preview stayed empty. The script now replaces whatever value the file holds. The
  section ran at 11:00, after `DevHub` got its daily allowance back (the `E2E_ORG` Dev Hub still had
  no free slot), with `DEVHUB=DevHub`. The first two runs also failed O4 and O4k: step 12
  (`fetch failed`) then step 13 (an `sf apex run` that ended in 0 seconds with no message) while
  the workstation had about 1 GB free. The third run, started with 3 GB free, passed all 37.

- **GitHub Actions billing**: the account hit its spending limit (or a failed payment) around 03:50
  UTC. It also cut the GitHub run of the promotion-rules-actions scenario after S1. Private
  repositories only; the public training fork is not concerned.
- **Harness, backpromote setup**: `promo-e2e-dev` / `promo-e2e-dev2` were aliases of scratch orgs
  that expired on 2026-10-15. `sf org display` still answers for them (status `Deleted`), so the
  setup tried to reset a dead org and stopped on HTTP 420. Fixed in `backpromote-setup.sh`: a status
  other than Active or Connected logs the alias out and creates a new org.
- **Picture review** (one reviewer agent): the "Results by org" table of the Deployment Actions
  comment squeezes its Date, Org branch and Status columns when a long Note column is present (dates
  wrap as `2026-10-` / `31`). The conflicts promotion description has no navigation line (that
  promotion is never validated, so there is nothing to link) and its agent prompt block is wider than
  the comment (the known WARN). Nothing else: banners, verdict first, icons, checkboxes, folds.

## What this run did not cover

- **6quinquies W4 to W9 on GitHub**: GitHub Actions refused the jobs (billing).
- **7ter flag-off A/B**: it switches the working copy to `origin/main`, which is the branch under
  test itself here: `main` against `main` proves nothing.
- B17 (terminal prompts of backpromote) and the panels themselves: not clicked, as in every run.
- The other known gaps of the README stand.
