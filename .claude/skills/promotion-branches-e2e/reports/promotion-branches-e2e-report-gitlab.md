# Promotion branches, deployment actions and backpromote: end to end test on GitLab

**Date:** 2026-10-14 (supersedes the run of 2026-10-10 on `feat/pr-modal-job-artifacts`)
**Why this run:** regression check of the four providers on `main` after the release of 8.18.0
(the scratch org pool in the git provider, hardisgroupcom/sfdx-hardis#2343). GitLab after GitHub.

**Repositories under test** (private, created empty for this run, on `gitlab.hardis-group.com`):

- sections 3, 4, 4bis, 4ter, 5bis, 5quater, 6, 6quater, 6sexies and 7bis:
  `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-21` (project 4531)
- backpromote (Beta), section 6bis: `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-22` (project 4532)
- real CI with the branch linked by `sf plugins link`, section 6quinquies:
  `busalesforce/playground/sfdx-hardis-promo-e2e-ci-gl-3` (project 4530, stopped, see "What was
  restarted") then `sfdx-hardis-promo-e2e-ci-gl-4` (project 4533)

**Salesforce org:** the Developer Edition org of `E2E_ORG` (also the Dev Hub). Scratch orgs
`promo-e2e-dev` (also `DEV_ORG` of 6quater and 6sexies) and `promo-e2e-dev2`, created by the run of
2026-10-10 and reset by the setup of this one.
**sfdx-hardis:** `main` at `e8caccee6` (8.18.0), through `bin/dev.js` for the simulators, cloned and
linked by the real CI jobs.
**vscode-sfdx-hardis:** `main` at `ef21b5ab`, compiled with `yarn compile`.

___

## Counts

| Section                                                                             | Checks                            | OK  | FAIL | Not covered                       |
|-------------------------------------------------------------------------------------|-----------------------------------|-----|------|-----------------------------------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                | 42  | 0    |                                   |
| 6: edge cases, groups g1 to g6                                                      | 47                                | 47  | 0    |                                   |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                  | 21                                | 21  | 0    |                                   |
| 6sexies: identical actions, I1 to I10                                               | 24                                | 24  | 0    |                                   |
| Visual fixtures (VE, VG)                                                            | 2                                 | 2   | 0    |                                   |
| 6bis: backpromote B0 to B16, C1 to C4 (`gl-22`)                                     | 63                                | 63  | 0    |                                   |
| 6quinquies: real CI, W0 to W9, X1, X2 (`ci-gl-4`)                                   | 22                                | 19  | 0    | 2 (W3, W5), 1 SKIP by design (W8) |
| 4ter: single Pull Request window, simulated jobs (`gl-21`)                          | 49 Pull Requests                  | 49  | 0    |                                   |
| 4ter: single Pull Request window, real CI jobs (`ci-gl-4`, X1)                      | 1                                 | 1   | 0    |                                   |
| 5bis: comment audit (`gl-21`)                                                       | 1142 checks over 55 Pull Requests | all | 0    |                                   |
| 5quater: visual check of the comments (`gl-21`, fixtures included)                  | 12 types, 1 warning               | 12  | 0    |                                   |
| 5quater: visual check (`gl-22`, backpromote)                                        | 1 type                            | 1   | 0    |                                   |
| 7bis: single place in the diagram (`gl-21`)                                         | 1                                 | 1   | 0    |                                   |
| 7ter: flag-off A/B against `origin/main`                                            | see "What this run did not cover" |     |      |                                   |

No SKIP line in sections 6quater and 6sexies: the developer org groups ran. Two
`getaddrinfo() thread failed to start` in the whole output: one on the `git pull` of the retrofit
branch of section 4bis (02:5x, the GitHub backpromote still running; the retrofit check 23a passed,
the push went through on the next command), one on a `curl` poll of the real CI section at 04:36
(4.6 GB free at the time, so not only memory). Neither changed a result. No fork failure.

Wall clock: sections 1 h 07 min, fixtures 2 min, post checks 9 min, backpromote 48 min (setup
7 min 30 s), real CI 1 h 02 min stopped then 51 min in parallel with the Azure sections.

___

## Results by group

### Sections 3, 4 and 4bis (`gl-21`): 42 OK

### Section 6, edge cases: 47 OK

Checks 32 and 37 (marker guard solved, feature off) pass, as on GitHub.

### Section 6quater, deployment actions: 21 OK

### Section 6sexies, identical actions: 24 OK

### Section 6bis, backpromote (`gl-22`): 63 OK

B0 to B16 and C1 to C4 in 48 minutes (28 on GitHub: GitLab answers its merge request API more
slowly, and the setup waited on the mergeability of three merge requests). B2 ran as
`developer-edition.json`; `refused-production.json` stays not covered.

### Section 6quinquies, real CI on GitLab CI (`ci-gl-4`): 19 OK, 2 not covered, 1 SKIP

The group `busalesforce/playground` has three shared runners with the same tags. On 2026-10-14 the
runner `hsfdc1gruplv002.hardis.fr` (id 2058) has a full disk: every job that lands on it dies in the
`yarn install` of the link step with `ENOSPC: no space left on device`, and every job that lands on
`hsfdc1gruplv001.hardis.fr` passes. Jobs are dispatched at random between them.

The first attempt (`ci-gl-3`, 01:56 to 02:58) put its five jobs on the full runner: W0 to W2 and W3a
passed (W0 to W2 on the re-run job, which the first attempt happened to get through before the disk
filled), W3, W4 and W4b failed with `ENOSPC`, and the attempt was stopped by hand. The second
attempt (`ci-gl-4`, 04:03 to 04:54) got 15 jobs, all real CI, none simulated: 9 on the good runner
and 6 on the full one. The last job of the run (`ci-deploy-uat-identical`, 04:50) landed on the
full runner and passed: its disk had room again by then.

| Job                           | Runner | Result              | Check            |
|-------------------------------|--------|---------------------|------------------|
| ci-check-c1                   | lv001  | failed, as expected | W0, W1, W1b OK   |
| ci-check-c1-rerun             | lv001  | success             | W2 OK            |
| ci-check-c2-draft             | lv002  | `ENOSPC`            | W3 not covered   |
| ci-deploy-integration-c1      | lv001  | failed, as expected | W4, W4b OK       |
| ci-check-c3                   | lv002  | `ENOSPC`            | no check on it   |
| ci-deploy-integration-c3      | lv001  | success             | W4c OK           |
| ci-check-promotion-uat        | lv002  | `ENOSPC`            | W5 not covered   |
| ci-check-promotion-uat-rerun  | lv001  | success             | W6b OK           |
| ci-deploy-uat-promotion       | lv001  | success             | W7, W7b OK       |
| ci-check-c5, ci-check-c6      | lv002  | `ENOSPC`            | no check on them |
| ci-deploy-integration-c5, -c6 | lv001  | success             | W9a OK           |
| ci-check-promotion-identical  | lv001  | success             | (W9 setup)       |
| ci-deploy-uat-identical       | lv002  | success             | W9, W9b OK       |

28 seconds queued and 2633 seconds run in total. The checks whose job landed on the full runner
are **not covered**, not failed: W3 (a GitLab draft is warned about, not stopped) and W5 (the
validation of the promotion stops on the manual action pending in uat). The checks whose job ran
are green, W5b, W6 and W6c included (they read the forecast and set the status without a job). W8
(the missing `safe.directory` line) is GitHub only, SKIP by design. X1 (the Pull Request window on
the real comments, merged merge requests included) and X2 (the DevOps Pipeline) pass.

Two more attempts followed to cover W3 and W5, once the full runner had answered a job: `ci-gl-5`
hung before its first merge request (see "What was restarted") and `ci-gl-6` (05:19) put its very
first job on `hsfdc1gruplv002`, full again (`ENOSPC` at 05:21). It was stopped there: **W3 and W5
stay not covered on GitLab for this run.** Four projects for one section is where the night's budget
ends; the runner needs its disk cleaned before the next run.

### Section 5quater, visual check

12 comment types pictured on `gl-21` (23 pictures), one on `gl-22` (2 pictures), one warning: the
`pre` block of the conflicts prompt in the description of promotion !29 is 3112px wide in a 952px
description. On GitLab the capture shows the lines cut at the right edge and no scrollbar (the
reviewer failed that picture on "nothing cut"); GitLab does scroll the block sideways in a browser.
Same finding as 2026-10-10.

Every picture was read by a reviewer agent against the checklist of the runbook: banner and
verdict first, icons drawn, checkboxes on their line, folded sections fold and open, code in code
blocks, no raw markdown or HTML, nothing cut, navigation line with the current comment marked.
24 pass, 1 fails on the cut prompt above. What the reading added is in the table below.

___

## What the run found

| Finding                                                                                                                                                                                                                                            | Status                                                                                                |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| The e2e script `ci-workflows-prepare.cjs` refused the Azure and Bitbucket templates of 8.18.0 (a scratch org tests job was added to them): the real CI runs of those two providers died before any repository existed                              | test script defect, fixed during the run (see the Azure and Bitbucket reports)                        |
| A shared GitLab runner with a full disk fails every job it gets, and the section records a FAIL that reads like a product defect                                                                                                                   | infrastructure; runbook trap added                                                                    |
| The "N Pull Requests" lists of the validation and deployment comments are not in numeric order (#1, #2, #3, #13, ..., #4, #5)                                                                                                                      | fixed on `fix/pr-comment-wording`, see the GitHub report                                              |
| The banner of a deployment whose metadata deployed and whose post-deployment action failed reads "Deployment failed", while the headline says "Deployed to integration, but..."                                                                    | open, wording, same as GitHub                                                                         |
| The banner of a validation stopped by the manual action gate reads "Deployment simulation failed" while its Metadata row says "Not validated": nothing was simulated                                                                               | open, wording, same as GitHub                                                                         |
| "To do by hand in uat before the deployment" of a validation lists only an action already ticked as done                                                                                                                                           | open, wording, same as GitHub                                                                         |
| "N Pull Request(s)" with a known count                                                                                                                                                                                                             | fixed on `fix/pr-comment-wording`                                                                     |
| A fold says "26 Pull Requests" where the line under it says "collected from 27"; on the validation of the same merge request, "24 Pull Requests" against "(25 Pull Requests)"                                                                      | fixed on `fix/pr-comment-wording`: the fold says "other"                                              |
| The "already deployed through a promotion branch" lists of the validation and of the deployment of !36 (into preprod) differ: the validation names the branches into preprod and into main, the deployment only those into main, and leaves out #2 | open, to look at (may be by design)                                                                   |
| In the Deployment Actions comment of !37, a manual action of the developer org row shows "to do by hand" together with a local job id and "Run locally by ... on ..." (the developer org run of 6quater D)                                         | open, data wording, new                                                                               |
| The two "Results by org" tables of the action details are squeezed by a long Note column                                                                                                                                                           | open, cosmetic, same as GitHub                                                                        |
| The Backpromotes comment of `gl-21` names the developer org by a lowercase id; the same org is "dev-sandboxes" in the Deployment Actions comment and "devorg1 (00D...)" in the backpromote run                                                     | open, cosmetic, same as GitHub                                                                        |
| The Backpromotes comment of `gl-22` lists two sandboxes both named `devorg1` with different ids, and an empty "Left out" column                                                                                                                    | test setup (both scratch orgs carry the same name in the plan); column empty when nothing is left out |
| The Backpromotes comment has no banner and no navigation line, and the navigation lines of the other comments never link to it                                                                                                                     | open, consistency, new                                                                                |
| The Job column of the simulated runs is empty on the integration rows: the simulator sets no job URL                                                                                                                                               | test artifact; a real job fills it (W4b)                                                              |

No product defect. Three wording findings were fixed after the runs on `fix/pr-comment-wording`
(see the GitHub report); the one defect found during the run was in the test scripts.

___

## What this run did not cover

- **Section 7ter, the flag-off A/B against `origin/main`.** The branch under test is `main`
  itself, so the pair `branch` / `main` compares a checkout with itself. Not run; the last proof is
  the one of 2026-10-09 (0 differing lines).
- **Real CI checks whose job landed on the full runner** (`ci-gl-4`): W3 (a draft merge request
  is warned about, not stopped) and W5 (the validation of a promotion stops on the manual action
  pending in uat). Two more attempts did not reach them. They passed on GitHub Actions and
  Bitbucket Pipelines the same night; the GitLab side of them was last proven on 2026-10-10.
- **The visual check and the comment audit of the real CI comments** (`ci-gl-4`) were not run: X1
  reads them through the modal calls only.
- `refused-production.json` (B2 against a real production org), the terminal prompts of B17, the
  Backpromote panel of VS Code, the Code Quality tab of the Pull Request window (no MegaLinter
  comment is posted by the run), the Flow diff comment (no story holds a Flow).
- The known gaps of the skill stay: no Jenkins, no Gitea, no Bitbucket Server, no production org,
  no real sandbox (scratch orgs stand in for developer sandboxes), VS Code panels are checked
  through the extension's compiled code and not by clicks.

___

## What was restarted, and why

- **The real CI section, three times.** `ci-gl-3` was stopped by hand at 02:58 after its fifth job
  died with `ENOSPC` on `hsfdc1gruplv002.hardis.fr`; `ci-gl-4` ran from 04:03 with its own project
  and lost W3 and W5 to the same runner. The runner was not paused (shared infrastructure of the
  group). `ci-gl-5` (04:55) never opened its first merge request: the `curl` that creates it hung
  for minutes, twice, from the script's shell, while the same call from another shell answered in
  0.3 s (the workstation also logged two `getaddrinfo() thread failed to start` that night: its
  resolver threads fail now and then). The probe call left merge request !1 on `ci-gl-5`, closed by
  hand. The attempt was stopped at 05:19; `gl_mr_create` got a `--max-time 120` so a hung call is
  retried by `p_open` instead of blocking the run. `ci-gl-6` (05:19) lost its first job to the
  full runner and was stopped at 05:22. Nothing else restarted: the sections, the post checks and
  the backpromote ran once, end to end.

___

## Left behind

Projects `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-21`, `gl-22`, and
`busalesforce/playground/sfdx-hardis-promo-e2e-ci-gl-3`, `ci-gl-4`, `ci-gl-5` (empty but for one
closed merge request) and `ci-gl-6`, and the two scratch orgs (shared with the GitHub run). Next
free numbers: `gl-23`, `ci-gl-7`. Work folders: `%TEMP%/e2e-1014/promo-e2e-gitlab*`,
`promo-e2e-bp-gitlab*`, `promo-e2e-ci-gitlab*` (first attempt), `promo-e2e-ci-gitlab-2*` (second),
`promo-e2e-ci-gitlab-3*` (third) and `promo-e2e-ci-gitlab-4*` (fourth).
