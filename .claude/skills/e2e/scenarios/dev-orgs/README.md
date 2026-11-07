# Development orgs list: end to end test

Proves, with real CI jobs running sfdx-hardis built from the branch under test (GitHub Actions for
now), the commands a developer runs on a workstation (`bin/dev.js` of this working copy) and the
"Development Orgs Dashboard" issue of the git provider, that the development orgs list knows which
org a developer works in, its target branch, and what it misses since its last backpromote. The
DevOps Pipeline of vscode-sfdx-hardis is read headless with `check-pipeline.cjs`. About 40 minutes,
most of it waiting for four CI jobs.

What it proves:

- `work:new` registers the org it works in: the dashboard is created at the first registration,
  the git user owns the new entry, the org is "mine", nothing is counted yet.
- A second `work:new` in the same org on another target branch warns and keeps the registered one.
- The deployment job of integration, after a merge, writes the merged Pull Requests of integration
  on the dashboard: the org misses that Pull Request.
- `dev-org:register --org-id` changes the target branch, the owner and the users.
- The merge of integration into uat is a vehicle: it counts as one, and carries the first story.
- A backpromote from uat records itself: the org misses nothing anymore.
- `dev-org:list --refresh` lists the merged Pull Requests again from a workstation.
- `dev-org:remove` empties the list and the dashboard says so.
- The DevOps Pipeline draws the org under its target branch with its count bubble, without a bubble
  once it is up to date, and draws nothing once it is removed.

The feature: `src/common/utils/devOrgsRules.ts`, `devOrgsRegistry.ts`, the commands
`hardis:project:dev-org:*`, the hooks in `work:new`, `work:save`, `work:backpromote`, `org:create`
and `deploy:smart`, and in vscode-sfdx-hardis `devOrgsUtils.ts`, the dev org nodes of the mermaid
builder and `s/devOrgDetails`.

## What this scenario contains

| File                              | Use                                                                                                                                                                                       |
|-----------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `scripts/devorgs-e2e.sh`          | The run: steps `orgs repo new other-target merge-1 pipeline-1 edit vehicle backpromote pipeline-2 refresh remove report`, one assertion per line of `$LOGS/results.tsv`, `$LOGS/report.md`. |
| `scripts/devorgs-build-project.sh` | The sample project: one custom label, `integration -> uat -> main`, integration and uat as target branches, delta deployments on.                                                         |
| `reports/`                        | One report per run and provider.                                                                                                                                                          |

It reuses the CI harness of the [promotion-branches scenario](../promotion-branches/README.md):
`env-lib.sh`, `ci-workflows-prepare.cjs`, `ci-provider-<provider>.sh`, `promotion-provider.sh`
(`p_open`, `p_merge`, `p_token`), `section-lib.sh` (`assert_log`) and `check-pipeline.cjs`, whose
`devOrgsFile` and `devOrgNodes` expectations were added for this scenario.

## Prerequisites

- `gh auth login` (the run creates a private repository under `GH_E2E_OWNER`, default your login).
- A Dev Hub with two free scratch orgs (`DEVHUB`, default `DevHub`): one for the three major
  branches, one as the developer's org.
- The branch under test pushed to `hardisgroupcom/sfdx-hardis` (the CI jobs clone it), and
  `node bin/dev.js` working in this working copy (`yarn install` done): the workstation commands run
  from it.
- vscode-sfdx-hardis cloned next to this working copy, on the branch of the feature, compiled
  (`yarn compile`).

## Run it

```sh
PROVIDER=github bash .claude/skills/e2e/scenarios/dev-orgs/scripts/devorgs-e2e.sh
# replay steps of a run (its settings are kept in $LOGS/run.env and $LOGS/ci-vars.sh)
PROVIDER=github RUN=devorgs-e2e-github-20261107-1500 STEPS="pipeline-1 report" bash .../devorgs-e2e.sh
```

Run it in the background and watch the `[FAIL]` lines.

## What each step proves

| Step           | Proves                                                                                                                                                                                                                  |
|----------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `orgs`         | Two scratch orgs: the major org (its auth URL logs integration, uat and main in) and the dev org.                                                                                                                      |
| `repo`         | The sample project, the CI files of the branch under test, a private repository with `main integration uat`, the logins. The clone's git user is `E2E Owner <e2e-owner@example.com>`.                                   |
| `new`          | No dashboard before; `work:new --agent --target-org <dev org> --target-branch integration` prints the registration; one open dashboard issue holding one comment for the org, a body that says not to edit it; `dev-org:list` shows the org (scratch, target integration, owned by the git user, mine, `behind` null). |
| `other-target` | `work:new` on uat in the same org warns "is registered for target branch integration, not uat"; the registered target stays integration.                                                                                |
| `merge-1`      | Pull Request #1 (a label change) validated, merged into integration; its deployment job prints "Development orgs list updated"; the dashboard holds a `branch` comment of integration listing #1; the org misses #1. |
| `pipeline-1`   | The "Dev orgs" view of the DevOps Pipeline draws the org with a bubble of 1; the "Feature branches" view draws no dev org.                                                                                            |
| `edit`         | `register --org-id --target-branch uat --owner --users`: target uat, new owner, the git user still a user (mine), nothing counted for uat yet.                                                                       |
| `vehicle`      | integration merged into uat; the deployment job of uat updates the list; the org misses one Pull Request, the vehicle, which carries #1 (from the scope `deploy:smart` computed).                                       |
| `backpromote`  | `work:backpromote` from uat into the dev org (plan, then `--agent --run-id --from-pull-request`); `lastBackpromote` is from uat; the org misses nothing.                                                                 |
| `pipeline-2`   | The org is drawn without a bubble.                                                                                                                                                                                     |
| `refresh`      | `dev-org:list --refresh` from the workstation: the list of uat has no job link, the count stays 0.                                                                                                                    |
| `remove`       | `dev-org:remove --org-id`: the list is empty, the dashboard says no org is registered, the pipeline draws no node for the org.                                                                                         |
| `report`       | `$LOGS/report.md`, the last result of each check.                                                                                                                                                                      |

A check that cannot run says SKIP with the reason, never OK.

## Not covered here

- A refreshed sandbox replaced by its new org id, and the rules on stale and expired orgs: two
  scratch orgs cannot play a refresh, and staleness needs 30 days. The unit tests cover them
  (`test/common/utils/devOrgsRules.test.ts`, `devOrgsRegistry.test.ts`).
- GitLab, Azure DevOps and Bitbucket: the workstation commands need each provider's token variables
  wired in `hardis()` (`CI_SFDX_HARDIS_GITLAB_TOKEN`, `SYSTEM_ACCESSTOKEN`...) and `read_dashboard`
  needs the provider's API. The dashboard machinery is the one of the scratch org pool, proven on the
  four providers.

## Traps

- The workstation commands run with `CI` unset, like on a computer: they never clean the dashboard
  up, only the CI job and the explicit `dev-org` commands do.
- `work:new` leaves the clone on its new branch: the run checks the branch it needs out before each
  step.
- The backpromote switches the clone to `backpromote/uat/<org>`; the run checks main out after it.
- The validation of the integration -> uat Pull Request is looked up on the head the provider gives
  (`ci_pr_head_sha`): the local `origin/integration` is not fetched after the first merge, and its
  stale commit has no run (the first run reported `exit=9` there).
- Claude Code can stop a background run when the computer is low on memory. Replay from the step it
  was in, with the same `RUN`: every step reads what the previous ones saved in `$LOGS/run.env`.
- `check-pipeline.cjs` loads the compiled extension (`out/`): `yarn compile` in vscode-sfdx-hardis
  on its branch first.
- Never edit `devorgs-e2e.sh` while it runs: bash reads the script as it goes. Fix it after the run,
  then replay the steps with `RUN=<run> STEPS=...`.

## Cleanup

Once the report is copied to `reports/`, unless the user wants to look at them:
`gh repo delete <repo> --yes`, then `sf org delete scratch -o <org> --no-prompt` for the two orgs.
