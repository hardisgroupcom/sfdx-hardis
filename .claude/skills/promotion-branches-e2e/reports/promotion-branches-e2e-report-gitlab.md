# Promotion branches, deployment actions and backpromote: end to end test on GitLab

**Date:** 2026-10-08 and 2026-10-09 (supersedes the run of 2026-10-08 on `feat/readable-pr-comments`)
**Why this run:** the four providers in a row on `e2e-updates`, and the first live run of the real
CI section (6quinquies) on GitLab CI, built the day before and never run.

**Projects under test** (private, created empty for this run, on `gitlab.hardis-group.com`):

- sections 4, 4bis, 4ter, 5bis, 5quater, 6, 6quater, 6sexies and 7bis:
  `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-16` (id 4511)
- backpromote (Beta), section 6bis: `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-17` (id 4512)
- real CI with `e2e-updates` linked by `sf plugins link`, section 6quinquies:
  `busalesforce/playground/sfdx-hardis-promo-e2e-ci-gl-1` (id 4513), whose group runners ran the jobs

**Salesforce org:** the Developer Edition org of `E2E_ORG` (also the Dev Hub). Scratch orgs
`promo-e2e-dev` (also `DEV_ORG` of 6quater and 6sexies) and `promo-e2e-dev2`.
**sfdx-hardis:** `e2e-updates`, through `bin/dev.js`. The CI jobs link the branch as pushed (W0).
**vscode-sfdx-hardis:** `e2e-updates` at `dbc7e197`, compiled with `yarn compile`.

___

## Counts

| Section                                                                             | Checks                            | OK  | FAIL |
|-------------------------------------------------------------------------------------|-----------------------------------|-----|------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                | 42  | 0    |
| 6: edge cases, groups g1 to g6                                                      | 47                                | 47  | 0    |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                  | 21                                | 21  | 0    |
| 6sexies: identical actions, I1 to I10                                               | 24                                | 24  | 0    |
| 6bis: backpromote B0 to B16, C1 to C4 (gl-17)                                       | 63                                | 63  | 0    |
| 6quinquies: real CI, W0 to W9, X1, X2 (ci-gl-1)                                     | 21, W8 skipped (GitHub only)      | 21  | 0    |
| 4ter: single Pull Request window, simulated jobs (gl-16)                            | 47 merge requests                 | 47  | 0    |
| 4ter: single Pull Request window, real CI jobs (ci-gl-1, X1)                        | 1                                 | 1   | 0    |
| 5bis: comment audit (gl-16)                                                         | 1108 checks over 53 merge requests | all | 0    |
| 5bis: comment audit of the real CI comments (ci-gl-1)                               | 255 checks over 7 merge requests  | all | 0    |
| 5quater: visual check of the comments (gl-16)                                       | 10 types, 1 warning               | 10  | 0    |
| 5quater: visual check (gl-17, backpromote)                                          | 1 type                            | 1   | 0    |
| 5quater: visual check (ci-gl-1, comments of real jobs)                              | 8 types                           | 8   | 0    |
| 7bis: single place in the diagram (gl-16)                                           | 1                                 | 1   | 0    |
| 7ter: flag-off A/B                                                                  | not run                           |     |      |

No failure on GitLab, and no product defect specific to it.

___

## Results by group

### Sections 3, 4 and 4bis (gl-16): 42 OK

Stories S1 to S7 are merge requests !1 to !7, promotions P1 to P5 are !8 to !12, the retrofit is
!13. Same expectations as the runbook lists: scope of each validation and deployment, inherited
keywords, union of the test classes, one candidate row per User Story, release notes with and
without the vehicles, the second go-live of issue #2260, and the six DevOps Pipeline checkpoints.

### Section 6, edge cases (gl-16): 47 OK

Groups g1 to g6. Checks 28 and 29 (conflict kept, prompt embedded in the description) pass with the
prompt in a folded section of the description: GitLab has no cap that drops it, unlike Azure DevOps.

### Section 6quater, deployment actions (gl-16): 21 OK

Groups A, B, C and D. D ran with `DEV_ORG` set to the scratch org `promo-e2e-dev`: `action:run
--all --dev-org` records the Backpromotes rows, a second run skips what is already done in that
org, and the org of a major branch is refused.

### Section 6sexies, identical actions (gl-16): 24 OK

I1 to I10, I7 and I8 (the backpromote plan and run of the window) included.

### Section 6bis, backpromote (gl-17): 63 OK

B0 to B16 and C1 to C4.

### Section 6quinquies, real CI on GitLab CI (ci-gl-1): 21 OK

First live run. The project access token created by the run is `CI_SFDX_HARDIS_GITLAB_TOKEN`, so
the jobs comment as the project bot and the local commands as the person: W2 and W6 edit notes
across the two identities, which GitLab allows a Maintainer.

| Job                            | Mode    | Result                | Queued | Ran   |
|--------------------------------|---------|-----------------------|--------|-------|
| ci-check-c1                    | real CI | failed (expected, W1) | 2 s    | 252 s |
| ci-check-c1-rerun              | real CI | success               | 0 s    | 209 s |
| ci-check-c2-draft              | real CI | success               | 1 s    | 406 s |
| ci-deploy-integration-c1       | real CI | failed (expected, W4) | 1 s    | 187 s |
| ci-check-c3                    | real CI | success               | 2 s    | 247 s |
| ci-deploy-integration-c3       | real CI | success               | 2 s    | 198 s |
| ci-check-promotion-uat         | real CI | failed (expected, W5) | 2 s    | 238 s |
| ci-check-promotion-uat-rerun   | real CI | success               | 0 s    | 182 s |
| ci-deploy-uat-promotion        | real CI | success               | 1 s    | 214 s |
| ci-check-c5                    | real CI | success               | 1 s    | 264 s |
| ci-check-c6                    | real CI | success               | 1 s    | 256 s |
| ci-deploy-integration-c5       | real CI | success               | 1 s    | 212 s |
| ci-deploy-integration-c6       | real CI | success               | 0 s    | 198 s |
| ci-check-promotion-identical   | real CI | success               | 1 s    | 196 s |
| ci-deploy-uat-identical        | real CI | success               | 0 s    | 189 s |

15 jobs, all real CI, none simulated, about 58 minutes of jobs in 65 minutes of wall clock. The
group runners take a job at once and run it in three to four minutes, link step included, faster
than GitHub's or Azure's hosted agents.

What the first run proved, of the list the runbook kept as unproven:

| Unproven before                                                   | Result                                                        |
|-------------------------------------------------------------------|---------------------------------------------------------------|
| The runners reach github.com, npm and ghcr.io for the link step   | yes, three to four minutes per job                            |
| The project access token, and notes edited by the other identity  | W2 (tick by the person in a note of the bot) and W6 pass      |
| The draft warning (`Draft:` title prefix, `draft: true`)          | W3 and W3a pass                                               |
| W2 on a retried job                                               | passes: the retry reads the ticked checkbox                   |
| The CI lint of the generated files                                | valid, `deploy_to_org` selected on a push to a major branch   |

### Section 5quater, visual check (new in this run)

GitLab comments are drawn through `POST /api/v4/markdown` with the project, in a headless Chrome:
the markup is GitLab's, the frame around it is not (see "not covered").

| Repository | Types checked                                                                                                                                                                              | Result          |
|------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------|
| gl-16      | backpromotes, deployment-actions, deployment-actions+manual, deployment-failed, deployment-success, deployment-success+manual, promotion-description, promotion-description+conflicts, validation-success, validation-success+manual | 9 OK, 1 warning |
| gl-17      | backpromotes                                                                                                                                                                               | OK              |
| ci-gl-1    | the eight types the real jobs left                                                                                                                                                         | 8 OK            |

The warning is the conflict prompt of a promotion description: a code block 3112 pixels wide in a
952 pixel comment. A code block scrolls on GitLab, so it is expected. Tables, folded sections,
checkboxes, banner images and emoji are all drawn; no markdown is left as text.

___

## What the run found

Nothing specific to GitLab. Two things found on the other providers were checked here:

- The fix of the Azure DevOps log line (`promotionCreateConflictPromptFileOnly`) leaves the GitLab
  wording as it was: checks 28 and 29 pass with "embedded in the Pull Request description".
- The visual check first failed on every GitLab comment but one with "Navigation timeout": GitLab
  hands images over with `data-src` for its own lazy loader, and the page waited for a network
  that never went quiet. The script now gives the images their address and waits for them only.

___

## What this run did not cover

- **Section 7ter, flag-off A/B**: not run. It switches the sfdx-hardis checkout to `origin/main`,
  which cannot be done while other sections use the same working copy.
- **The real comment column of GitLab**: the visual check draws GitLab's own HTML in a plain frame,
  not in the merge request page. It proves tables, folds, checkboxes and images, not the width of
  the real page nor GitLab's own styles. `--render page` with a logged-in Chrome would.
- **A failed validation as a picture**: the run ends with every validation green, so no
  `validation-failed` comment was left to look at. `visual-fixtures.sh` leaves two (a deployment
  error, a manual action gate); see the GitHub and Azure DevOps reports for the providers it ran on.
- **Flow diff and MegaLinter comments**: no story of the run holds a Flow, and the MegaLinter job
  only pulls its image. The Code Quality tab of the Pull Request window is not exercised either.
- **No merged results pipelines**: the instance is GitLab CE, a merge request pipeline runs on the
  head of the source branch. The merge-ref lag of the runbook is only met by the local simulators.
- **Step B17** (terminal prompts of backpromote) and a real production org.
- The window of a promotion or major-to-major merge request is not compared, and nothing of the
  extension is rendered or clicked.
- The four pipeline levels share one Salesforce org.

___

## Left behind

Projects `sfdx-hardis-promo-e2e-gl-16` and `-gl-17` in the personal namespace, and
`sfdx-hardis-promo-e2e-ci-gl-1` in the shared group `busalesforce/playground`, with its CI/CD
variables and its project access token (7 days). Delete the group project when the report has
been read (runbook section 9).
