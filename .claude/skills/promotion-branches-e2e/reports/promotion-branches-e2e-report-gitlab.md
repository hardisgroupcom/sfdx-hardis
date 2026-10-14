# Promotion branches, deployment actions and backpromote: end to end test on GitLab

**Date:** 2026-10-10 (supersedes the run of 2026-10-09 on `e2e-updates`)
**Why this run:** regression check of the four providers on `feat/pr-modal-job-artifacts`
(hardisgroupcom/sfdx-hardis#2327, the download of job artifacts), GitLab third.

**Repositories under test** (private, created empty for this run, on the self-hosted GitLab):

- sections 3, 4, 4bis, 4ter, 5bis, 5quater, 6, 6quater, 6sexies and 7bis:
  `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-18`
- backpromote (Beta), section 6bis: `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-19`
- real CI with the branch linked by `sf plugins link`, section 6quinquies:
  `busalesforce/playground/sfdx-hardis-promo-e2e-ci-gl-2` (runner tag `ubuntu`)

**Salesforce org:** the Developer Edition org of `E2E_ORG` (also the Dev Hub). Scratch orgs
`promo-e2e-dev` (also `DEV_ORG` of 6quater and 6sexies) and `promo-e2e-dev2`.
**sfdx-hardis:** `feat/pr-modal-job-artifacts` at `a09413f6c`, through `bin/dev.js`.
**vscode-sfdx-hardis:** `feat/pr-modal-job-artifacts` at `df3691c0`, compiled with `yarn compile`.

___

## Counts

| Section                                                                             | Checks                            | OK                | FAIL      |
|-------------------------------------------------------------------------------------|-----------------------------------|-------------------|-----------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                | 41                | 1         |
| 6: edge cases, groups g1 to g6                                                      | 47                                | 46                | 1         |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                  | 21                                | 21                | 0         |
| 6sexies: identical actions, I1 to I10                                               | 24                                | 24                | 0         |
| Visual fixtures (VE, VG)                                                            | 2                                 | 1                 | 1         |
| 6bis: backpromote B0 to B16, C1 to C4 (`gl-19`)                                     | 63                                | 63                | 0         |
| 6quinquies: real CI, W0 to W9, X2 (`ci-gl-2`), W8 skipped                           | 20                                | 20                | 0         |
| 6quinquies: X1, single Pull Request window on real CI comments                      | 1                                 | 0, then 1 by hand | 1         |
| 4ter: single Pull Request window, simulated jobs (`gl-18`)                          | 49 Pull Requests                  | 49                | 0         |
| 5bis: comment audit (`gl-18`)                                                       | 1094 checks over 55 Pull Requests |                   | 1 finding |
| 5quater: visual check of the comments (`gl-18`)                                     | 11 types, 1 warning               | 11                | 0         |
| 5quater: visual check (`gl-19`, backpromote)                                        | 1 type                            | 1                 | 0         |
| 7bis: single place in the diagram (`gl-18`)                                         | 1                                 | 1                 | 0         |

No SKIP line in sections 6quater and 6sexies: the developer org groups ran.

___

## Results by group

Four of the five failures below have one cause: the workstation was short on memory (about 2 GB
free), and `git` and `curl` failed with `getaddrinfo() thread failed to start`. The skill lists
this message as a trap of the computer, to replay before calling it a finding.

### Sections 3, 4 and 4bis (`gl-18`): 41 OK, 1 FAIL

`check-pr2`: the `curl` that reads the merge commit of the story failed to start, so the
validation of story 2 never ran on the right commit.

### Section 6, edge cases: 46 OK, 1 FAIL

`52b`, `deploy-preprod-full-merge`: the `git fetch` before the deployment job failed to start.
The job ran on a stale checkout: its scope is 1 Pull Request (#31), where the same job on Bitbucket
has 27. So the deployment of the full merge of `uat` into `preprod` was not exercised on GitLab.

### Section 6quater, deployment actions: 21 OK

### Section 6sexies, identical actions: 24 OK

### Visual fixtures: 1 OK, 1 FAIL

`VG`: the validation of the manual action fixture passed where it must stop. The log says "No
Pre-deployment actions defined": the job ran on a merge ref built before the push of the action
file. Replayed by hand a few minutes later on the same merge request, the validation stops on
`1 pre-deployment manual action(s) not marked as performed in integration`, as expected.

This one is a defect of the test, and it came back on a second repository: `gl_fetch_merge_ref`
waits for the head that the merge request API reports, and that API can still answer the previous
head right after a push. The fixture already passes the pushed commit to `p_wait_merge_ref`; the
GitLab implementation ignored it. Fixed in the skill scripts at the end of this run (see below).

### Section 6bis, backpromote (`gl-19`): 63 OK

### Section 6quinquies, real CI on GitLab CI (`ci-gl-2`): 20 OK, X1 passed on a second run

15 jobs, all recorded "real CI" in `ci-jobs.tsv`, none simulated. 16 seconds queued and 3534
seconds run in total, 1 hour 2 minutes of wall clock. W8 is skipped by design (GitHub only).

X1 failed in the script: `check-pr-modal.cjs` stopped on the same `curl` thread error while reading
the notes of merge request 5. Run again by hand on the same repository: 6 OK, 0 FAIL over 6 merge
requests. X2 passes.

### Section 5bis, comment audit: 1 finding

`#1: manual action e2e-manual-1 is marked skipped in preprod: it left the pending list and can no
longer be ticked`. The audits of Azure DevOps, Bitbucket and GitHub have no finding on the same
story. The likely cause is the stale deployment of the full merge above (52b), which is the job
that deploys `preprod` at that point. **Not confirmed**: the section was not replayed.

### Section 5quater, visual check

11 comment types on `gl-18`. The type `validation-failed+manual` is missing, because VG did not
produce the comment at the time. One warning: the `pre` block of the conflicts prompt is 3112px
wide in a 952px description; GitLab scrolls it sideways.

The pictures of `gl-18` were **not** read by a reviewer. The 2 of `gl-19` were: no raw markdown or
HTML, table complete, folds unfolded in the `-open` picture.

___

## What the run found

| Finding                                                                                                                                     | Status                                   |
|---------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------|
| `gl_fetch_merge_ref` trusts the head reported by the merge request API, which lags after a push: a validation can run on stale content (VG) | fixed in the skill scripts               |
| `check-pr-modal.cjs` and the section scripts stop or go on silently when `curl` or `git` cannot start                                       | open: no retry added                     |
| Audit finding on story 1, manual action skipped in `preprod`                                                                                | open, cause not confirmed                |
| A fold says "N Pull Requests" where the line under it says N+1                                                                              | open, wording, same on every provider    |
| The Backpromotes comment has no banner and no navigation line                                                                               | by design (`backpromoteCommentUtils.ts`) |

No product defect was found on GitLab.

___

## What this run did not cover

- **The three failed checks of the sections and the audit finding were not replayed with
  success.** A replay on `gl-20` was started while the workstation was still short on memory: the
  creation of the seventh merge request failed on the same thread error, and every later section
  had nothing to run on. The user then chose to stop the replays on 2026-10-10. So on GitLab this
  run does not prove: the validation of story 2 (`check-pr2`), the deployment of a full merge
  after partial promotions (`52b`), and that the audit finding is a consequence of 52b.
- **The pictures of `gl-18` were not reviewed**, and the `validation-failed+manual` type was not
  pictured.
- **Section 7ter, the flag-off A/B**, runs on GitHub only, and was not run at all in this run.
- **The visual check and the comment audit of the real CI comments** (`ci-gl-2`) were not run.
- The known gaps of the skill stay: no Jenkins, no Gitea, no Bitbucket Server, no production org,
  no real sandbox (scratch orgs stand in for developer sandboxes), VS Code panels are checked
  through the extension's compiled code and not by clicks.

___

## What was restarted, and why

- X1 of the real CI, by hand, after the `curl` thread error: passes.
- VG, by hand, on the same merge request: passes.
- The sections, on `gl-20`: failed at the seventh story on the thread error, abandoned.
- The background waiters of the session were stopped several times by the low memory of the
  workstation. The test chains themselves kept running.

___

## Left behind

Projects `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-18`, `gl-19`, `gl-20` (spoiled: six merge
requests and two fixtures) and `busalesforce/playground/sfdx-hardis-promo-e2e-ci-gl-2`, with its
project access token and CI/CD variables. Next free numbers: `gl-21`, `ci-gl-3`. Work folders:
`%TEMP%/e2e-1010/promo-e2e-gitlab-first*` and `promo-e2e-gitlab-logs-first` (`gl-18`),
`promo-e2e-gitlab*` (`gl-20`), `promo-e2e-bp-gitlab*`, `promo-e2e-ci-gitlab*`.
