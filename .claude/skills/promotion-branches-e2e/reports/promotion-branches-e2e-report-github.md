# Promotion branches, deployment actions and backpromote: end to end test on GitHub

**Date:** 2026-10-04 (supersedes the run of 2026-10-03)
**Why this run:** identical deployment actions (sfdx-hardis #2271, Pull Requests sfdx-hardis #2277
and vscode-sfdx-hardis #546): when several Pull Requests of one run carry the same action, the first
one runs and the others are recorded as done by it. Section 6sexies ran for the first time, four
checks were added to it during the run (I8, I9, I10 and, in real CI, W9), and the rest of the runbook
ran again on the same branches.

**Repositories under test (private, created empty for this run):**

- promotion branches, deployment actions and identical actions, sections 4, 5bis, 5ter, 6, 6quater,
  6sexies (twice), 7bis and 7ter: `nvuillam/sfdx-hardis-promo-e2e-30`
- backpromote (Beta), section 6bis: `nvuillam/sfdx-hardis-promo-e2e-31`
- real CI workflows, section 6quinquies: `nvuillam/sfdx-hardis-promo-e2e-32`

**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, Dev Hub). Scratch
orgs `promo-e2e-dev` (also `DEV_ORG` of 6quater group D and of 6sexies I7 and I8) and
`promo-e2e-dev2`, created again for three days at the start: the previous ones expired on the day of
the run and the day after.
**sfdx-hardis:** `feat/identical-deployment-actions` at `4987e4a6f`, compiled, through `bin/run.js`
(`bin/dev.js` for the A/B pair), linked with `sf plugins link` in the CI workflows. The run changed
the test scripts only, no product code.
**vscode-sfdx-hardis:** `feat/identical-deployment-actions` at `54e61e23`, compiled with
`yarn compile`, plus one comment fix found by the run (`ad776302`).

Every simulated job is a real `deploy:smart`, `promotion:create`, `action:run`, `action:set-status`,
`action:list` or `work:backpromote` against the org, run locally with the GitHub Actions variables
set. Section 6quinquies runs the jobs in GitHub Actions themselves. GitLab has its own report.

___

## Counts

| Section                                                                             | Checks                            | OK                         | FAIL |
|-------------------------------------------------------------------------------------|-----------------------------------|----------------------------|------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                | 42                         | 0    |
| 6: edge cases, groups g1 to g6                                                      | 47                                | 46, then 38 replayed       | 0    |
| 6sexies: identical actions, first pass (I1 to I9)                                   | 19                                | 19                         | 0    |
| 6sexies: identical actions, replay `IA_RUN=2` (I1 to I10)                           | 24                                | 24                         | 0    |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                  | 21                                | 21                         | 0    |
| 6quinquies: the same features through real GitHub Actions workflows (W0 to W9)      | 19                                | 19                         | 0    |
| 6bis: backpromote B0 to B16, C1 to C4                                               | 63                                | 63                         | 0    |
| 5bis: Pull Request comment audit                                                    | 1534 checks over 64 Pull Requests | all                        | 0    |
| 5ter: action state read from the provider (#1)                                      | 1                                 | 1                          | 0    |
| 7bis: single place in the diagram                                                   | 1                                 | 1                          | 0    |
| 7ter: flag-off A/B against `origin/main` (`ff693e561`), second pair                 | 5 files compared                  | `TOTAL DIFFERING LINES: 0` | 0    |

Every first-time failure was a defect of the test scripts, fixed and replayed below. No product
defect was found in the identical actions.

___

## Identical deployment actions (section 6sexies)

First pass: SA #14, SB #15, SW #16, SP #17, SX #18, SY #19, SF #20, SC #21, promoted together to
uat by PI #22; SD #23 promoted alone by PD #24. Replay (`IA_RUN=2`): #51 to #58, PI #59, SD #60, PD
#61, then SG #62 and SH #63 promoted by PV #64. The shared step appends one character to an
untracked counter file, so "real runs" below is what really ran, whatever the logs say.

| Check | What                                                                                              | Result, first pass                                                                                                       |
|-------|---------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------|
| I1    | SW alone deployed into integration: both of its shared steps run (one Pull Request is one source) | 2 real runs                                                                                                              |
| I2    | PI carries the eight stories; the forecast of the promotion                                       | see the table below                                                                                                      |
| I3a   | the validation of PI merges nothing: every shared step is deployment-only                         | OK                                                                                                                       |
| I3    | the deployment of PI                                                                              | 3 real runs (SP before the deployment, SA, the repeat of SW), exit 1 on SF                                               |
| I4    | the copies in their own Deployment Actions comment                                                | `success` in uat with the note, SF `failed`, the rest `success`                                                          |
| I5    | `action:run --next all` retries SF                                                                | `success`, "Run locally by"; nothing waited after it (SC was a copy)                                                     |
| I6    | uat deployed again                                                                                | everything `already run in uat`, copies included: 0 real runs                                                            |
| I7    | backpromote plan of the window                                                                    | one key per action (`18:post:e2e-same-id`, `19:post:e2e-same-id`), same `identicalTo` as the forecast, SF out (uat only) |
| I8    | backpromote run of the window (new)                                                               | `byKey`: `identical` for SB, the first step of SW and SC, `run` for the others; 3 real runs, 8 items deployed            |
| I8c   | the Backpromotes comments of SB and SC (new)                                                      | a `done` row each                                                                                                        |
| I9    | the shared step written twice in the uat branch config, and SD carrying it (new)                  | the config actions run first, both of them (one source), SD logs the copy line naming the config; 2 real runs            |
| I10   | the shared step with context `all` in SG and SH (new, replay only)                                | the validation runs it for SG and records SH as done (1 real run); the deployment finds both done (0)                    |

The deployment of PI, as the job log shows it:

```
[GitProvider] Pull Request scope: 9 Pull Request(s) (#14, #15, #16, #17, #18, #19, #20, #21, #22)
[DeploymentActions] Running action E2E shared step before the deployment of PR 17 (from PR #17)
[DeploymentActions] Running action E2E shared step of PR 14 (from PR #14)
[DeploymentActions] Skipping action E2E shared step of PR 15 (from PR #15): same action as E2E shared step of PR 14 (#14), run once for this deployment
[DeploymentActions] Skipping action E2E shared step of PR 16 (from PR #16): same action as E2E shared step of PR 14 (#14), run once for this deployment
[DeploymentActions] Running action E2E step between the shared steps of PR 16 (from PR #16)
[DeploymentActions] Running action E2E shared step again of PR 16 (from PR #16)
[DeploymentActions] Running action E2E same id, command A of PR 18 (from PR #18)
[DeploymentActions] Running action E2E same id, command B of PR 19 (from PR #19)
[DeploymentActions] Running action E2E flaky post-deploy of PR 20 (from PR #20)
[DeploymentActions] Action E2E flaky post-deploy of PR 20 failed, stopping execution of further actions.
[DeploymentActions] Skipping action E2E shared step of PR 21 (from PR #21): same action as E2E shared step of PR 14 (#14), run once for this deployment
```

The forecast of PI (`action:list --with-status --forecast uat --from-branch integration`):

| Pull Request | Action                | Forecast           | Reason           | Runs once with      |
|--------------|-----------------------|--------------------|------------------|---------------------|
| #14          | `e2e-shared-14`       | runs-at-deployment | deploy-only      | -                   |
| #15          | `e2e-shared-15`       | runs-at-deployment | identical-action | #14 `e2e-shared-14` |
| #16          | `e2e-shared-16`       | runs-at-deployment | identical-action | #14 `e2e-shared-14` |
| #16          | `e2e-between-16`      | runs-at-deployment | deploy-only      | -                   |
| #16          | `e2e-shared-again-16` | runs-at-deployment | deploy-only      | -                   |
| #17          | `e2e-shared-pre-17`   | runs-at-deployment | deploy-only      | -                   |
| #18          | `e2e-same-id`         | runs-at-deployment | deploy-only      | -                   |
| #19          | `e2e-same-id`         | runs-at-deployment | deploy-only      | -                   |
| #20          | `e2e-flaky-20`        | runs-at-deployment | deploy-only      | -                   |
| #21          | `e2e-shared-21`       | runs-at-deployment | identical-action | #14 `e2e-shared-14` |

What a reviewer reads on #15: ✅ in the uat column of the status table, and in the "Results by org"
table of the action details, the note `Not run twice: the identical action "E2E shared step of PR 14"
of #14 ran earlier in the same run.` On #23 the note says `of the branch or project config`.

Seen without an assertion: the full merge of uat into preprod of group g6 (38 Pull Requests in its
scope, merge order) ran the shared step once for #14 and logged the copy line for #15, #16, #21 and
#23, so the copies of three separate promotions merged as one deployment.

___

## What the run found

### Product

No defect in the identical actions: every check passed on its first run, and again on the replay.
Three observations, left as they are:

1. **The "Backpromotes" comment writes a copy as done without saying who did the work.** Its action
   rows have no note field, so #15 shows `done` for its shared step, while its Deployment Actions
   comment says the action of #14 did it. Adding a note there means a new field in the hidden JSON of
   that comment: a decision for the next change, not a defect.
2. **A validation job logs the copy line with "run once for this deployment"** (I10). A validation is
   a check deployment, so it reads fine.
3. **`actions.run` of a backpromote result holds `e2e-same-id` twice** when two Pull Requests reuse one
   id. `actions.byKey` tells them apart, as the command documentation says.

### Extension

- `BackpromoteAction.key` was described as `<Pull Request>:<id>` in `backpromotePanelUtils.ts`, while
  the CLI sends `<Pull Request>:<pre|post>:<id>`. Comment only, fixed in `ad776302`.

### Test script defects, fixed

1. **The flag-off A/B could run with the feature on.** `ab-run*.sh` turned the flag off with
   `sed 's/^enablePromotionBranches: true$/.../'`. Each pass checks out a merge ref fresh, and with
   `core.autocrlf=true` git writes the file with CRLF, which `true$` never matches: the "off" pass then
   ran with the feature on, and the comparison proved nothing about a project that does not use it.
   The four scripts now match the line with or without its `\r` and stop when the flag is not `false`
   afterwards. This run's passes were off: the validation of the `uat -> preprod` Pull Request #66
   lists the promotions #50, #59, #61, #64 without opening them into their stories.
2. **A validation started right after its Pull Request was opened found no merge ref** (check 38,
   exit 1 with no job log at all). `e2e_check` now retries the fetch for a minute and writes the reason
   in the job log. Check 38 replayed with it: warning, scope #28 alone.
3. **The comment audit flagged the `dev-sandboxes` column** (2 findings on #48). The product leaves the
   tries of `action:run --dev-org` out of the pending checkboxes on purpose (#2268: information for
   their author, confirmed per sandbox in the Backpromotes comment). The auditor now skips that column.
4. **Variable names shared between sections.** Section 6sexies used `ST` and `P7`, which
   `promotion-edge.sh` also writes to `promo-vars.sh` (g5 and g3): renamed `SW` and `PI` before the
   first run. A wrapper of mine kept a path in `SP`, which `promo-vars.sh` exports as a story number,
   and lost one relaunch: noted in the runbook traps.

### Coverage added to section 6sexies

- **I8**: a backpromote run of the window, not only its plan: `actions.byKey`, the counter file and
  the Backpromotes rows of the copies.
- **I9**: the same action in the branch config and in a Pull Request; the config written twice.
- **I10**: the same action with context `all`, run by the validation job of the promotion.
- **W9** (section 6quinquies): two stories with the same action, through real GitHub Actions jobs.

___

## Real CI workflows (section 6quinquies, `-32`)

19 checks, all OK on the first run. The workflows are the templates of `defaults/ci`, with a step
that clones `feat/identical-deployment-actions`, builds it and links it with `sf plugins link`.

| Check | Result                                                                                                                                                                                                                                                                                                                                                                                                      |
|-------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| W0    | the jobs run `sfdx-hardis (link) /tmp/sfdx-hardis`                                                                                                                                                                                                                                                                                                                                                          |
| W1    | the validation of C1 #1 stops on its pending pre-deployment manual action; the comment says why and shows its checkbox                                                                                                                                                                                                                                                                                      |
| W2    | the checkbox ticked through the API, Re-run all jobs: recorded as done, green                                                                                                                                                                                                                                                                                                                               |
| W3    | C2 #3, a GitHub draft with no "draft" in its title, is only warned                                                                                                                                                                                                                                                                                                                                          |
| W4    | the deployment job fails on the flaky command and stops the next ones; statuses read back                                                                                                                                                                                                                                                                                                                   |
| W5    | the promotion #5 (C1, C3) stops in validation until the manual action is done in uat; the forecast says waiting, after the merge, at deployment                                                                                                                                                                                                                                                             |
| W6    | `set-status --org-branch uat`, the re-run passes, the forecast says done                                                                                                                                                                                                                                                                                                                                    |
| W7    | the deployment of the promotion runs the commands with the fix that travelled with it                                                                                                                                                                                                                                                                                                                       |
| W8    | a workflow without the `safe.directory` line: the job stops and names the line to add                                                                                                                                                                                                                                                                                                                       |
| W9    | new: C5 #7 and C6 #8 carry the same action. The merge of #8 into integration is a job of its own and runs its step (W9a). The deployment of the promotion #9 to uat (run 37178211367) runs it for #7 and logs `Skipping action E2E shared step of PR 8 (from PR #8): same action as E2E shared step of PR 7 (#7), run once for this deployment`; #8 is `success` in uat with the "Not run twice" note (W9b) |

___

## Backpromote (Beta), section 6bis (`-31`)

63 checks, all OK on the first run: B0 to B16 and C1 to C4, from the refused orgs and parent branch to
the refreshed sandbox, the scan limit and the reset. B17 (the terminal prompts) is not scriptable and
was not answered by hand.

___

## Timings

GitHub promotion run and backpromote: compiled CLI (`bin/run.js`), one run at a time, so the numbers
mean something this time. The CI section and the GitLab pass overlapped and are not timed.

| Kind            | Calls | Median (s) | Worst (s) | Worst call               |
|-----------------|-------|------------|-----------|--------------------------|
| check           | 27    | 50.8       | 81.8      | `edge-full-merge`        |
| deploy          | 22    | 57.3       | 78.2      | `deploy-integration-pr3` |
| promote         | 25    | 15.4       | 18.5      | `edge-sync-merge`        |
| list-candidates | 4     | 11.4       | 11.4      | `edge-octopus`           |
| release-notes   | 2     | 18.5       | 18.5      | `release-notes`          |

| Backpromote call | Calls | Median (s) | Worst (s) | Worst call       |
|------------------|-------|------------|-----------|------------------|
| plan             | 16    | 17.0       | 37.6      | `bp-plan-s8`     |
| run              | 16    | 34.7       | 57.9      | `bp-run-refresh` |
| prepare          | 1     | 18.6       | 18.6      | `bp-prepare`     |

A backpromote call starts with 6.3 seconds of startup (median of 33 calls), then the deployment
(median 11.2 s), the comparison (9.0 s) and sfdx-git-delta (up to 11.1 s) dominate.

___

## What this run did not cover

- **Azure DevOps and Bitbucket.** The Azure DevOps token of `.env` answers 401 (expired), and
  Bitbucket still needs a new token (its only access token is scoped to a repository that no longer
  exists).
- **The VS Code panels are not clicked.** The "identical" rows of the Deployment Actions tab and the
  "Done by #N" pills of the Backpromote panel read the JSON this run asserts (`identicalTo`,
  `actions.byKey`), and are covered by the extension unit tests.
- **Identical copies of custom function actions with outputs**, a copy feeding
  `${{ actions.<id>.outputs.<name> }}`, and identical actions with a `customUsername`: unit tests only.
- **The interactive prompts**: backpromote B17, `action:run --select-org` and
  `action:set-status --select-org`.
- The four pipeline levels share one Salesforce org, so deployment action state is keyed by org
  **branch**, not by distinct orgs.

## Suites

- sfdx-hardis: the CI of #2277 on `4987e4a6f` (tests and MegaLinter) is green. Not rerun locally: this
  run changed no product code.
- vscode-sfdx-hardis: the CI of #546 on `54e61e23` is green; `ad776302` changes one comment and
  compiles.
