# Promotion branches, deployment actions and backpromote: end to end test on GitLab

**Date:** 2026-10-07 (supersedes the run of 2026-10-04)
**Why this run:** prove the published beta `8.14.1-beta202610062235.0`, and run the new single Pull
Request window check (section 4ter) on GitLab. The GitHub report of the same day holds the defect
that check found (sfdx-hardis #2307, GitHub Actions job names with spaces) and the details of the
window check.

**Projects under test (private, created empty for this run, on `gitlab.hardis-group.com`):**

- promotion branches, deployment actions and identical actions, sections 4, 4ter, 5bis, 6, 6quater,
  6sexies and 7bis: `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-12` (id 4494)
- backpromote (Beta), section 6bis: `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-13` (id 4495)

**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (orgfarm Developer Edition),
shared with GitHub, and the same two scratch orgs (`promo-e2e-dev`, `promo-e2e-dev2`).
**sfdx-hardis:** `main` at `971ac8925` = npm beta `8.14.1-beta202610062235.0`, compiled, through
`bin/run.js`. No product change during the run.
**vscode-sfdx-hardis:** `main` at `7dc49a99` (v8.11.0), compiled.

Every job is a real CLI call against the org with the GitLab CI variables set. Merge requests are
merged with a merge commit, never squashed. Sections 3, 4, 6, 6quater and 6sexies ran the same
scripts as GitHub, with `PROVIDER=gitlab`.

**Overlap:** the GitLab pass ran while the real CI section of GitHub (`-36`) was running in GitHub
Actions against the same org. The org queues the deployments; the timings are not clean.

___

## Counts

| Section                                                                             | Checks                             | OK  | FAIL |
|-------------------------------------------------------------------------------------|------------------------------------|-----|------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42                                 | 42  | 0    |
| 6: edge cases, groups g1 to g6                                                      | 47                                 | 47  | 0    |
| 6quater: gate, recovery, set-status ahead, forecast, developer org                  | 21                                 | 21  | 0    |
| 6sexies: identical actions, I1 to I10                                               | 24                                 | 24  | 0    |
| 6bis: backpromote B0 to B16, C1 to C4                                               | 63                                 | 63  | 0    |
| 4ter: single Pull Request window (gl-12, gl-13)                                     | 47 + 11 merge requests             | 58  | 0    |
| 5bis: Pull Request comment audit                                                    | 1108 checks over 53 merge requests | all | 0    |
| 7bis: single place in the diagram                                                   | 1                                  | 1   | 0    |
| 7ter: flag-off A/B                                                                  | not run                            |     |      |

No failure, first time through.

___

## Single Pull Request window, section 4ter

The window check ran with only `CI_SFDX_HARDIS_GITLAB_TOKEN` in the environment, which is all the
extension passes: no `CI_PROJECT_ID`, no `CI_SERVER_URL`. The CLI found the project from the git
remote, and every validation and deployment note of the 47 merge requests of gl-12 reached the
window with its status: 19 with both, 2 with a validation only, 1 with a failed deployment, 24
merged by the scripts without a job. The 11 merge requests of gl-13 are backpromote stories, never
deployed to a major branch.

GitLab is not hit by #2307 in practice: the job names of the `.gitlab-ci.yml` template have no
spaces (`check_deploy_to_target_branch_org`, `deploy_to_org`). A project naming its jobs with
spaces would have been, and #2307 covers it. The GitLab simulators ran with the name `job`; they
now set `CI_JOB_NAME` to the template's names.

___

## Timings (local, `bin/run.js`)

| Kind            | Calls | Median (s) | Worst (s) | Worst call               |
|-----------------|-------|------------|-----------|--------------------------|
| check           | 27    | 24.9       | 35.6      | `edge-full-merge`        |
| deploy          | 22    | 24.8       | 35.5      | `deploy-integration-pr3` |
| promote         | 25    | 11.7       | 18.4      | `edge-conflict-kept`     |
| list-candidates | 4     | 9.4        | 9.5       | `edge-back-merge`        |
| release-notes   | 2     | 10.5       | 10.5      | `release-notes-all`      |

Section 4 took 20 minutes, section 6 11, 6quater 6, 6sexies 9, backpromote about 25 with its setup.
Faster than the GitHub pass of the same night, which ran first while the workstation was busier.

___

## What this run did not cover

- **7ter, the flag-off A/B**: the code under test is `main` itself.
- **Real GitLab CI jobs**: there is no GitLab counterpart of section 6quinquies; every job is a
  simulator. The template job names are now used by the simulators, so the message keys are the
  ones a real job writes.
- **Code Quality tab**: no MegaLinter note is posted.
- **B17** and the VS Code Backpromote panel, not clicked.
- Azure DevOps (PAT of `.env` answers 401) and Bitbucket (no token) did not run.
