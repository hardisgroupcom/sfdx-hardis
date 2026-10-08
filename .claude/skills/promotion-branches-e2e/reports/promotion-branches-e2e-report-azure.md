# Promotion branches, deployment actions and backpromote: end to end test on Azure DevOps

**Date:** 2026-10-08 (supersedes the run of 2026-09-09)
**Why this run:** first run on Azure DevOps of the scripted sections (4, 4bis, 4ter, 6, 6bis,
6quater, 6sexies), which `promotion-provider.sh` maps to the four providers since 2026-10-08, and
first run ever of the real CI section (6quinquies) on Azure Pipelines.

**Repositories under test** (private, created empty for this run, in
`nicolasvuillamy/tests-sfdx-hardis`):

- sections 4, 4bis, 4ter, 5bis, 6, 6quater, 6sexies and 7bis: `sfdx-hardis-promo-e2e-az-7`
- backpromote (Beta), section 6bis: `sfdx-hardis-promo-e2e-az-8`
- real CI with `e2e-updates` linked by `sf plugins link`, section 6quinquies:
  `sfdx-hardis-promo-e2e-ci-az-3` (pipelines 6 and 7)

`sfdx-hardis-promo-e2e-ci-az-1` and `-ci-az-2` are two real CI attempts stopped after their first
job: both failed for the harness, not the product (see "What the run found").

**Salesforce org:** the Developer Edition org of `E2E_ORG` (also the Dev Hub). Scratch orgs
`promo-e2e-dev` and `promo-e2e-dev2`, reset to the base project by the backpromote setup.
**sfdx-hardis:** `e2e-updates` at `b62dedf1a` plus the fixes of this run, through `bin/dev.js`. The
CI jobs link `e2e-updates` as pushed (`b62dedf1a`, W0 asserts the link).
**vscode-sfdx-hardis:** `e2e-updates` at `dbc7e197`, compiled with `yarn compile`.

___

## Counts

| Section                                                                             | Checks                            | OK  | FAIL | Not run |
|-------------------------------------------------------------------------------------|-----------------------------------|-----|------|---------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                | 42  | 0    |         |
| 6: edge cases, groups g1 to g6                                                      | 47                                | 46  | 1    |         |
| 6quater: gate, recovery, set-status ahead, forecast                                 | 17, group D skipped               | 17  | 0    | D       |
| 6sexies: identical actions, I1 to I10                                               | 20, I7 and I8 skipped             | 20  | 0    | I7, I8  |
| 6bis: backpromote B0 to B16, C1 to C4 (az-8)                                        | 63                                | 63  | 0    |         |
| 6quinquies: real CI, W0 to W9, X1, X2 (ci-az-3)                                     | 21, W8 skipped (GitHub only)      | 21  | 0    | W8      |
| 4ter: single Pull Request window, simulated jobs (az-7)                             | 46 Pull Requests                  | 46  | 0    |         |
| 4ter: single Pull Request window, real CI jobs (ci-az-3, X1)                        | 1                                 | 1   | 0    |         |
| 5bis: Pull Request comment audit (az-7)                                             | 1136 checks over 53 Pull Requests | all | 0    |         |
| 5bis: comment audit of the real CI comments (ci-az-3)                               | 271 checks over 7 Pull Requests   | all | 0    |         |
| 7bis: single place in the diagram (az-7)                                            | 1                                 | 1   | 0    |         |
| 7ter: flag-off A/B                                                                  | not run                           |     |      | all     |

The single FAIL, edge check 29, is a defect of the CLI fixed during the run and replayed green
(below). The 46 of the Pull Request window are the second pass: the first one was 0 OK out of 46,
which is the main finding of this run.

___

## Pipeline under test

`integration -> uat -> preprod -> main`, the four branches deployed to the same org,
`enablePromotionBranches`, delta deployment between major branches, `NoTestRun`.

| Story | Pull Request | Target      | Promotions that carried it                         |
|-------|--------------|-------------|----------------------------------------------------|
| S1    | #101         | integration | P1 #109 (integration -> uat)                       |
| S2    | #102         | integration | none in section 4 (P9 #124 in section 6)           |
| S3    | #103         | integration | P1 #109, P3 #111 (uat -> preprod), P4 #112 (-> main) |
| S4    | #104         | uat         | P2 #110 (uat -> preprod), P4 #112                  |
| S5    | #105         | uat         | none                                               |
| S6    | #106         | preprod     | P4 #112                                            |
| S7    | #107         | preprod     | P5 #113 (second go-live)                           |

Retrofit of `main` into `integration`: #114. Pull Request ids are unique per organization, so the
repository started at #101.

___

## Results by group

### Sections 3, 4 and 4bis (az-7): 42 OK

| What                                                                              | Expected                                                                 | Result |
|-----------------------------------------------------------------------------------|--------------------------------------------------------------------------|--------|
| Validation and deployment of S1 to S7                                             | scope = the Pull Request alone, keywords and test classes read           | OK     |
| P1 to P5: `promotion:create`, validation, merge, deployment                       | declared stories in the scope, inherited keywords, union of test classes | OK     |
| A story that arrived through a promotion is a candidate of its own (P3)           | rows #101 and #103, one cherry-pick, #103 declared alone                 | OK     |
| Release notes of the go-live, with and without `--include-promotions`             | User Stories only, then the vehicles next to them                        | OK     |
| Second go-live (issue #2260)                                                      | S3, S4 and S6 come back in neither preprod nor uat                       | OK     |
| Retrofit                                                                          | stories named "already deployed through promotion branch(es)"            | OK     |
| DevOps Pipeline at the six checkpoints of section 4bis                            | windows, arrows and counters as the runbook lists them                   | OK     |

### Section 6, edge cases (az-7): 46 OK, 1 FAIL

| Group | What                                                                                   | Result |
|-------|----------------------------------------------------------------------------------------|--------|
| g1    | already promoted, empty cherry-pick, dirty report folder                               | OK     |
| g2    | conflicts (agent default, kept), marker guard and its comment, deployment from a promotion branch, feature off, no provider connection | OK, except check 29 |
| g3    | hand-named and retargeted branches, supersede, sync merge, unreadable declaration, grouped merge | OK     |
| g4    | branch merged twice, sync inside a story, conflicts kept for all, back-merge, octopus  | OK     |
| g5    | restricted and undeclared promotion steps, in the CLI and in the DevOps Pipeline       | OK     |
| g6    | full merge of uat into preprod after partial promotions                                | OK     |

Check 29 expects the conflict prompt embedded in the description of the promotion. Azure DevOps
caps a description at 4000 characters, so the description names the prompt file instead: intended.
The job log however still said "embedded in the Pull Request description". Fixed in the CLI, the
check now accepts the capped description when the log says so, and a replay on the same repository
(stories #159 and #160, promotion #161) logs "It is too long for a Pull Request description on this
git provider, so the description only names the file".

### Section 6quater, deployment actions (az-7): 17 OK

Groups A (the gate of validations, `set-status`, the draft), B (failed action, `action:run --next
all`, refused retry in preprod) and C (marked ahead in uat, forecast, promotion P6 #141). Group D
(developer org) not run: `DEV_ORG` was not set for this provider.

### Section 6sexies, identical actions (az-7): 20 OK

I1 to I6, I9 and I10 on stories #143 to #155, promotions PI #151, PD #153 and PV #156. I7 and I8
(backpromote plan and run of the window) not run: no `DEV_ORG`.

### Section 6bis, backpromote (az-8): 63 OK

B0 to B16 and C1 to C4, first run on Azure DevOps: no token, refused orgs and parent branch, first
plan, run from S1, manual action confirmed, new story, overwrite, org version kept then offered
again, agent protocol, panel protocol, deletion, excluded item, dirty tree, refreshed sandbox, scan
limit, reset. The "Backpromotes" threads carry one comment per Pull Request with their sandbox and
action rows.

### Section 6quinquies, real CI on Azure Pipelines (ci-az-3): 21 OK

`AZURE_E2E_CI_TOKEN=pat`: the jobs comment with the PAT.

| Job                            | Mode    | Result    | Queued | Ran   |
|--------------------------------|---------|-----------|--------|-------|
| ci-check-c1                    | real CI | failed (expected, W1) | 6 s    | 362 s |
| ci-check-c1-rerun              | real CI | succeeded | 6 s    | 382 s |
| ci-check-c2-draft              | real CI | succeeded | 7 s    | 374 s |
| ci-deploy-integration-c1       | real CI | failed (expected, W4) | 12 s   | 374 s |
| ci-check-c3                    | real CI | succeeded | 6 s    | 372 s |
| ci-deploy-integration-c3       | real CI | succeeded | 6 s    | 373 s |
| ci-check-promotion-uat         | real CI | failed (expected, W5) | 6 s    | 363 s |
| ci-check-promotion-uat-rerun   | real CI | succeeded | 6 s    | 375 s |
| ci-deploy-uat-promotion        | real CI | succeeded | 6 s    | 384 s |
| ci-check-c5                    | real CI | succeeded | 7 s    | 373 s |
| ci-check-c6                    | real CI | succeeded | 379 s  | 373 s |
| ci-deploy-integration-c5       | real CI | succeeded | 6 s    | 382 s |
| ci-deploy-integration-c6       | real CI | succeeded | 7 s    | 395 s |
| ci-check-promotion-identical   | real CI | succeeded | 6 s    | 374 s |
| ci-deploy-uat-identical        | real CI | succeeded | 7 s    | 384 s |

15 jobs, all real CI, none simulated. About 94 build minutes, under two hours of wall clock: the
single free parallel job only made one build wait (ci-check-c6, behind ci-check-c5).

W0 (the linked branch runs in the container job), W1 and W1b (the gate and its comment), W2 (the
checkbox ticked through the API, the policy queued again), W3 and W3a (a provider draft is only
warned), W4, W5, W6, W7, W9 (the same action in two stories runs once in the promotion), X1 (the
Pull Request window shows the comments of the real jobs) and X2 (the DevOps Pipeline).

___

## What the run found

### Product

1. **The Pull Request window of the DevOps Pipeline was empty on Azure DevOps.** Outside a
   pipeline, the CLI reads the repository from the git remote, so `BUILD_REPOSITORY_ID` holds a
   repository name, not a GUID. Fourteen calls of `azureDevops.ts` (`getThreads`,
   `getPullRequests`, `getPullRequestWorkItemRefs`, `createThread`, `updateComment`,
   `updateThread`) did not name the team project, and Azure answers "A project name is required in
   order to reference a Git repository by name". `action:list --with-status --with-workflows`, which
   the extension runs with the token alone, then returned no status and no run: the Deployment
   Actions pills and the Validation and Deployment tabs were empty, for every Pull Request. Section
   4ter: 0 OK out of 46 before the fix, 46 out of 46 after it. Fixed (`azureTeamProject()`), with a
   unit test (`test/common/gitProvider/azureDevopsTeamProject.test.ts`). The same defect also made
   `set-status`, the checkbox reader and every comment read fail for a person running the commands
   from a terminal with a token and no pipeline variables. The extension's own Azure provider
   already passes the project on its calls: no change there.
2. **`promotion:create` said the conflict prompt was embedded in the description when it was not.**
   New message `promotionCreateConflictPromptFileOnly` in the nine locales.

### Harness (fixed in the skill)

3. **Azure sends no `pr.sourceSha` and cancels the build of a previous head itself.** The wait read
   the cancelled build of the first push as the job (ci-az-1). `_azci_find_build` now matches a
   policy build by the parents of its merge commit, and `_azci_wait_build` follows the newer build
   when the one it watches is cancelled.
4. **The link step failed in the container job**: steps do not run as root and the image keeps the
   plugins in a folder of root (`EACCES ... /usr/local/lib/package.json`, ci-az-1), then `sudo`
   with the HOME of the step user left a `~/.sf` owned by root (ci-az-2). The Azure link step runs
   `sudo env "PATH=$PATH" "SF_DATA_DIR=$SF_DATA_DIR" HOME=/root sf plugins link`. E2E only: a real
   project never links a plugin in its job.
5. **The PAT cannot grant the build service its permission** (HTTP 401, it needs Security
   (Manage)), hence `AZURE_E2E_CI_TOKEN=pat`.
6. Editing `promotion-edge.sh` while it ran made bash stop on its last line with a syntax error,
   after the six groups had completed. Never edit a section script during its run.

The runbook holds 3, 4 and 5 under "Azure Pipelines".

___

## What this run did not cover

- **The system token of Azure Pipelines** (`AZURE_E2E_CI_TOKEN=system`): the build service has no
  "Contribute to pull requests" permission in the test project and the PAT cannot grant it. To
  cover it, allow it once by hand in Project settings > Repositories > Security, then run the CI
  section with the default token. W2 with a comment of the build service ticked by another user is
  unproven with it.
- **Section 7ter, flag-off A/B**: not run. It switches the sfdx-hardis checkout to `origin/main`,
  which cannot be done while other sections use the same working copy.
- **Group D of 6quater and I7, I8 of 6sexies** (developer org): `DEV_ORG` not set on this provider.
  They ran on GitLab the same day.
- **Step B17** (terminal prompts of backpromote) and `refused-production.json`: not scriptable, no
  production org in the harness.
- **The Code Quality tab** of the Pull Request window: no job posts a MegaLinter comment (the
  MegaLinter job is left out of the Azure checks pipeline to spare the single parallel job).
- **The window of a promotion or major-to-major Pull Request** is not compared, and nothing is
  rendered: the DevOps Pipeline is asserted through its data provider and as mermaid text, the
  Backpromote panel is not clicked.
- The four pipeline levels share one Salesforce org: deployment action state is keyed by org
  branch, not by distinct orgs.
- "Pull Request creation refused" (section 6) is not scripted.

___

## Left behind

Repositories `sfdx-hardis-promo-e2e-az-7`, `-az-8`, `-ci-az-1`, `-ci-az-2`, `-ci-az-3`, their
pipeline definitions (ids 2 to 7) and build policies, in `nicolasvuillamy/tests-sfdx-hardis`.
Runbook section 9 says how to delete them. Metadata prefixed `PromoE2E` / `E2E_` in the org.
