# Promotion branches, deployment actions and backpromote: end to end test on Azure DevOps

**Date:** 2026-10-10 (supersedes the run of 2026-10-09 on `e2e-updates`)
**Why this run:** regression check of the four providers on `feat/pr-modal-job-artifacts`
(hardisgroupcom/sfdx-hardis#2327, the download of job artifacts), Azure DevOps first.

**Repositories under test** (private, created empty for this run, project `tests-sfdx-hardis`):

- sections 3, 4, 4bis, 4ter, 5bis, 5quater, 6, 6quater, 6sexies and 7bis: `sfdx-hardis-promo-e2e-az-9`
- backpromote (Beta), section 6bis: `sfdx-hardis-promo-e2e-az-10`
- real CI with the branch linked by `sf plugins link`, section 6quinquies: `sfdx-hardis-promo-e2e-ci-az-6`

**Salesforce org:** the Developer Edition org of `E2E_ORG` (also the Dev Hub) for the four branch
levels. Scratch orgs `promo-e2e-dev` (also `DEV_ORG` of 6quater and 6sexies) and `promo-e2e-dev2`,
created again for this run because the previous ones had expired.
**sfdx-hardis:** `feat/pr-modal-job-artifacts` at `a09413f6c`, through `bin/dev.js`. The CI jobs link
the branch as pushed (W0).
**vscode-sfdx-hardis:** `feat/pr-modal-job-artifacts` at `df3691c0`, compiled with `yarn compile`.

___

## Counts

| Section                                                                             | Checks                            | OK  | FAIL |
|-------------------------------------------------------------------------------------|-----------------------------------|-----|------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                | 41  | 1    |
| 6: edge cases, groups g1 to g6                                                      | 47                                | 47  | 0    |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                  | 21                                | 21  | 0    |
| 6sexies: identical actions, I1 to I10                                               | 24                                | 24  | 0    |
| Visual fixtures (VE, VG)                                                            | 2                                 | 2   | 0    |
| 6bis: backpromote B0 to B16, C1 to C4 (`-az-10`)                                    | 63                                | 63  | 0    |
| 6quinquies: real CI, W0 to W9, X1, X2 (`-ci-az-6`), W8 skipped                      | 21                                | 21  | 0    |
| 4ter: single Pull Request window, simulated jobs (`-az-9`)                          | 48 Pull Requests                  | 48  | 0    |
| 4ter: single Pull Request window, real CI jobs (`-ci-az-6`, X1)                     | 1                                 | 1   | 0    |
| 5bis: comment audit (`-az-9`)                                                       | 1238 checks over 55 Pull Requests | all | 0    |
| 5quater: visual check of the comments (`-az-9`, fixtures included)                  | 12 types                          | 12  | 0    |
| 5quater: visual check (`-az-10`, backpromote)                                       | 1 type, 1 warning                 | 1   | 0    |
| 7bis: single place in the diagram (`-az-9`)                                         | 1                                 | 1   | 0    |

No SKIP line in sections 6quater and 6sexies: the developer org groups ran.

___

## Results by group

### Sections 3, 4 and 4bis (`-az-9`): 41 OK, 1 FAIL

Stories #174 to #180. The one failure is `pipeline-before-p2`: the pipeline check listed nothing in
`uat` where it expected four Pull Requests. The log of the extension's provider says
`Error in listPullRequestsInBranchSinceLastMerge: Error: <!DOCTYPE html>`: Azure DevOps answered
one API call with an HTML page. The state of the repository moved on with the next promotion, so
the check cannot be replayed on this repository. Every later pipeline check of the run passes.
Not replayed on a new repository: see "What this run did not cover".

### Section 6, edge cases: 47 OK

### Section 6quater, deployment actions: 21 OK

### Section 6sexies, identical actions: 24 OK

### Section 6bis, backpromote (`-az-10`): 63 OK

### Section 6quinquies, real CI on Azure Pipelines (`-ci-az-6`): 21 OK

`AZURE_E2E_CI_TOKEN=pat`. 15 jobs, all recorded "real CI" in `ci-jobs.tsv`, none simulated.
476 seconds queued and 5726 seconds run in total, 1 hour 51 minutes of wall clock with the single
free parallel job. W8 is skipped by design (GitHub only). X1 (single Pull Request window on the
comments of real jobs) and X2 (DevOps Pipeline) pass.

### Section 5quater, visual check

`-az-9`: 12 comment types pictured, folded and unfolded. The first pass lost the Backpromotes
picture to "Execution context was destroyed, most likely because of a navigation"; taken again
with `--only backpromotes`, it passes. The first `dump_pr_comments` of the post checks also wrote
no file; run again by hand, it listed the 55 Pull Requests.

Pictures read one by one by a reviewer (22 on `-az-9`, 2 on `-az-10`): no raw markdown or HTML,
boxes and icons drawn, verdict first.

___

## What the run found

| Finding                                                                                                                                                            | Status                                                   |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------|
| `(#189)` at the end of a line of the conflicts description is drawn as `#189 )`: the Azure link rendering takes the closing parenthesis                            | open, cosmetic, Azure only                               |
| The sandbox table of the Backpromotes comment has six columns: in a 554px wide comment the last one ("Left out") is past the right edge, Azure scrolls it sideways | open, cosmetic                                           |
| Dates wrap in the org columns of "Status by org" when there are three org columns                                                                                  | open, cosmetic                                           |
| A fold says "N Pull Requests" where the line under it says N+1: the list leaves out the Pull Request being read, the sentence counts it                            | open, wording, same as 10-09                             |
| The extension's Azure provider reads an HTML answer as an error and returns an empty list for the branch (`pipeline-before-p2`)                                    | open: a retry would hide a transient answer, not decided |
| `validation-failed+manual-pr231-open.png` was not unfolded by the capture, so the content of its three sections was not verified by picture                        | capture miss                                             |
| The Backpromotes comment has no banner and no navigation line                                                                                                      | by design (`backpromoteCommentUtils.ts`)                 |

No product defect was fixed from the Azure part of the run.

___

## What this run did not cover

- **`pipeline-before-p2` was not replayed.** It needs a new repository and the whole of sections 3
  and 4. The user chose to stop the replays on 2026-10-10: the same check passes on Bitbucket and
  GitHub in this run, and passed on Azure on 2026-10-09.
- **Section 7ter, the flag-off A/B**, runs on GitHub only, and was not run at all in this run.
- **The visual check of the real CI comments** (`-ci-az-6`) was not run.
- **The build service as comment author** (`AZURE_E2E_CI_TOKEN=system`) was not run: this run used
  the PAT, as the skill asks to go past W2.
- The known gaps of the skill stay: no Jenkins, no Gitea, no Bitbucket Server, no production org,
  no real sandbox (scratch orgs stand in for developer sandboxes), VS Code panels are checked
  through the extension's compiled code and not by clicks.

___

## What was restarted, and why

- The scratch orgs had expired: deleted and created again before the first section.
- The post checks (`dump_pr_comments`, audit, visual check) were run a second time by hand after
  the first dump wrote no file.
- The Backpromotes picture was taken a second time.
- The background waiters of the session were stopped several times by the low memory of the
  workstation. The test chains themselves kept running.

___

## Left behind

Repositories `sfdx-hardis-promo-e2e-az-9`, `-az-10` and `-ci-az-6`, their two pipeline definitions
and build policies, and the two scratch orgs (they expire on 2026-10-12). Next free numbers:
`-az-11`, `-ci-az-7`. Work folders: `%TEMP%/e2e-1010/promo-e2e-azure*`, `promo-e2e-bp-azure*`,
`promo-e2e-ci-azure*`.
