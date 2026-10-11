<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:dora-report

## Description

Generates a DORA (DevOps Research and Assessment) metrics report for a Salesforce project, for each of its major orgs.

## Command Behavior

Everything is read from the **git provider** (GitHub, GitLab, Azure DevOps, Bitbucket), so no org login is needed and every team member gets the same numbers:

- **Deployment jobs** of each major branch: a deployment is a run of the deployment job after a merge
- **Deployment checks** of the Pull Requests targeting each major branch
- **Pull Requests** merged into each major branch, and the ones still open

The command fails when no authenticated git provider is available, or when its token cannot read CI jobs.

**Core DORA Metrics (5), per major branch:**

1. **Deployment Frequency** - successful deployment jobs per week
2. **Lead Time for Changes** - time from Pull Request creation to the end of the job that deployed its merge
3. **Change Failure Rate** - failed deployment jobs / (succeeded + failed). Canceled jobs are counted apart
4. **Mean Time to Recovery (MTTR)** - time from a failed deployment job to the next successful one on the same branch
5. **Deployment Rework Rate** - share of hotfix Pull Requests, or of deployments redone within a day of a failure

**Supplementary Metrics:**

6. Deployment Duration (time the job ran)
7. Deployment Queue Time (time the job waited for a runner)
8. PR Cycle Time
9. Change Volume
10. Validation Success Rate (deployment checks of the Pull Requests)
11. Contributors (Pull Requests and deployments per person)

Each metric is classified against DORA benchmarks as **Elite**, **High**, **Medium**, or **Low**, with the same scale for every branch.

Each branch also gets a **needs attention** list: a deployment that is still failing, Pull Requests open for more than 7 days, a failure rate that went up, no deployment for 30 days, changes waiting there for more than 30 days.

**Pipeline flow**, when several major branches are computed:

- **Time to production** - from the creation of the Pull Request of a change to its deployment on the production branch, whatever the number of branches it went through
- **Wait at each step** (for example `uat` to `preprod`) - from the deployment on a branch to the deployment on the next one, with the step where changes wait the longest
- **Waiting changes** - what reached a branch and has not been carried further, the oldest first
- The lead time shown for each branch is then the one of the changes themselves, not the one of the Pull Request that merged a branch into the next

**Which branches:**

- `--branches` when given (comma-separated).
- In a CI job: the current branch.
- Run by a user: every major branch (`config/branches/.sfdx-hardis.*.yml`).
- In a monitoring repository whose `.sfdx-hardis.yml` has `deploymentRepository`: the branch `deploymentBranch` of that repository. The token is `SFDX_HARDIS_DEPLOYMENT_REPO_TOKEN` when set, else the git provider token of the monitoring repository, which must then be able to read the deployment repository.

**Output:** a **Markdown report** with Mermaid diagrams (and a PDF with `--pdf`), a **CSV export** of the jobs, and a **notification** (Slack, Teams, Grafana...) when a single branch is computed: `--target-org` then only says which org the notification is about.

`--data-only` returns the JSON result alone, without report files nor notification. The VS Code **DORA metrics** panel uses it.

`--compare` also computes the period of the same length just before, so each metric shows where it comes from.

This command is part of [sfdx-hardis Documentation](https://sfdx-hardis.cloudity.com/salesforce-project-documentation/).

<details markdown="1">
<summary>Technical explanations</summary>

- Runs are listed with `GitProvider.listCiRuns()`: workflow runs on GitHub, jobs on GitLab, builds on Azure DevOps, pipelines and their steps on Bitbucket.
- A run is a deployment or a deployment check according to the name of its job (`Process Deployment`, `deploy_to_org`, `Deployment`, `Deploy to major org`, and their check counterparts). When a project renamed its jobs and no run of a branch is named as a deployment, every run triggered by a push to that branch counts.
- Token scopes: `Actions: Read` on GitHub, `read_api` on GitLab, `Build: Read` on Azure DevOps, `pipeline` on Bitbucket.
- Finished runs do not change: they are kept in `~/.sfdx/sfdx-hardis-cache/dora`, and only the runs newer than the last reading are asked to the provider. `--refresh` reads everything again.
- A git provider keeps its job runs for a limited time: with `--compare`, when a branch has no run as old as the period asked for, the report says when its data starts.
- Runs of a major branch that no merge triggered (scheduled pipelines, pipelines started through the API, Bitbucket custom pipelines) are not deployments.
- A job run again on the same commit replaces its previous result on some providers, so a failure fixed by a re-run can disappear from the history.
- The pipeline flow is rebuilt from the Pull Requests, without reading the git history. A Pull Request from a major branch into the next carries every change that was in its source branch when it was merged. A promotion Pull Request (`promotion/<source>/<target>/...`) carries the Pull Requests its `promotionPullRequests` list declares. A merge from a major branch back into an earlier one carries nothing.
- A change cherry-picked by hand, or merged more than 90 days before the period, is not followed. A promotion whose list cannot be read, and a change a promotion declares that was not read, are counted in `pipeline.untraced` and said in the report.
- The pipeline flow needs every branch of a step: `--branches uat,main` on a project where `uat` is merged into `preprod` computes none.
- The steps are the `mergeTargets` of each major branch. In a monitoring repository, where they cannot be read, the branches of `--branches` follow each other in the order given.
- The notification keeps the lead time of the Pull Requests of the branch, so the Grafana history stays comparable.
- The `--json` result holds `pipeline` (stages, steps, time to production, slowest changes), `branches` (metrics, weekly series, failed deployments, slow and hotfix Pull Requests, attention list), `contributors`, and the legacy `metrics`, `supplementary` and `counts` of the production branch.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:doc:dora-report --agent
sf hardis:doc:dora-report --agent --data-only --compare --period 180 --json
```

In agent mode:

- The command has no interactive prompt: `--agent` changes nothing to its behavior.
- `--period` defaults to 90 days when not provided.
- The git provider token must be in the environment (`GITHUB_TOKEN`, `CI_SFDX_HARDIS_GITLAB_TOKEN`, `CI_SFDX_HARDIS_AZURE_TOKEN`, `CI_SFDX_HARDIS_BITBUCKET_TOKEN`).

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.github.io) course runs this command, click by click, on an org of your own, in these labs:

- [Lab 3.6 - Release to production and read your DORA metrics](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-6-release-to-production-and-read-dora-metrics/)
- [Lab 3.11 - Capstone: run a weekly release cycle](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-11-capstone-run-a-weekly-release-cycle/)

<!-- training-links:end -->


## Parameters

| Name              |  Type   | Description                                                                                          | Default | Required | Options |
|:------------------|:-------:|:-----------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent             | boolean | Run in non-interactive mode for agents and automation                                                |         |          |         |
| branches<br/>-b   | option  | Comma-separated branches to compute. Default: the current branch in CI, every major branch otherwise |         |          |         |
| compare           | boolean | Also compute the previous period of the same length, to show how each metric moved                   |         |          |         |
| data-only         | boolean | Return the JSON result only: no report file, no notification                                         |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                      |         |          |         |
| flags-dir         | option  | Import flag values from a directory.                                                                 |         |          |         |
| json              | boolean | Format output as json.                                                                               |         |          |         |
| outputfile<br/>-f | option  | Force the path and name of output report file. Must end with .md                                     |         |          |         |
| pdf               | boolean | Also generate the documentation in PDF format                                                        |         |          |         |
| period<br/>-p     | option  | Number of days to analyze (default: 90, maximum: 365)                                                |   90    |          |         |
| refresh           | boolean | Read every job again from the git provider instead of using the local cache                          |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                        |         |          |         |
| target-org<br/>-o | option  | Username or alias of the target org.                                                                 |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                            |         |          |         |

## Examples

```shell
$ sf hardis:doc:dora-report
```

```shell
$ sf hardis:doc:dora-report --period 30
```

```shell
$ sf hardis:doc:dora-report --branches integration,uat,main
```

```shell
$ sf hardis:doc:dora-report --pdf
```

```shell
$ sf hardis:doc:dora-report --target-org myorg@example.com
```

```shell
$ sf hardis:doc:dora-report --agent
```

```shell
$ sf hardis:doc:dora-report --agent --data-only --compare --json
```


