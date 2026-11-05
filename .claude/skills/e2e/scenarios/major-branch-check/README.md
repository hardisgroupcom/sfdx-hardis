# Major branch deployment check: end to end test

Proves, in real CI jobs running sfdx-hardis built from the branch under test (GitHub Actions, GitLab
CI, Azure Pipelines or Bitbucket Pipelines), that `sf hardis:project:deploy:smart --check
--major-branch-check` tells whether a major branch can still be deployed to its own org, and that the
DevOps Pipeline of vscode-sfdx-hardis shows that result on the branch node. About 40 minutes per
provider, most of it waiting for the CI jobs (each one clones, builds and links the branch under test).

What it proves:

- The custom field `Account.MBC_Drift__c` is created in the org directly, never in git, and a story
  brings the Apex class `MBCDrift` that reads it to integration. Then the org drifts: the class and the
  field are deleted from the org. The check of integration redeploys the class, which no longer
  compiles since the field exists nowhere, so it fails; the checks of uat and main (no class) pass.
- A check is a full simulation, even with `useDeltaDeployment` and
  `enableDeltaDeploymentBetweenMajorBranches` on. It runs no deployment action (the
  `commandsPreDeploy` marker never prints) and posts no Pull Request comment: the comments of the last
  Pull Request deployed to integration stay exactly as they were.
- The DevOps Pipeline shows the check on the branch node (running, failed, success), never on the
  deployment arrow, which keeps the status of the last deployment job. The check links open the git
  provider.
- A check goes stale when the branch is deployed after it started (`deployedAfter`), or when it is
  older than `majorBranchDeploymentCheckValidityHours` (`age`).
- With `enableMajorBranchDeploymentCheck: false` the pipeline shows no check at all.
- `--major-branch-check` refuses to run on a branch that has no branch config file.

The feature: `sf hardis:project:deploy:smart --major-branch-check` (`src/commands/hardis/project/deploy/smart.ts`),
the config keys `enableMajorBranchDeploymentCheck` and `majorBranchDeploymentCheckValidityHours`, the
default CI templates in `defaults/ci` (GitHub `check-major-branch-deploy.yml`, GitLab job
`check_deploy_to_current_branch_org`, Azure `azure-pipelines-major-branch-check.yml`, Bitbucket custom
pipeline `check-major-branch-deployment`), and in vscode-sfdx-hardis the `majorBranchCheck` of each
org in `PipelineDataProvider` and the branch node classes of the mermaid builder.

## What this scenario contains

| File                           | Use                                                                                                                                                                                                                                                                                                  |
|--------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `scripts/mbc-e2e.sh`           | The run: steps `org repo deploy drift check-running assert-ci assert-pipeline stale-deployed stale-age off not-major report`, one assertion per line of `$LOGS/results.tsv`, the report in `$LOGS/report.md`.                                                                                        |
| `scripts/mbc-build-project.sh` | The sample project: one custom label, the branch files of `integration -> uat -> main`, the check on, delta deployments on, a `commandsPreDeploy` marker; the branch `feature/mbc-drift` with only the Apex class `MBCDrift`, which reads `Account.MBC_Drift__c` (a field of the org, in no branch). |
| `reports/`                     | One report per run and provider (copy `$LOGS/report.md` there, named `<date>-<run>.md`).                                                                                                                                                                                                             |

It reuses the CI harness of the [promotion-branches scenario](../promotion-branches/README.md), never
copied: `env-lib.sh` (settings), `ci-workflows-prepare.cjs` (the CI files of the provider, the check
job included, with the step that builds and links the branch under test and the
`SFDX_AUTH_URL_<BRANCH>` logins), `ci-provider-<provider>.sh` (create the remote, wait for a job, and
for this scenario `ci_prepare_major_branch_check`, `start_major_branch_check`,
`ci_major_branch_check_state`, `ci_wait_major_branch_check`, `ci_pr_comments_ids`),
`promotion-provider.sh` (open and merge a Pull Request, the provider token), `section-lib.sh`
(`assert_log`) and `check-pipeline.cjs` (the DevOps Pipeline, with the `deployArrows`,
`branchChecks`, `nodeClasses`, `checkLinks` expectations and `--now`).

## Prerequisites

- Those of the promotion-branches real CI section for the provider (`preflight.sh --provider <p>`
  passes): `gh auth login`, or the GitLab, Azure DevOps or Bitbucket settings of `.env`.
- A Dev Hub with one free scratch org (`DEVHUB`), or `MBC_ORG` naming a throwaway org: the run creates
  `Account.MBC_Drift__c` in it and deletes it.
- The branch under test pushed to `hardisgroupcom/sfdx-hardis` (the CI jobs clone it).
- vscode-sfdx-hardis cloned next to this working copy (`EXT`), on the branch of the feature, compiled:
  `cd ../vscode-sfdx-hardis && yarn compile`.
- `node bin/dev.js` works in this working copy (`yarn install` done): the `not-major` step runs it.

## Run it

```sh
PROVIDER=github bash .claude/skills/e2e/scenarios/major-branch-check/scripts/mbc-e2e.sh
PROVIDER=gitlab bash .claude/skills/e2e/scenarios/major-branch-check/scripts/mbc-e2e.sh
# replay steps of a run (its settings are kept in $LOGS/run.env and $LOGS/ci-vars.sh)
PROVIDER=github RUN=mbc-e2e-github-20261105-1400 STEPS="assert-pipeline stale-age report" bash .../mbc-e2e.sh
```

Run it in the background and watch the `[FAIL]` lines. A replayed check adds a line; the report keeps
the last one of each id. Settings: `PROVIDER` (default `github`), `DEVHUB` (default `DevHub`),
`MBC_ORG` (default a new scratch org `mbc-e2e-<provider>-<date>`), `SFDX_HARDIS_BRANCH` (default: the
current branch), `RUN` (folders `<OS temp>/<run>` and `<run>-logs`), `MBC_GH_REUSE_SECONDS` (GitHub,
default 600), and the provider settings of `../promotion-branches/reference/env.example`.

## What each step proves

| Step              | Proves                                                                                                                                                                                                                                                                                                                                                                                                        |
|-------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `org`             | The scratch org exists (created for 2 days when missing); its auth URL logs integration, uat and main in.                                                                                                                                                                                                                                                                                                     |
| `repo`            | The sample project, the CI files of the branch under test with the check job of the provider, a private repository with `main integration uat`, the logins. Azure: the pipeline `Check Major Branch Deployment` exists, with its logins.                                                                                                                                                                      |
| `deploy`          | `Account.MBC_Drift__c` created in the org from a folder outside the repository (`sf project deploy start --source-dir`). Pull Request N (the class `MBCDrift` alone) into integration validated then merged, the deployment job succeeds because the org holds the field; both print `MBC_PRE_DEPLOY_MARKER` (the marker can be seen when the command runs). The comments of N, ids and bodies, are recorded. |
| `drift`           | `MBCDrift` then `MBC_Drift__c` deleted from the org by destructive deployments, git untouched. A local dry run proves a full deployment of integration now fails (`MBCDrift` does not compile without `MBC_Drift__c`) and the one of uat still passes, before any CI minute is spent.                                                                                                                         |
| `check-running`   | The checks of integration and uat start the way a schedule starts them. While integration runs, the pipeline shows its check `running` (or `pending`), not stale, class `gitBranchCheckRunning`, and its deployment arrow still `success`.                                                                                                                                                                    |
| `assert-ci`       | The check of integration fails and its log names `MBC_Drift__c`; the one of uat succeeds. Each log has the four messages (full simulation of the branch, full deployment mode, deployment actions skipped, no Pull Request comment) and never `MBC_PRE_DEPLOY_MARKER`. The comments of N are unchanged.                                                                                                       |
| `assert-pipeline` | integration `failed`, not stale, class `gitBranchCheckFailed`; uat `success`, class `gitBranchCheckSuccess`; main no check and class `gitMain` (GitHub: one run checks main too, so `success`); the arrow of integration still `success`; every check link is an http(s) URL of the repository host.                                                                                                          |
| `stale-deployed`  | A Pull Request merged into uat and deployed: the check of uat is stale with `staleReason` `deployedAfter`, class `gitBranchCheckSuccessStale`.                                                                                                                                                                                                                                                                |
| `stale-age`       | `check-pipeline.cjs --now` at the end of the integration check plus 25 hours (validity 24): stale with `staleReason` `age`, class `gitBranchCheckFailedStale`.                                                                                                                                                                                                                                                |
| `off`             | `enableMajorBranchDeploymentCheck: false`: no check on any branch, classes `gitMajor` / `gitMain`, the arrow of integration still `success`.                                                                                                                                                                                                                                                                  |
| `not-major`       | `deploy:smart --check --major-branch-check` from a feature branch fails with "runs only on a major branch: feature/mbc-not-major has no branch config file in config/branches."                                                                                                                                                                                                                               |
| `report`          | `$LOGS/report.md`, with how each check was started and the CI jobs table.                                                                                                                                                                                                                                                                                                                                     |

A check that cannot run says SKIP with the reason, never OK.

## Traps

- GitHub runs scheduled workflows on the default branch only, at their own time: the test starts the
  check with `workflow_dispatch`. The extension finds the check by its job name (`Check Major Branch
  Deployment (<branch>)`), not by its event. The cron of the template (1am UTC) is kept: a run around
  that hour can see a scheduled run become the latest check.
- The GitHub matrix is read from `config/branches` of the default branch: the branch files must be on
  `main` (the base project is pushed there first). One dispatch checks every major branch, main
  included, so on GitHub main has a check too (`CI_MAJOR_BRANCH_CHECK_ALL=yes`) and the expectations
  say so. A second start within `MBC_GH_REUSE_SECONDS` reuses the run instead of dispatching again.
- GitLab: only a played pipeline schedule gives a pipeline whose source is `schedule`. "Run pipeline"
  gives `web`, which also runs `deploy_to_org`. The run creates one schedule per branch (cron once a
  year, never fires during a run) and plays it.
- GitLab: the scheduled pipeline is on the latest commit of the branch, like its deployment job. The
  `deployArrows` expectation is what proves the arrow ignores it.
- Azure: the extension finds the check by the pipeline name `Check Major Branch Deployment`. Names are
  unique per folder, so each run creates it in a folder named after its repository. The build is queued
  through the REST API with reason `schedule`; when the API refuses or ignores it, the build is queued
  as a manual one and "How each check was started" in the report says so.
- Bitbucket: the custom pipeline has no simulator. Once the build minutes are used up, the checks are
  SKIP, never simulated (a simulator would deploy, not check).
- The CI jobs build sfdx-hardis from GitHub: push the branch first, or the jobs test an older commit.
- `check-pipeline.cjs` loads the compiled extension (`out/`): run `yarn compile` in vscode-sfdx-hardis,
  on its branch, before the pipeline steps.
- Salesforce refuses to delete a field an Apex class uses: the drift deletes the class first, then the
  field.
- `MBC_Drift__c` must stay out of git, in every branch and in `manifest/package.xml`. Salesforce
  renames a deleted custom field (`MBC_Drift_del__c`), so its name is free again: a full deployment
  that carries the field would create it back, the class would compile, and the check of integration
  would pass. Created in the org only, once deleted it exists nowhere and the class cannot compile.
  The `drift` step proves it with a dry run before any CI minute: if `DRIFT-INTEGRATION` says a full
  deployment still passes, something brought the field back (git, or a field left in the org).
- The three branches share one org: their checks queue in Salesforce, one validation at a time.
- The pre-deployment marker is built at run time (`MBC_PRE""_DEPLOY_MARKER`), so the text of the
  command never satisfies the assertion, and has `runOnlyOnceByOrg: false`, or it would be skipped as
  already run and its absence would prove nothing.
- Staleness uses the current time: `stale-age` passes `--now`, which stubs `Date.now()` and
  `new Date()` before the extension loads. It reads the `finishedAt` of the integration check from the
  `assert-pipeline` dump: replay `assert-pipeline` before `stale-age`.
- `check-running` is SKIP when the check of integration ends before it is seen running. Replay
  `STEPS="check-running assert-ci assert-pipeline"`: it starts new checks.
- The `off` step commits in the local clone only (the extension reads the checkout, a push to main
  would start a deployment job) and undoes the commit right after, so every step can be replayed.
- Azure adds and updates system comments on a Pull Request by itself: the comparison of the comments
  of N reads text comments only.
- Never edit `mbc-e2e.sh` while it runs: bash reads the script as it goes. Fix it after the run, then
  replay the steps with `RUN=<run> STEPS=...`.

## Cleanup

Once the report is copied to `reports/`, unless the user wants to look at them:

- the repository: `gh repo delete <repo> --yes`; GitLab `curl -X DELETE -H "PRIVATE-TOKEN: $GL_TOKEN"
  $GL_HOST/api/v4/projects/<id>`; Azure DevOps the repository, its three pipelines and the folder named
  after it; Bitbucket `DELETE /2.0/repositories/<workspace>/<repo>`;
- the scratch org: `sf org delete scratch -o <MBC_ORG> --no-prompt`.
