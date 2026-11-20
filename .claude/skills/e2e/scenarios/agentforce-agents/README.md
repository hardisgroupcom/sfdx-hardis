# Agentforce agents: end to end test

Proves, against two real orgs and real GitHub Actions jobs, the whole delivery of an Agentforce agent
(API 68.0) through the sfdx-hardis pipeline: an agent built in a developer org, retrieved with
`hardis:org:retrieve:agent`, its deployment actions written by the cleaning
`autoAddAgentsDeploymentActions`, its running user created by the validation job, a version published
and activated in the integration org by the deployment job, nothing published again when that job is
run a second time, then a change of its Agent Script that publishes a second version and deactivates
the first one. About 45 minutes, most of it waiting for the five CI jobs.

The feature: `docs/salesforce-ci-cd-agentforce-agents.md` and the pages of the three action types
(`...-deployment-actions-agent-publish.md`, `-agent-running-user.md`, `-agent-activate.md`), the
providers `src/common/actionsProvider/agent*.ts`, the cleaning
`src/commands/hardis/project/clean/agents-deployment-actions.ts`, the built-in replacement rule
`src/common/replacementRules/agentRunningUserBuiltInRule.ts`, the retrieve command
`src/commands/hardis/org/retrieve/agent.ts`. Run it when one of them changed, or to prove a release
(a beta) before announcing the feature.

## What this scenario contains

| File                          | Use                                                                                                                                                         |
|-------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `scripts/ag-e2e.sh`           | The run: steps `org repo pr1 check1 deploy1 assert-deploy1 rerun1 pr2 check2 deploy2 assert-deploy2 report`, one assertion per line of `$LOGS/results.tsv`. |
| `scripts/ag-build-project.sh` | The sample project: API 68.0, a custom label, `autoAddAgentsDeploymentActions` in `autoCleanTypes`, no agent (the first Pull Request retrieves it).         |
| `reports/`                    | One report per run (copy `$LOGS/report.md` there, named `<date>-<run>.md`).                                                                                 |

The CI harness comes from the [promotion-branches scenario](../promotion-branches/README.md):
`env-lib.sh`, `ci-workflows-prepare.cjs` and `ci-provider-github.sh`.

## Prerequisites

- `gh auth login` with an account that can create private repositories.
- Two orgs on API 68.0 (Winter '27) or above, with Agentforce and the Einstein Agent licenses that
  `sf org create agent-user` needs:
  - by default the run creates them as scratch orgs (`ag-e2e-dev`, `ag-e2e-int`) from the Dev Hub
    `DEVHUB`, with the `Einstein1AIPlatform` feature and the Einstein GPT and agent platform settings.
    When the Dev Hub is not on API 68.0 yet, set `AG_SCRATCH_RELEASE=preview`.
  - or log in to two orgs that have Agentforce (Developer Edition orgs with Agentforce, sandboxes)
    and give their aliases in `AG_DEV_ORG` and `AG_INT_ORG`. The integration org must not have the
    agent `AG_E2E_Agent` nor its running user: the `org` step stops when it does.
- The sfdx-hardis under test, on both sides:
  - **the CI jobs**: a branch pushed to `hardisgroupcom/sfdx-hardis` (default: the current branch), or
    a release through its Docker image (below).
  - **this computer** (retrieve, cleaning, `action:create`): `node bin/dev.js` of this working copy
    (`yarn install` done), or the installed plugin with `AG_CLI=sf`.

## Run it

```sh
bash .claude/skills/e2e/scenarios/agentforce-agents/scripts/ag-e2e.sh
# replay some steps of a run (its settings are kept in $LOGS/run.env)
RUN=ag-e2e-1 STEPS="check2 deploy2 assert-deploy2 report" bash .claude/skills/e2e/scenarios/agentforce-agents/scripts/ag-e2e.sh
```

### Prove a beta

Once the feature is merged and a beta is published, run the CI jobs in the beta image, and this
computer on `main` (or on the beta plugin):

```sh
git checkout main && git pull && yarn install
npm view sfdx-hardis@beta version          # the version the jobs must print
SFDX_HARDIS_IMAGE=ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:beta \
SFDX_HARDIS_VERSION=<that version> \
bash .claude/skills/e2e/scenarios/agentforce-agents/scripts/ag-e2e.sh
```

With `SFDX_HARDIS_IMAGE`, `SFDX_HARDIS_BRANCH` defaults to `-`: the jobs run the release the image
holds, with no link step, and `CHECK1-VERSION` asserts the version they print. Read the version the
image really holds before trusting it: an image built before npm served the beta holds the previous
one (see the beta section of the promotion-branches runbook).

Settings, from the environment, else the `.env` of the working copy: `AG_DEV_ORG`, `AG_INT_ORG`,
`AG_SCRATCH_RELEASE`, `DEVHUB`, `SFDX_HARDIS_BRANCH`, `SFDX_HARDIS_IMAGE`, `SFDX_HARDIS_VERSION`,
`AG_CLI`, `AG_REPO` (default `<gh login>/sfdx-hardis-ag-e2e-<n+1>`), `RUN` (folders `$TMP/<run>` and
`$TMP/<run>-logs`, or `AG_WORK` and `AG_LOGS`).

## What each step proves

| Step             | Proves                                                                                                                                                                                                                                                                                                                                                     |
|------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `org`            | Both orgs are connected on API 68.0. The developer org has the agent `AG_E2E_Agent`, a service agent running as an agent user of that org, deployed and published as Agentforce Builder leaves it. The integration org has neither the agent nor its user.                                                                                                 |
| `repo`           | The sample project, the CI workflows of the sfdx-hardis under test, a private repository with `main integration uat preprod`, the logins of the integration org, Actions on.                                                                                                                                                                               |
| `pr1`            | `hardis:org:retrieve:agent --agent` writes the Agent Script of the latest version, running as the developer org user, adds `AiAuthoringBundle` to `manifest/package.xml`, and leaves no version nor definition file. The cleaning writes `agent-publish` (deployments only, once by org) and `agent-running-user` (checks too); a second run adds nothing. |
| `check1`         | The validation job creates the running user in the integration org, the built-in rule writes it in the deployed bundle, nothing is published and no agent is deployed; the Pull Request comment lists the publication.                                                                                                                                     |
| `deploy1`        | Merge, the deployment job succeeds.                                                                                                                                                                                                                                                                                                                        |
| `assert-deploy1` | The deployment finds the user the check created, publishes a version, which the org numbers, and activates it: one version in the org, active, one agent user; no failed action in the comments.                                                                                                                                                           |
| `rerun1`         | The deployment job run again skips the publication (already run in integration): still one version, still one user.                                                                                                                                                                                                                                        |
| `pr2`            | A change of the welcome message of the Agent Script; the cleaning writes the actions of the new Pull Request, `action:create --agent` adds an `agent-activate` action without any version parameter.                                                                                                                                                       |
| `check2`         | The validation finds the existing running user and publishes nothing.                                                                                                                                                                                                                                                                                      |
| `deploy2`        | Merge, the deployment job succeeds.                                                                                                                                                                                                                                                                                                                        |
| `assert-deploy2` | A second version is published with a higher number and activated, `agent-activate` finds it already active, the org has two versions with only the new one active, still one agent user.                                                                                                                                                                   |
| `report`         | `$LOGS/report.md`: the table of every check.                                                                                                                                                                                                                                                                                                               |

## Traps

- **A scratch org may not get Agentforce.** The scratch definition asks for `Einstein1AIPlatform` and
  turns on the Einstein GPT and agent platform settings, but a Dev Hub without the matching
  entitlements gives an org where `sf org create agent-user` fails on missing licenses
  (`dev-agent-user.json`). Use orgs that have Agentforce through `AG_DEV_ORG` and `AG_INT_ORG` then.
- **`sf org create scratch` needs the package directory to exist.** The throwaway project that
  creates a scratch org declares `force-app`: without the folder the command fails with
  `MissingPackageDirectoryError` (the `ORG-DEV` check fails with "not created"). The script creates it.
- **The cleaning finds a Pull Request that is merged, or one recorded in the user config.** On
  GitHub the provider reads the Pull Request of a commit only once merged. Run from a shell, the
  cleaning of an open Pull Request writes `scripts/actions/.sfdx-hardis.draft.yml`, and the CI jobs
  stop on it ("Draft commands file ... found"). `work:save` records the Pull Request it creates in
  `config/user/.sfdx-hardis.<user>.yml` (`mergeRequests`): the script does the same
  (`register_pull_request`) before each cleaning.
- **Below API 68.0 nothing works**: no agent files at retrieve, deployments refused. The `org` step
  stops on an org below 68.0; a scratch org follows the release of the Dev Hub unless
  `AG_SCRATCH_RELEASE` says otherwise.
- **The integration org is used up by a run**: it keeps the agent, its versions and its running
  user. Replaying `org` on it stops; replay the later steps with `RUN=<run>`, or start again with a
  new integration org.
- **Steps run in order**: `assert-deploy1` reads the org as `deploy1` left it, and `pr2` needs the
  merge of `pr1`.
- Clean up once the report is copied: `gh repo delete <repo> --yes` and
  `sf org delete scratch -o ag-e2e-dev -p` / `-o ag-e2e-int -p` (scratch orgs only).
