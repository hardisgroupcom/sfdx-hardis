# Promotion branches, deployment actions and backpromote: end to end test on GitLab

**Date:** 2026-10-31 (supersedes the run of 2026-10-14)
**Why this run:** regression check of `main` after the release of 8.21.0. GitLab after GitHub.

**Repositories under test** (private, created empty for this run, on `gitlab.hardis-group.com`):

- sections 3 to 7bis: `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-25` (project 4598). A first
  attempt on `-gl-23` (4596) was stopped by a memory shortage of the workstation, see below.
- backpromote (Beta), section 6bis: `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-24` (project 4597)
- real CI, section 6quinquies: `busalesforce/playground/sfdx-hardis-promo-e2e-ci-gl-7` (project 4595)

**Salesforce org:** the Developer Edition org of `E2E_ORG`; scratch orgs `promo-e2e-dev` and
`promo-e2e-dev2` from `DevHub`, shared with the GitHub backpromote and reset by the setup.
**sfdx-hardis:** `main` at `da92636cb` (8.21.0). **vscode-sfdx-hardis:** `main` at `5ed4c6d4`.

___

## Counts

| Section                                                    | Checks                            | OK  | FAIL | Not covered                    |
|------------------------------------------------------------|-----------------------------------|-----|------|--------------------------------|
| 3, 4 and 4bis                                              | 42                                | 42  | 0    |                                |
| 6: edge cases, g1 to g6                                    | 47                                | 47  | 0    |                                |
| 6quater, developer org included                            | 21                                | 21  | 0    |                                |
| 6sexies, I1 to I10                                         | 24                                | 24  | 0    |                                |
| Visual fixtures (VE, VG)                                   | 2                                 | 2   | 0    |                                |
| 6bis: backpromote B0 to B16, C1 to C4 (`gl-24`)            | 63                                | 63  | 0    |                                |
| 6quinquies: real CI, W0 to W9, X1, X2 (`ci-gl-7`)          | 22                                | 21  | 0    | W8 SKIP by design (GitHub only) |
| 4ter: single Pull Request window (`gl-25`)                 | 49 Pull Requests                  | 49  | 0    |                                |
| 5bis: comment audit (`gl-25`)                              | 1161 checks over 55 Pull Requests | all | 0    |                                |
| 5bis: comment audit (`gl-24`, backpromote)                 | 88 checks over 11 Pull Requests   | all | 0    |                                |
| 5quater: visual check (`gl-25`)                            | 11 types, 1 warning               | 11  | 0    |                                |
| 5quater: visual check (`gl-24`, Backpromotes comment)      | 1 type                            | 1   | 0    |                                |
| 7bis: single place in the diagram (`gl-25`)                | 1                                 | 1   | 0    |                                |
| 7ter: flag-off A/B                                         | -                                 |     |      | not run (branch under test is `main`) |

Real CI: 15 jobs, all in GitLab CI, none simulated (`ci-jobs.tsv`), queue times of 0 to 3 seconds.

## What was started again, and why

6quater and 6sexies ran a second time on `-gl-25` with `DEV_ORG` set to the scratch org
`promo-e2e-dev` (`DA_RUN=2`, `IA_RUN=2`): group D and I7 pass, so do all the others again.

Around 04:12 four runs went at once (GitHub post checks, GitLab sections, GitLab real CI, the GitLab
run of promotion-rules-actions) while the workstation's VS Code held about 4 GB. Claude Code stopped
the background shells for low memory; the scripts kept running, but `git` and `echo` children started
failing with exit `3221225794` (the memory starvation signature). The sections run on `-gl-23` was
already wrong at S2 (`echo` of a deployment action failed), so it was killed and started again from
nothing on `-gl-25`, alone. The real CI run was not touched by it and went on to the end.

## Found during the run

- Nothing in the product. The picture review found the same points as on GitHub (the "Results by
  org" table squeezed by a long Note column, no navigation line on the conflicts promotion description),
  and no GitLab specific defect.

## What this run did not cover

- 6septies (not available on GitLab yet), 7ter.
- B17 and the panels themselves, as in every run; the other known gaps of the README stand.
