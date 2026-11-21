# Deployment simulation cancelled with its CI job: end to end test

Proves, in real CI jobs running sfdx-hardis built from the branch under test (GitHub Actions, GitLab
CI or Azure Pipelines), that a check job cancelled while its deployment simulation runs also cancels
that simulation in the Salesforce org, with `sf hardis:project:deploy:cancel` in the cancellation
hook of the template, and nothing else: not the simulation of another Pull Request, not a real
deployment. About 1h15 per provider, most of it waiting for Apex tests.

What it proves:

- A new commit on a Pull Request cancels the check job of the previous commit (the provider does
  it: GitHub concurrency, GitLab auto-cancel of redundant pipelines), the hook of that job cancels
  its simulation, the org shows the DeployRequest `Canceled`, and the simulation of the new commit
  starts at once instead of waiting for the old one to end.
- On GitLab, the `after_script` path works: it runs in a new container, sees `CI_JOB_STATUS=canceled`,
  logs in again and cancels the simulation.
- A check job cancelled by hand (the Cancel button, through the provider API) cancels its own
  simulation and leaves the simulation of another Pull Request waiting in the same org: that one
  then runs and succeeds.
- Two merges into a major branch a few seconds apart: the deployment of the first one is never
  cancelled, both deploy one after the other in merge order, and both run their pre and
  post-deployment commands. On GitLab the resource group is set to `oldest_first` through the API,
  as the documentation says.
- A simulation that fails keeps its job id file, and a later cancel logs that it is already
  completed.
- A check job killed by its timeout: what happens to its simulation, per provider. This is
  recorded as found, OK when the simulation is cancelled, FAIL otherwise (a GitLab job killed by
  its timeout may end `failed`, not `canceled`).

The feature: `sf hardis:project:deploy:cancel` (`src/commands/hardis/project/deploy/cancel.ts`,
`src/common/utils/deployCancelUtils.ts`), the job id watcher started by `deploy:smart --check` in CI
(`src/common/utils/deployUtils.ts`), and the default CI templates in `defaults/ci`: GitHub
`check-deploy.yml` (step `if: cancelled()`) and `process-deploy.yml` (`cancel-in-progress: false`),
GitLab `.gitlab-ci.yml` (`.cancel_deployment_simulation_on_job_cancel`, `resource_group` of
`deploy_to_org`), Azure `azure-pipelines-checks.yml` (step `condition: canceled()`). Jenkins is not
covered (no Jenkins in the shared harness), and Bitbucket runs no script when a step is stopped.

## What this scenario contains

| File                          | Use                                                                                                                                                                                                  |
|-------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `scripts/dc-e2e.sh`           | The run: steps `org repo new-commit other-pr deploy-order deploy-order-check timeout failed-sim report`, one assertion per line of `$LOGS/results.tsv`, the report in `$LOGS/report.md`, the DeployRequest records of each step. |
| `scripts/dc-build-project.sh` | The sample project: 8 Apex test classes of 8 methods burning about 7 seconds of CPU each (about 7 minutes of tests per simulation), `testLevel: RunLocalTests`, a pre and a post-deployment marker. |
| `reports/`                    | One report per run and provider (copy `$LOGS/report.md` there, named `<date>-<run>.md`).                                                                                                           |

It reuses the CI harness of the [promotion-branches scenario](../promotion-branches/README.md),
never copied: `env-lib.sh` (settings), `ci-workflows-prepare.cjs` (the CI files of the provider, with
the step that builds and links the branch under test and the `SFDX_AUTH_URL_<BRANCH>` logins),
`ci-provider-<provider>.sh` (create the remote, wait for a job), `promotion-provider.sh` (open and
merge a Pull Request) and `section-lib.sh` (`assert_log`).

## Prerequisites

- Those of the promotion-branches real CI section for the provider (`preflight.sh --provider <p>`
  passes): `gh auth login`, or the GitLab or Azure DevOps settings of `.env`.
- A Dev Hub with one free scratch org (`DEVHUB`), or `DC_ORG` naming a throwaway org. One org can
  serve the three providers one after the other: each step waits until the org runs nothing.
- The branch under test pushed. For the Pull Request of a contributor, set `SFDX_HARDIS_REPO` to
  their fork (`https://github.com/<login>/sfdx-hardis.git`): the CI jobs clone the branch from it.

## Run it

```sh
PROVIDER=github DC_ORG=<org> bash .claude/skills/e2e/scenarios/deploy-cancel/scripts/dc-e2e.sh
PROVIDER=gitlab DC_ORG=<org> bash .claude/skills/e2e/scenarios/deploy-cancel/scripts/dc-e2e.sh
PROVIDER=azure DC_ORG=<org> bash .claude/skills/e2e/scenarios/deploy-cancel/scripts/dc-e2e.sh
# replay steps of a run (its settings are kept in $LOGS/run.env and $LOGS/ci-vars.sh)
PROVIDER=github RUN=dc-e2e-github-20261121-0140 STEPS="timeout report" bash .../dc-e2e.sh
```

Run one provider at a time, in the background, and watch the `[FAIL]` lines. Settings: `PROVIDER`
(default `github`), `DEVHUB` (default `DevHub`), `DC_ORG` (default a new scratch org),
`SFDX_HARDIS_BRANCH` (default: the current branch), `SFDX_HARDIS_REPO`, `RUN`, `DC_TEST_CLASSES` and
`DC_TEST_METHODS` (default 8 x 8), `DC_PROVIDER_CANCEL_SECONDS` (default 300), `DC_TIMEOUT_MINUTES`
(default: computed by `new-commit`), and the provider settings of
`../promotion-branches/reference/env.example`.

## What each step proves

| Step           | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
|----------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `org`          | The org exists and its `DeployRequest` records can be read with the Tooling API: every later step proves what happened in the org with them.                                                                                                                                                                                                                                                                                                            |
| `repo`         | The sample project, the CI files of the branch under test, whose check job calls `sf hardis:project:deploy:cancel`, a repository with `main integration uat preprod`, the logins.                                                                                                                                                                                                                                                                       |
| `new-commit`   | A story opened into integration; once its simulation X0 runs in the org, a second commit is pushed. The provider cancels the first job (`NC-PROVIDER-CANCEL`), whose log shows the cancel of X0 (`NC-HOOK`, GitLab `NC-GITLAB-AFTER-SCRIPT`), X0 is `Canceled` in the org, and the simulation X1 of the new commit succeeds, started right after X0 ended, X0 having run far less than X1 (`NC-NO-WAIT`). It also measures when a job starts its simulation. |
| `other-pr`     | Story A's simulation XA runs; story B's simulation XB waits behind it in the same org. A's check job is cancelled through the provider API: its log cancels XA and never names XB, XA is `Canceled`, XB then runs and is `Succeeded`, B's job succeeds. Azure: XB is started from the workstation (one free parallel job, B's job would only start after A's).                                                                                       |
| `deploy-order` | Two stories merged into integration about 20 seconds apart. Both deployment jobs succeed, are never cancelled and print the pre and post-deployment markers; the second starts once the first ended; the org holds two deployments `Succeeded`, none `Canceled`. GitLab: `DO-RESOURCE-GROUP` sets `deploy-integration` to `oldest_first`.                                                                                                            |
| `deploy-order-check` | The second deployment job started once the first ended (job times, not run times: a GitHub run waiting for its concurrency group gets its start time when it is created), and the org holds two deployments `Succeeded`, none `Canceled`. Apart from `deploy-order`, so it can be replayed without merging again. |
| `timeout`      | The check job of a story gets a timeout a little after the moment its simulation starts (`new-commit` measured it). The job is killed while the simulation runs; the result says how the job ended, whether the hook ran, what the GitLab `after_script` saw, and the final status of the simulation.                                                                                                                                                   |
| `failed-sim`   | From the workstation (`bin/dev.js`, `CI=true`): a check-only `deploy:smart` of a class that does not compile fails, its job id stays in `.cache/sfdx-hardis/running-deployment-simulation.json` (a failure can be the cancellation of the job, whose hook needs it), the DeployRequest is `Failed`, and a later `deploy:cancel` logs "already completed (Failed): nothing to cancel" and deletes the file. Provider independent: a CI job would need a step of its own after a failed simulation.                                                       |
| `report`       | `$LOGS/report.md`, with the CI jobs and the DeployRequest records of each step.                                                                                                                                                                                                                                                                                                                                                                         |

A check that cannot run says SKIP with the reason, never OK.

## Traps

- The released Docker image does not hold `deploy:cancel` until the release: the jobs must run the
  branch under test. On GitHub and Azure the cancellation step runs in the same job container, where
  the link step already linked it. The GitLab `after_script` runs in a NEW container (Docker
  executor): `ci-workflows-prepare.cjs` keeps the build of the jobs that extend
  `.cancel_deployment_simulation_on_job_cancel` in `$CI_BUILDS_DIR/.e2e-sfdx-hardis-$CI_JOB_ID` (the
  builds volume, which that container sees), and the `after_script` links it again and prints
  `CI_JOB_STATUS`. A line `E2E after_script: no build in ...` means the volume was not shared.
- GitLab cancels the jobs of a previous pipeline only while none of its non-interruptible jobs has
  started. The check jobs of the template are interruptible, so the default "conservative" auto-cancel
  is enough here; the `workflow: auto_cancel: on_new_commit: interruptible` block stays commented. If
  `NC-PROVIDER-CANCEL` fails on GitLab, uncomment that block in the throwaway project.
- Azure has one free parallel job: two check jobs never run at the same time, so `other-pr` starts
  B's simulation from the workstation. When the provider does not cancel the job of the previous
  commit, `NC-PROVIDER-CANCEL` says so and the test cancels it by hand to prove the rest.
- Any other job that simulates in the org takes the place of the simulation a step waits for, and the
  step then reads the wrong DeployRequest (2026-11-21, three times on GitHub). The run removes the
  sources it knows: `renovate.json` disables Renovate (its app opened `renovate/configure` on the new
  repository, whose check job simulated in the org), `check-major-branch-deploy.yml` is removed from
  the GitHub repository (its schedule, 1am UTC, started during the run), and each step first closes
  the Pull Requests of its branches and cancels their check jobs (a job of a closed Pull Request keeps
  running), then waits until the org runs nothing.
- GitLab echoes each command of a job before it runs it, so a pattern that is also in the text of a
  command matches the log even when the command printed nothing: the negative pattern of
  `NC-GITLAB-AFTER-SCRIPT` matches the expanded path (`no build in /`), which only the output holds.
- A GitLab runner whose disk is full fails the job in `yarn install` (ENOSPC) before sfdx-hardis
  starts: `dc_wait_sim` retries it, as `_glci_wait_job` does. The waits use the wall clock: each loop
  runs `sf` queries that take seconds on Windows.
- Each story brings a test class: with `RunLocalTests`, a class no test covers fails the simulation
  with "Average test coverage across all Apex Classes and Triggers is 0%", after the 7 minutes of tests.
- A job cancelled before its simulation started (during the link step, on GitHub) has nothing to
  cancel; on GitHub the cancellation step then runs before the branch is linked and prints
  "hardis project deploy cancel is not a sf command": the image release does not hold it yet.
- A simulation cancelled while it waits `Pending` behind another one stays `Pending` until the queue
  moves, then ends `Canceled` without running (seen 2026-11-21).
- Salesforce runs one deployment at a time per org: a second simulation waits `Pending`. Each step
  starts with the org idle (`org_idle`), so the first new `DeployRequest` of a step is the one of its
  job.
- The tests run one after the other in a deployment (measured: 20 methods in 147 seconds). Fewer
  methods make a simulation that ends before the job can be cancelled; the defaults leave about 7
  minutes.
- The cancel is asynchronous: a DeployRequest can stay `Canceling` for a minute. The steps wait up to
  4 minutes for `Canceled`.
- GitHub reads the check job timeout from the repository variable `CI_JOB_TIMEOUT_MINUTES`: the
  `timeout` step sets it, then deletes it. GitLab and Azure: the timeout is edited in the CI file of
  the story branch only.
- The timeout of the `timeout` step comes from the delay between the start of the first check job
  and the `CreatedDate` of its simulation, measured by `new-commit`. Never its `StartDate`: a
  deployment started on the org by something else holds the simulation `Pending`, the delay read
  624 seconds instead of 166, the timeout became 12 minutes and the simulation ended before it.
- GitLab runs no `after_script` once the job timeout is reached (proved by jobs 1047558 and
  1047573: the simulation kept running). The template sets `RUNNER_SCRIPT_TIMEOUT` 5 minutes below
  the job timeout, and its hook runs on any status but `success` when the job id file exists. The
  `timeout` step sets the script timeout to the computed minutes and the job timeout 5 minutes above.
- `deploy-order` cancels the check jobs of its two Pull Requests right after the merges, or they
  would keep the org busy and delay the deployments. A check job cancelled before its simulation
  logs that there is nothing to cancel.
- Never edit `dc-e2e.sh` while it runs: bash reads the script as it goes. Fix it after the run, then
  replay the steps with `RUN=<run> STEPS=...`.

## Cleanup

Once the report is copied to `reports/`, unless the user wants to look at them:

- the repository: `gh repo delete <repo> --yes`; GitLab `curl -X DELETE -H "PRIVATE-TOKEN: $GL_TOKEN"
  $GL_HOST/api/v4/projects/<id>`; Azure DevOps the repository and its pipelines;
- the scratch org: `sf org delete scratch -o <DC_ORG> --no-prompt`.
