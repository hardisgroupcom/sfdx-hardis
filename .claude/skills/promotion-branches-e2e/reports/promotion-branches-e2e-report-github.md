# Promotion branches, deployment actions and backpromote: end to end test on GitHub

**Date:** 2026-10-07 (supersedes the run of 2026-10-04)
**Why this run:** prove the published beta `8.14.1-beta202610062235.0` (pre-patch of 8.14.0, with #2305
and #2306) end to end, CI jobs included, and, at the user's request, check that the four tabs of the
DevOps Pipeline single Pull Request window (Deployment Actions, Validation, Code Quality, Deployment)
show what the Pull Request comments say, merged Pull Requests included. That new check (section 4ter)
found a real defect, fixed by sfdx-hardis #2307.

**Repositories under test (private, created empty for this run):**

- promotion branches, deployment actions and identical actions, sections 4, 4ter, 5bis, 5ter, 6,
  6quater, 6sexies and 7bis: `nvuillam/sfdx-hardis-promo-e2e-33`
- backpromote (Beta), section 6bis: `nvuillam/sfdx-hardis-promo-e2e-34`
- real CI workflows on the **beta Docker image**, section 6quinquies: `nvuillam/sfdx-hardis-promo-e2e-35`
- real CI workflows again, with the fix branch of #2307 linked, to prove it: `nvuillam/sfdx-hardis-promo-e2e-36`

**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (orgfarm Developer Edition, Dev Hub).
Scratch orgs `promo-e2e-dev` (also `DEV_ORG` of 6quater group D and 6sexies I7 and I8) and
`promo-e2e-dev2`, created again for three days at the start: the previous ones expired that day.
No other org was touched.
**sfdx-hardis:** `main` at `971ac8925`, which is the `gitHead` of the npm beta
`8.14.1-beta202610062235.0`, compiled, through `bin/run.js`. CI jobs of -35 in
`ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:beta`, whose config holds
`SFDX_HARDIS_VERSION=8.14.1-beta202610062235.0`, and whose `sf plugins` printed that version (no link).
**vscode-sfdx-hardis:** `main` at `7dc49a99` (v8.11.0), compiled with `yarn compile`.

___

## Counts

| Section                                                                                   | Checks                            | OK                   | FAIL                     |
|-------------------------------------------------------------------------------------------|-----------------------------------|----------------------|--------------------------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline       | 42                                | 42                   | 0                        |
| 6: edge cases, groups g1 to g6                                                            | 47                                | 47                   | 0                        |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                        | 21                                | 21                   | 0                        |
| 6sexies: identical actions, I1 to I10                                                     | 24                                | 24                   | 0                        |
| 6bis: backpromote B0 to B16, C1 to C4                                                     | 63                                | 63                   | 0                        |
| 6quinquies on the beta image (-35), W0 to W9                                              | 19                                | 19 (W0 see below)    | 0                        |
| 6quinquies with the #2307 branch linked (-36), W0 to W9                                   | 19                                | 19                   | 0                        |
| 4ter: single Pull Request window, simulated jobs (-33, -34)                               | 47 + 11 Pull Requests             | 58                   | 0                        |
| 4ter: single Pull Request window, real CI jobs, beta (-35)                                | 7 Pull Requests                   | see "Defect"         | every comment hidden     |
| 4ter: single Pull Request window, real CI jobs, #2307 build (-36)                         | 7 Pull Requests                   | 7                    | 0                        |
| 5bis: comment audit of the real CI comments with #2307 (-36)                              | 265 checks over 9 Pull Requests   | all                  | 0                        |
| 5bis: Pull Request comment audit (-33)                                                    | 1108 checks over 53 Pull Requests | all                  | 0                        |
| 5ter: action state read from the provider (#1)                                            | 1                                 | 1                    | 0                        |
| 7bis: single place in the diagram                                                         | 1                                 | 1                    | 0                        |
| 7ter: flag-off A/B                                                                        | not run                           |                      |                          |

W0 on -35 first said FAIL: the new image mode asserted `sfdx-hardis 8.14.1-beta...` while the log has
color codes between the name and the version. The job did run
`sfdx-hardis 8.14.1-beta202610062235.0 (8.14.1-beta202610062235.0)` of the beta image, not linked: the
pattern now allows them, and W0 counts as OK.

___

## Defect found: GitHub Actions comments invisible to the Pull Request window (#2307)

The new section 4ter makes the calls the extension makes for the single Pull Request window
(`sf hardis:project:action:list --with-status --with-workflows`, provider token only, and the
extension's own `completePullRequestsWithActions`) and compares them with the comments GitHub holds.

On the simulated jobs (-33) everything matched. On the real GitHub Actions jobs (-35), **no**
validation or deployment comment was ever listed in the window, merged or not:

| Pull Request (-35)     | Comments on GitHub                     | Validation / Deployment tabs, beta | Same, #2307 branch                     |
|------------------------|----------------------------------------|------------------------------------|----------------------------------------|
| #1 story, merged       | validation valid, deployment invalid   | nothing                            | validation valid, deployment invalid   |
| #5 promotion, merged   | validation valid, deployment valid     | nothing                            | validation valid, deployment valid     |

Cause: the comment kind is read from its message key, which holds the CI job name, and a GitHub
Actions workflow is named `Simulate Deployment (sfdx-hardis)`. `prCommentNav.ts` read the key with
`(\S+) -->`, which never matches a name with spaces. The same reader builds the navigation line
between the comments, which was empty on every real GitHub comment (`<!-- sfdx-hardis nav-start --><!-- sfdx-hardis nav-end -->`).
The simulators ran with no job name (`job` in the key), which is why no previous run saw it.

- Fix: hardisgroupcom/sfdx-hardis#2307, the key runs to the end of the marker; unit tests with a
  GitHub Actions job name fail before the fix. Its CI is green.
- Proof in real CI: -36 ran section 6quinquies with the #2307 branch linked into the jobs. The
  navigation lines of the comments are filled again, and the window check passes on -36 with the
  #2307 build.
- The harness was blind to it in three places, all fixed: the simulators now set `GITHUB_WORKFLOW`
  (and `CI_JOB_NAME` on GitLab) to the names of the templates, and the comment audit and the window
  check read the key the corrected way. The audit of -35 now reports the empty navigation lines.

Nothing in the extension needs to change: it shows what the CLI returns. Azure DevOps job display
names can carry spaces too; the same fix covers them, untested live (no Azure token, see below).

___

## Single Pull Request window, section 4ter

| Repository | Pull Requests | Result                                                                                                                                                                                                                         |
|------------|---------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| -33        | 47            | 47 OK after one checker fix (a `⬜` cell, "not run in this org branch yet", has no status: correct). 19 show validation and deployment, 2 validation only, 1 a failed deployment, 24 have no comment because the scripts merge them without a job |
| -34        | 11            | 11 OK: backpromote stories, merged into integration, never deployed to a major branch                                                                                                                                          |
| -35        | 7             | the comments of real jobs never reach the window: the #2307 defect                                                                                                                                                             |
| -36        | 7             | 7 OK with the #2307 build: every comment real jobs wrote is listed with its status, the open Renovate Pull Request included                                                                                                     |

For every Pull Request the action list of the window equals the ids of its actions file, and every
done or failed cell of the "Status by org branch" table is a status of the window. Code Quality is
never exercised: no simulator and no CI section posts a MegaLinter comment.

Observation, not a defect: `PURGE_FLOW_VERSIONS` added from the description of #3 shows `⬜` in uat,
preprod and main in the comment of #3 although the promotions carrying #3 ran it (`inherited`, check
16a): an action added from a Pull Request description is recorded on the Pull Request whose job added
it. The window shows the same thing as the comment.

___

## What the run proved about the beta

- #2305 (pending manual actions no longer block the validation by default): 6quater A1 and W1 turn
  `failValidationOnPendingManualActions` on, and the gate still stops when asked to. The default
  (off) is not asserted on its own: no check validates a pending pre-deployment manual action with
  the setting left out.
- #2306 (Flow deletion failures after the deployment no longer fail it): not exercised, the stories
  carry no Flow deletion.
- The beta Docker image runs the whole CI section (W1 to W9) as the linked branch did on 2026-10-04.

___

## What this run did not cover

- **7ter, the flag-off A/B**: the code under test is `main` itself, so there is no branch to compare
  with `origin/main`.
- **Azure DevOps**: the PAT of `.env` still answers 401. **Bitbucket**: no token. Neither ran.
- **Code Quality tab**: no MegaLinter comment is posted anywhere in the run.
- **The rendering of the window**: the checks stop at the data the webview receives; the tabs are
  covered by the extension's unit tests. The window of a promotion or major-to-major Pull Request
  assembles its actions from the stories it carries, and is not compared.
- **B17**, the terminal prompts of backpromote, and the VS Code Backpromote panel, not clicked.
- **Timings**: -35 and -36 ran on GitHub's runners while other sections ran locally, so local timings
  of -34 overlap with the CI section's local calls.

Known gaps carried over: the four levels share one org, so action state is keyed by org branch;
identical copies of custom function actions with outputs, and actions with a `customUsername`, are
unit tested only.

___

## Timings (local, `bin/run.js`)

| Kind            | Calls | Median (s) | Worst (s) | Worst call               |
|-----------------|-------|------------|-----------|--------------------------|
| check           | 27    | 34.0       | 73.3      | `check-pr1`              |
| deploy          | 22    | 37.3       | 111.4     | `deploy-integration-pr3` |
| promote         | 25    | 15.5       | 40.2      | `promotion-integration-uat` |
| list-candidates | 4     | 10.4       | 11.4      | `edge-octopus-promotion-side` |
| backpromote plan| 16    | 12.6       | 19.0      | `bp-plan-diff`           |
| backpromote run | 16    | 20.5       | 37.0      | `bp-run-refresh`         |

Section 4 took 31 minutes, section 6 13, 6quater 7, 6sexies 10, backpromote 14 (setup excluded),
each CI section about 40 minutes on the image (no link step) and 75 with the link step.
