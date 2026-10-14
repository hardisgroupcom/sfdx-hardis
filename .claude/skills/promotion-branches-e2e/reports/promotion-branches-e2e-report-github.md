# Promotion branches, deployment actions and backpromote: end to end test on GitHub

**Date:** 2026-10-14 (supersedes the run of 2026-10-10 on `feat/pr-modal-job-artifacts`)
**Why this run:** regression check of the four providers on `main` after the release of 8.18.0
(the scratch org pool in the git provider, hardisgroupcom/sfdx-hardis#2343). GitHub first.

**Repositories under test** (private, created empty for this run):

- sections 3, 4, 4bis, 4ter, 5bis, 5quater, 6, 6quater, 6sexies and 7bis: `nvuillam/sfdx-hardis-promo-e2e-48`
- backpromote (Beta), section 6bis: `nvuillam/sfdx-hardis-promo-e2e-49`
- real CI with the branch linked by `sf plugins link`, section 6quinquies: `nvuillam/sfdx-hardis-promo-e2e-ci-3`

**Salesforce org:** the Developer Edition org of `E2E_ORG` (also the Dev Hub). Scratch orgs
`promo-e2e-dev` (also `DEV_ORG` of 6quater and 6sexies) and `promo-e2e-dev2`, created by the run of
2026-10-10 and reset by the setup of this one.
**sfdx-hardis:** `main` at `e8caccee6` (8.18.0), through `bin/dev.js` for the simulators, cloned and
linked by the real CI jobs.
**vscode-sfdx-hardis:** `main` at `ef21b5ab`, compiled with `yarn compile`.

___

## Counts

| Section                                                                             | Checks                            | OK  | FAIL |
|-------------------------------------------------------------------------------------|-----------------------------------|-----|------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                | 42  | 0    |
| 6: edge cases, groups g1 to g6                                                      | 47                                | 47  | 0    |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                  | 21                                | 21  | 0    |
| 6sexies: identical actions, I1 to I10                                               | 24                                | 24  | 0    |
| Visual fixtures (VE, VG)                                                            | 2                                 | 2   | 0    |
| 6bis: backpromote B0 to B16, C1 to C4 (`-49`)                                       | 63                                | 63  | 0    |
| 6quinquies: real CI, W0 to W9, X1, X2 (`-ci-3`)                                     | 22                                | 22  | 0    |
| 4ter: single Pull Request window, simulated jobs (`-48`)                            | 49 Pull Requests                  | 49  | 0    |
| 4ter: single Pull Request window, real CI jobs (`-ci-3`, X1)                        | 1                                 | 1   | 0    |
| 5bis: comment audit (`-48`)                                                         | 1142 checks over 55 Pull Requests | all | 0    |
| 5quater: visual check of the comments (`-48`, fixtures included)                    | 12 types, 1 warning               | 12  | 0    |
| 5quater: visual check (`-49`, backpromote)                                          | 1 type                            | 1   | 0    |
| 7bis: single place in the diagram (`-48`)                                           | 1                                 | 1   | 0    |
| 7ter: flag-off A/B against `origin/main`                                            | see "What this run did not cover" |     |      |

No SKIP line in sections 6quater and 6sexies: the developer org groups ran. No `getaddrinfo` or
fork failure in any output file: the workstation started the run with 2.7 GB free and went up to
6 GB once the other chains of the night were the only load.

Wall clock: sections 1 h 16 min, post checks 10 min, backpromote 28 min (setup 2 min 30 s), real
CI 1 h 26 min in parallel with the sections.

___

## Results by group

### Sections 3, 4 and 4bis (`-48`): 42 OK

### Section 6, edge cases: 47 OK

Checks 32 and 37 (marker guard solved, feature off), which a stale merge ref failed on 2026-10-10,
pass: the longer wait on the pushed commit holds.

### Section 6quater, deployment actions: 21 OK

### Section 6sexies, identical actions: 24 OK

### Section 6bis, backpromote (`-49`): 63 OK

B0 to B16 and C1 to C4 in 28 minutes. B2 ran as `developer-edition.json` (the Developer Edition
org is accepted as a dev environment); `refused-production.json` stays not covered.

### Section 6quinquies, real CI on GitHub Actions (`-ci-3`): 22 OK

16 jobs, all recorded "real CI" in `ci-jobs.tsv`, none simulated. 640 seconds queued and 4766
seconds run in total, 1 hour 26 minutes of wall clock. W8 (the missing `safe.directory` line)
ran, X1 and X2 pass.

### Section 5quater, visual check

12 comment types pictured on `-48` (23 pictures), one on `-49` (2 pictures), one warning: the
`pre` block of the conflicts prompt in the description of promotion #29 is 3626px wide in a 952px
description. GitHub scrolls it sideways, as on 2026-10-10.

Every picture was read by a reviewer agent against the checklist of the runbook: banner and
verdict first, icons drawn, checkboxes on their line, folded sections fold and open, code in code
blocks, no raw markdown or HTML, nothing cut, navigation line with the current comment marked.
All 25 pass. What the reading added is in the table below.

___

## What the run found

| Finding                                                                                                                                                                         | Status                                                                       |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------|
| The "N Pull Requests" lists of the validation and deployment comments are not in numeric order (#1, #2, #3, #13, #14, ..., #4, #5): a reader looking for #4 finds it after #33  | fixed on `fix/pr-comment-wording` (sorted by number)                         |
| The banner of a deployment whose metadata deployed and whose post-deployment action failed reads "Deployment failed", while the headline says "Deployed to integration, but..." | fixed on `fix/pr-comment-wording`: orange badge "Deployed, an action failed" |
| "To do by hand in uat before the deployment" of a validation lists only an action already ticked as done (skipped: already done in uat)                                         | fixed on `fix/pr-comment-wording`: the section is hidden once all is done    |
| "N Pull Request(s)" with a known count                                                                                                                                          | fixed on `fix/pr-comment-wording`                                            |
| A fold says "26 Pull Requests" where the line under it says "collected from 27" (24 against 25): the list leaves out the Pull Request being read                                | fixed on `fix/pr-comment-wording`: the fold says "26 other Pull Requests"    |
| The two "Results by org" tables of the action details are squeezed by a long Note column: the date and the status wrap                                                          | open, cosmetic, same as 10-10                                                |
| The Backpromotes comment of `-48` (section 6quater D) names the developer org by a lowercase id: the scratch org has no alias in that test                                      | fixed on `fix/pr-comment-wording`: the org is shown by its sandbox or alias  |
| The Job column of the simulated runs is empty on the integration rows: the simulator sets no job URL                                                                            | test artifact; a real job fills it (W4b)                                     |

No product defect. Three wording findings were fixed after the four runs ended, on the branch
`fix/pr-comment-wording` (commit `0bd7b7cc0`, a Pull Request against `main`): the carried Pull
Requests are sorted by number, the fold says "other" when the Pull Request being read is left out,
and no sentence writes "Pull Request(s)". The fix was written in a separate worktree while the
simulators of the last provider were still running the sources on disk. The one test script defect
of the night (`ci-workflows-prepare.cjs` refusing the Azure and Bitbucket templates of 8.18.0, which
gained a scratch org tests job) does not touch the GitHub writer: the GitHub job is gated by
`vars.USE_SCRATCH_ORGS` and stays in the file, skipped.

___

## What this run did not cover

- **Section 7ter, the flag-off A/B against `origin/main`.** The branch under test is `main`
  itself, so the pair `branch` / `main` of the A/B compares a checkout with itself and proves
  nothing. Not run; the last proof is the one of 2026-10-09 (0 differing lines).
- **The visual check and the comment audit of the real CI comments** (`-ci-3`) were not run: X1
  reads them through the modal calls only.
- `refused-production.json` (B2 against a real production org), the terminal prompts of B17, the
  Backpromote panel of VS Code, the Code Quality tab of the Pull Request window (no MegaLinter
  comment is posted by the run), the Flow diff comment (no story holds a Flow).
- The known gaps of the skill stay: no Jenkins, no Gitea, no Bitbucket Server, no production org,
  no real sandbox (scratch orgs stand in for developer sandboxes), VS Code panels are checked
  through the extension's compiled code and not by clicks.

___

## What was restarted, and why

Nothing. The chains ran once, end to end.

___

## Proof run of the fix branch

The branch `fix/pr-comment-wording` (PR #2345) ran the same sections again on GitHub the same day,
from a worktree, in repositories `-50` (sections) and `-51` (backpromote): sections 4, 6, 6quater
and 6sexies 42 / 47 / 21 / 24 OK, the two visual fixtures OK, the backpromote steps 61 OK, the
diagram, the audit (1309 checks over 55 Pull Requests) and the PR modal check green.

Three e2e scripts failed on the new wording before the product did, and were fixed on the branch:
`check-backpromote-comments.cjs` expected the sandbox key in the visible table (it shows the org
label now), `check-pr-modal.cjs` did not know the "Developer orgs" header, and
`check-comments-visual.cjs` took the four entry navigation line for a table row left in pipes. The
two Backpromotes comment checks recorded as failed (C1, C2) replay green with the fixed script.

What the pictures show: the "Developer orgs" column, the Backpromotes comment with its navigation
line on the feature Pull Requests and no Backpromotes entry on the promotion ones, a developer org
named by its alias (`promo-e2e-dev`) or by its host when the alias is unknown to the job. The two
new banners show their alt text: the images are served from `main` until the merge. The promotion
descriptions of the shared stories of section 6sexies carry no "Tickets:" line, in this run as in
the night run: not something the branch changed.

___

## Left behind

Repositories `nvuillam/sfdx-hardis-promo-e2e-48`, `-49`, `-50`, `-51` and `-ci-3`, and the two
scratch orgs (they expire on 2026-10-12 by their original date; the setup of this run reset them).
Next free numbers: `-52`, `-ci-4`. Work folders: `%TEMP%/e2e-1014/promo-e2e-github*`,
`promo-e2e-bp-github*`, `promo-e2e-ci-github*` (the night's GitHub folders were renamed
`promo-e2e-night-*` before the proof run).
