# Promotion branches, deployment actions and backpromote: end to end test on GitHub

**Date:** 2026-10-10 (supersedes the run of 2026-10-09 on `e2e-updates`)
**Why this run:** regression check of the four providers on `feat/pr-modal-job-artifacts`
(hardisgroupcom/sfdx-hardis#2327, the download of job artifacts), GitHub last.

**Repositories under test** (private, created empty for this run):

- sections 3, 4, 4bis, 4ter, 5bis, 5quater, 6, 6quater, 6sexies and 7bis: `nvuillam/sfdx-hardis-promo-e2e-46`
- backpromote (Beta), section 6bis: `nvuillam/sfdx-hardis-promo-e2e-47`
- real CI with the branch linked by `sf plugins link`, section 6quinquies: `nvuillam/sfdx-hardis-promo-e2e-ci-2`

**Salesforce org:** the Developer Edition org of `E2E_ORG` (also the Dev Hub). Scratch orgs
`promo-e2e-dev` (also `DEV_ORG` of 6quater and 6sexies) and `promo-e2e-dev2`.
**sfdx-hardis:** `feat/pr-modal-job-artifacts`, through `bin/dev.js`: `a09413f6c` for the real CI,
`c6ed121b6` (the Bitbucket list fix of this run) for the sections and the backpromote.
**vscode-sfdx-hardis:** `feat/pr-modal-job-artifacts` at `df3691c0`, compiled with `yarn compile`.

___

## Counts

| Section                                                                             | Checks                            | OK  | FAIL |
|-------------------------------------------------------------------------------------|-----------------------------------|-----|------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                | 42  | 0    |
| 6: edge cases, groups g1 to g6                                                      | 47                                | 45  | 2    |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                  | 21                                | 21  | 0    |
| 6sexies: identical actions, I1 to I10                                               | 24                                | 24  | 0    |
| Visual fixtures (VE, VG)                                                            | 2                                 | 2   | 0    |
| 6bis: backpromote B0 to B16, C1 to C4 (`-47`)                                       | 63                                | 63  | 0    |
| 6quinquies: real CI, W0 to W9, X1, X2 (`-ci-2`)                                     | 22                                | 22  | 0    |
| 4ter: single Pull Request window, simulated jobs (`-46`)                            | 49 Pull Requests                  | 49  | 0    |
| 4ter: single Pull Request window, real CI jobs (`-ci-2`, X1)                        | 1                                 | 1   | 0    |
| 5bis: comment audit (`-46`)                                                         | 1142 checks over 55 Pull Requests | all | 0    |
| 5quater: visual check of the comments (`-46`, fixtures included)                    | 12 types, 1 warning               | 12  | 0    |
| 5quater: visual check (`-47`, backpromote)                                          | 1 type                            | 1   | 0    |
| 7bis: single place in the diagram (`-46`)                                           | 1                                 | 1   | 0    |
| 7ter: flag-off A/B against `origin/main`                                            | not run                           |     |      |

No SKIP line in sections 6quater and 6sexies: the developer org groups ran.

___

## Results by group

### Sections 3, 4 and 4bis (`-46`): 42 OK

### Section 6, edge cases: 45 OK, 2 FAIL

- **32, `edge-marker-guard-solved`**: after the commit that solves the conflict markers of the
  promotion branch, the validation still reported the markers. The branch on GitHub holds no
  marker (checked afterwards on `origin`): the validation ran on a stale `refs/pull/16/merge`.
  `p_wait_merge_ref` waits 90 seconds, GitHub took longer to rebuild the ref, and the script goes
  on when the wait times out.
- **37, `edge-feature-off`**: a consequence of 32. It validates the same merge ref with the
  feature switched off, so it deployed the `CustomLabels` file that still held the markers.

Both are a wait of the test that is too short, not a product defect: the same two checks pass on
Azure DevOps, Bitbucket and GitLab in this run. Not replayed: see "What this run did not cover".

### Section 6quater, deployment actions: 21 OK

### Section 6sexies, identical actions: 24 OK

### Section 6bis, backpromote (`-47`): 63 OK

It took 1 hour 35 minutes where the other providers took about 17 minutes: two webpack builds of
the VS Code extension ran on the workstation during it.

### Section 6quinquies, real CI on GitHub Actions (`-ci-2`): 22 OK

16 jobs, all recorded "real CI" in `ci-jobs.tsv`, none simulated. 601 seconds queued and 4381
seconds run in total, 1 hour 17 minutes of wall clock. X1 and X2 pass.

### Section 5quater, visual check

12 comment types pictured on `-46`, one warning: the `pre` block of the conflicts prompt in the
description of promotion #29 is 3626px wide in a 952px description. GitHub scrolls it sideways.

Pictures read one by one by a reviewer (23 on `-46`, 2 on `-47`): no raw markdown or HTML, icons
drawn, verdict first, every `-open` picture unfolded.

___

## What the run found

| Finding                                                                                                                                 | Status                                   |
|-----------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------|
| `p_wait_merge_ref` gives up after 90 seconds on GitHub and the script goes on with a stale merge ref (checks 32 and 37)                 | test script, see the note under the table |
| A fold says "26 Pull Requests" where the line under it says "collected from 27", and 24 against 25: the list leaves out the Pull Request being read | open, wording, same as 10-09   |
| The Backpromotes comment of `-46` names its org by a lowercase id only: the scratch org has no alias in that test                       | open, cosmetic                           |
| The two "Results by org" tables of the action details are squeezed by a long Note column: the date and the status wrap                  | open, cosmetic                           |
| `prmerge-16`, the local branch name of the job simulator, is listed as a ticket                                                         | test artifact, not seen on a real CI job |
| The Backpromotes comment has no banner and no navigation line                                                                           | by design (`backpromoteCommentUtils.ts`) |

Product fix of the run, found on Bitbucket and pushed as `c6ed121b6`: a blank line before the list
of Pull Requests already deployed through a promotion branch. On GitHub the list was already
drawn as bullets, and still is.

___

## What this run did not cover

- **Checks 32 and 37 were not replayed.** The replay needs a new repository and sections 3, 4 and
  6 again. The user chose to stop the replays on 2026-10-10.
- **Section 7ter, the flag-off A/B against `origin/main`, was not run.** The user chose to skip it
  for this run. Nothing in this run proves that the output of a project without promotion
  branches is unchanged by `feat/pr-modal-job-artifacts`.
- **The visual check and the comment audit of the real CI comments** (`-ci-2`) were not run.
- The known gaps of the skill stay: no Jenkins, no Gitea, no Bitbucket Server, no production org,
  no real sandbox (scratch orgs stand in for developer sandboxes), VS Code panels are checked
  through the extension's compiled code and not by clicks.

___

## What was restarted, and why

- The first creation of the sections repository, `-44`, lost its first push to
  `getaddrinfo() thread failed to start` (the workstation was short on memory). `-44` exists and
  is empty; the run started again on `-46` and `-47`.
- The background waiters of the session were stopped several times by the low memory of the
  workstation. The test chains themselves kept running.

___

## Left behind

Repositories `nvuillam/sfdx-hardis-promo-e2e-44` (empty), `-46`, `-47` and `-ci-2`, and the two
scratch orgs (they expire on 2026-10-12). Next free numbers: `-48`, `-ci-3`. Work folders:
`%TEMP%/e2e-1010/promo-e2e-github*`, `promo-e2e-bp-github*`, `promo-e2e-ci-github*`.
