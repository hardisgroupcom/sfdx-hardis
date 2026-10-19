# Deployment action types: end to end test

Proves, against a real scratch org and real GitHub Actions jobs, that every deployment action type
created by `hardis:project:action:create --agent` runs where it should, and only there: in the
validation job, in the deployment job, and again when the deployment job is run a second time.
About 30 minutes, most of it waiting for the three CI jobs (each one clones, builds and links the
sfdx-hardis branch under test).

The feature: `docs/salesforce-devops-work-on-user-story-deployment-actions.md`, the provider classes
in `src/common/actionsProvider/`, the execution loop in `src/common/utils/prePostCommandUtils.ts`.
Run it when an action type, the generic action code (`actionUtils.ts`, `action:create`,
`action:update`, the `ActionsProvider` hooks) or `runOnlyOnceByOrg` changed.

## What this scenario contains

| File                          | Use                                                                                                                                                                                                                                                            |
|-------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `scripts/da-e2e.sh`           | The run: steps `org repo pr check deploy assert-deploy rerun report`, one assertion per line of `$LOGS/results.tsv`, the report in `$LOGS/report.md`.                                                                                                          |
| `scripts/da-build-project.sh` | The sample project: an Apex batch (Batchable and Schedulable), a class a pre-deployment action removes from `package.xml`, a label the Pull Request changes, a User Access Policy and its permission set, an Apex script, two project actions written by hand. |
| `reports/`                    | One report per run (copy `$LOGS/report.md` there, named `<date>-<run>.md`).                                                                                                                                                                                    |

The CI harness comes from the [promotion-branches scenario](../promotion-branches/README.md):
`env-lib.sh`, `ci-workflows-prepare.cjs` and `ci-provider-github.sh`.

## Prerequisites

- `gh auth login` with an account that can create private repositories.
- A connected Dev Hub (`DEVHUB`, default `DevHub`) with one free scratch org.
- The branch under test pushed to `hardisgroupcom/sfdx-hardis`, with the `user-access-policy` action
  type (sfdx-hardis 8.20.0 or later).
- `node bin/dev.js` works in this working copy (`yarn install` done): the actions are created with it.

## Run it

```sh
bash .claude/skills/e2e/scenarios/deployment-actions/scripts/da-e2e.sh
# replay some steps of a run (its settings are kept in $LOGS/run.env)
RUN=da-e2e-1 STEPS="check deploy assert-deploy rerun report" bash .claude/skills/e2e/scenarios/deployment-actions/scripts/da-e2e.sh
```

Settings: `ORG` (scratch org alias, default `da-e2e-int`, created and prepared when missing),
`DEVHUB`, `SFDX_HARDIS_BRANCH` (default: current branch), `REPO` (default
`<gh login>/sfdx-hardis-da-e2e-<n+1>`), `RUN` (folders `$TMP/<run>` and `$TMP/<run>-logs`).

## What each step proves

| Step            | Proves                                                                                                                                                                                                                                                                                                                      |
|-----------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `org`           | The scratch org exists with User Access Policies on, the policy and its permission set deployed, a Chatter Free `da-e2e-user` user. Before each deployment: the policy is Active, the users lost the permission set, the test accounts and scheduled job are gone.                                                          |
| `repo`          | The sample project, the CI workflows of the branch under test, a private repository with `main integration uat preprod`, the logins.                                                                                                                                                                                        |
| `pr`            | A Pull Request to `integration`; `action:create --agent` creates `command` and `remove-packagexml-items` before the deployment, `apex`, `run-batch`, `schedule-batch`, `user-access-policy` (Apply To All) and `manual` after it; a policy action before the deployment and a run-batch flag on an apex action are refused. |
| `check`         | The validation job runs the `context: all` actions (command, package.xml removal), never a deployment-only one (no policy activation, no Apply To All, no project command); every action is in the Pull Request comment.                                                                                                    |
| `deploy`        | Merge, the deployment job succeeds.                                                                                                                                                                                                                                                                                         |
| `assert-deploy` | The deployment reset the policy and the action activated it; Apply To All ran in the CI container (new `UserAccessChange`, permission set given back); the Apex script created an account the batch updated; the job is scheduled; the removed class is not in the org; the manual step is in the comments, nothing failed. |
| `rerun`         | The deployment job run again: the actions with `runOnlyOnceByOrg` are skipped as already run, both policy actions run again (the project one has no `runOnlyOnceByOrg` key: its type runs at every deployment), the Apex script does not run twice.                                                                         |
| `report`        | `$LOGS/report.md`.                                                                                                                                                                                                                                                                                                          |

Not covered: `data` (SFDMU is not in the CI job) and `publish-community` (needs an Experience site).

## Traps

- Read the head commit of the Pull Request from the local clone (`git rev-parse HEAD`), never with
  `gh pr view` right after a push: GitHub can still answer the previous commit, whose run the push
  cancels, and the step then waits on a cancelled run.
- A `context: all` action with `runOnlyOnceByOrg: true` that the validation job ran counts as done in
  the org branch: the deployment job skips it as already run. That is expected.
- Apply To All needs Chrome: the `sfdx-hardis-ubuntu` image of the CI job has it.
- Never edit `da-e2e.sh` while it runs (bash reads the script as it goes). Fix it after the run, then
  replay the steps with `RUN=<run> STEPS=...`.
- After the run, delete the repository (`gh repo delete <repo> --yes`) and the scratch org
  (`sf org delete scratch -o da-e2e-int --no-prompt`) once the report is written, unless the user wants
  to look at them.
