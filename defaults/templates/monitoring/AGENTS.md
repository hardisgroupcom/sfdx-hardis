<!-- sfdx-hardis-monitoring-agents-start -->
<!-- markdownlint-disable MD013 -->
<!-- This block is rewritten by sfdx-hardis at each monitoring backup. Write your own notes after the end marker, they are kept. Keep both markers: without them, the backup stops updating this file. -->

# Salesforce org monitoring repository (sfdx-hardis)

This repository is an [sfdx-hardis Org Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/) repository. It holds a nightly backup of the metadata of one or more Salesforce orgs, made by a scheduled CI/CD pipeline. Nobody develops in it and nothing is ever deployed from it.

Read this file before answering questions about the org, and answer from the files of the repository and from its git history.

## How it works

- **One git branch per monitored org.** Branch names usually look like `monitoring_<client>` for production and `monitoring_<client>__<sandbox>` for sandboxes. The branch you are on is the org you are looking at. Run `git fetch --all` then `git branch -r` to list the other monitored orgs.
- **The org and user of the branch** are in `.sfdx-hardis.yml` (`instanceUrl`, `targetUsername`). Authentication secrets are CI variables, never files of the repository.
- **Every night, the backup job** runs `sf hardis:org:monitor:backup`: it lists all the metadata of the org, retrieves it in source format, then commits the result on the branch with a message like `chore(monitoring): org state on 2026-01-31 00:12 for monitoring_myclient`. A day without changes in the org makes no commit.
- **Then other jobs run** on the same branch, and they do not commit anything:
  - `sf hardis:org:test:apex` runs the Apex tests of the org.
  - `sf hardis:org:monitor:all` runs the monitoring checks listed below.
  - MegaLinter scans the retrieved sources for quality and security issues.
- **Their results are not stored in the repository.** They are sent as notifications (Slack, Microsoft Teams, email), to an API or a Grafana dashboard when configured, and kept as CI job artifacts (`hardis-report/`, `megalinter-reports/`) for a limited time.

## Answering questions with git

The git history of a branch is the change history of the org, one commit per day with changes.

- What changed recently: `git log --stat -n 10`
- When a component changed: `git log --follow -p -- force-app/main/default/flows/My_Flow.flow-meta.xml`
- What changed between two dates: see [Report of the changes between two dates](#report-of-the-changes-between-two-dates)
- Compare two orgs: `git diff origin/monitoring_myclient origin/monitoring_myclient__uat_sandbox -- force-app/main/default/objects/Account`

A commit shows the state of the org at the time of the backup, not who made the change or when during the day. The author of the commit is the CI user or bot. To know which user changed something in Setup, the org's Setup Audit Trail is the source (the `AUDIT_TRAIL` check reports suspect entries).

## Report of the changes between two dates

When the user asks what changed in the org between two dates and does not ask for another format, write the answer in a markdown file with the format below, then give its path and a two or three line summary in the chat.

### Where each kind of change comes from

The backup retrieves the org into `force-app/` but **never deletes a file**: a component deleted in the org stays in `force-app/`. So:

- **Added** and **Removed** come only from `manifest/package-all-org-items.xml`, the list of every item that exists in the org at each backup.
- **Updated** comes from the files modified under `force-app/`.
- Never report a component as Removed because of `force-app/`, and never infer that a component exists in the org because its file is in `force-app/`.

### Collect the changes

1. Take both dates as whole days, in UTC, both included. When only one date is given, the second one is today.
2. **A backup commit holds the changes made since the previous backup run, not the changes of its own day.** Backups run once a day, so look at the time of the recent backup commits:
   - Made before noon UTC (the default schedule runs just after midnight): each commit holds the changes of the day before it. Read the commits made from the day after `<from>` to the day after `<to>`: for January, from `2026-01-02 00:00:00` to `2026-02-01 23:59:59`.
   - Made after noon UTC: each commit holds mostly the changes of its own day. Read the commits made from `<from> 00:00:00` to `<to> 23:59:59`.

   Say which of the two you applied in the report. List those commits of the current branch, newest first:

   ```sh
   git log --since="2026-01-02 00:00:00 +0000" --until="2026-02-01 23:59:59 +0000" --format="%H %cI %s" -- manifest/package-all-org-items.xml force-app installedPackages
   ```

3. For each commit, take the date and time from its message (`org state on YYYY-MM-DD HH:MM`). If the message has none, use the commit date in UTC (`git show -s --date=format-local:"%Y-%m-%d %H:%M" --format=%cd <sha>` with `TZ=UTC`).
4. **Added and Removed**: read the manifest before and after the commit, and compare the two sets of `type:member` pairs. Do not read the line diff of the XML: a `<members>` line does not show its type, which is in the `<name>` line of its `<types>` block.

   ```sh
   git show <sha>~1:manifest/package-all-org-items.xml > before.xml
   git show <sha>:manifest/package-all-org-items.xml > after.xml
   ```

   A pair only in `after.xml` is Added, a pair only in `before.xml` is Removed. If the commit has no parent, or the manifest does not exist in the parent, it is the first backup: write `Initial backup of the org.` in its section instead of listing everything.
5. **Updated**: list the files the commit modified under `force-app/` (`git show --name-status --format= <sha> -- force-app`), turn them into components (see below), and drop the ones already reported as Added in the same commit. Ignore the `D` status there.
6. **Installed packages**: the manifest also lists the items of managed and unlocked packages. Do not list members whose namespace prefix (`xyz__`) belongs to an installed package: report the package itself as **InstalledPackage** instead. A new file in `installedPackages/` is an Added package, a version change in a file is an Updated package, written with its old and new version numbers: `My Package (1.2 -> 1.3)`. A package is Removed when all the members of its namespace disappear from the manifest (its file in `installedPackages/` is not deleted either).
7. Skip commits with nothing Added, Removed or Updated.

### Turn files into components

- Report **components**, not files. A component made of several files counts once: an Apex class and its `-meta.xml`, all the files of an LWC or Aura bundle, a static resource and its content.
- Use the Metadata API type names and member names exactly as `manifest/package-all-org-items.xml` writes them: `ApexClass`, `ApexTrigger`, `ApexPage`, `ApexComponent`, `LightningComponentBundle`, `AuraDefinitionBundle`, `Flow`, `CustomObject`, `CustomField`, `ValidationRule`, `RecordType`, `ListView`, `CompactLayout`, `WebLink`, `Layout`, `FlexiPage`, `PermissionSet`, `PermissionSetGroup`, `Profile`, `CustomLabels`, `CustomMetadata`, `StaticResource`, `EmailTemplate`, `Report`, `Dashboard`... When unsure how a file maps to a type or a member, look the name up in that manifest.
- Object sub-components carry the object name: `objects/Account/fields/VAT__c.field-meta.xml` is **CustomField** `Account.VAT__c`, `objects/Account/validationRules/Check_VAT.validationRule-meta.xml` is **ValidationRule** `Account.Check_VAT`.

### Output format

```markdown
# Org changes from 2026-01-01 to 2026-01-31

Org: https://myclient.my.salesforce.com (branch monitoring_myclient)

Backups read: 2026-01-02 00:10 to 2026-02-01 00:12 UTC. Each one holds the changes made since the previous nightly backup.

## 2026-01-28 00:12

- Added
  - **ApexClass**: InvoiceService, InvoiceServiceTest
  - **CustomField**: Account.VAT__c

- Updated
  - **Flow**: Account_After_Update

## 2026-01-15 00:09

- Removed
  - **Layout**: Account-Old Account Layout
```

- One `##` section per backup commit, newest first, titled with its date and time in UTC. Under the org line, say which backups were read and that each holds the changes made since the previous one.
- Inside each section, the groups `Added`, `Removed` and `Updated`, in that order, separated by a blank line. Leave out a group with no component.
- One line per metadata type: the type in bold, then its members separated by a comma and a space. Sort types and members alphabetically.
- The org URL comes from `instanceUrl` in `.sfdx-hardis.yml`.
- If nothing changed in the range, write the title, the org line and `No change detected in this period.`
- Write the file to `hardis-report/org-changes-<from>-to-<to>.md` (git ignores that folder), unless the user gives another path.
- Report only what the commits show. Do not guess who made a change or why.

## Deployment repository and pipelines

{{deploymentRepositoryStatus}}

This repository shows what the org looks like every night. The deployment repository (the sfdx-hardis CI/CD project of the same org) shows what was delivered to it, through which Pull Request, and whether its pipelines succeeded. Use both, and the pipeline logs of both, for questions like:

- Was this change deployed by the CI/CD pipeline, or made directly in the org?
- Which Pull Request brought this version of the Flow to production, and when?
- Why did last night's backup fail? Why did the last deployment to this org fail?
- What is in the deployment repository that is not in the org yet, or the other way around?

### Get the deployment repository

1. Take the repository name from the last part of `deploymentRepository`, without `.git`.
2. If `../<name>` exists and `git -C ../<name> remote get-url origin` points to the same repository (same host and path, whatever the `https` or `ssh` form and the `.git` suffix), use it. Otherwise clone it there: `git clone <deploymentRepository> ../<name>`. If the clone fails for lack of rights, tell the user and answer without the deployment repository.
3. Run `git -C ../<name> fetch --all --prune` before answering.
4. That folder may be the working copy of the user: never check out, commit or change anything in it. Read the branches through their remote refs: `git -C ../<name> show origin/<branch>:<path>`, `git -C ../<name> log origin/<branch> -- <path>`, `git -C ../<name> ls-tree -r --name-only origin/<branch>`.

### Find the branch that deploys to this org

- If `deploymentBranch` is set in `.sfdx-hardis.yml`, use it.
- Otherwise, list the branch configuration files of the deployment repository, on its default branch (`git -C ../<name> remote show origin` names it): `git -C ../<name> ls-tree --name-only origin/<default branch> config/branches/`. The file whose `instanceUrl` is the `instanceUrl` of `.sfdx-hardis.yml` here (compare them without the trailing `/`, ignoring case) is `config/branches/.sfdx-hardis.<branch>.yml`, and `<branch>` is the branch that deploys to this org.
- If no file matches, say so and ask the user which branch it is. Do not pick one from its name. Suggest setting `deploymentBranch` in `.sfdx-hardis.yml` so the next agent does not have to ask.

### How the CI/CD pipeline works

Read the configuration from the deployment branch itself (`git -C ../<name> show origin/<branch>:<path>`): settings can differ from one branch to another. The [sfdx-hardis documentation](https://sfdx-hardis.cloudity.com/salesforce-devops-home/) explains each of them.

#### Branches and orgs

- Each **major branch** (for example `integration`, `uat`, `preprod`, `main`) is linked to one org by `config/branches/.sfdx-hardis.<branch>.yml` (`instanceUrl`, `targetUsername`).
- The `mergeTargets` of each branch file names the branches it is merged into. Follow them from branch to branch to rebuild the pipeline, for example `integration -> uat -> preprod -> main`.
- Developers create **feature branches** (User Stories) from `developmentBranch` or one of `availableTargetBranches` in `config/.sfdx-hardis.yml`, then open a Pull Request to that branch.
- With `enablePromotionBranches: true` (Beta), a `promotion/<source>/<target>/<date>` branch carries a subset of approved User Stories from one major branch to the next. Its Pull Request lists the carried Pull Requests in its description (`promotionPullRequests: [...]`).

#### What a Pull Request triggers

- While it is open, the pipeline runs `sf hardis:project:deploy:smart --check`: a validation (check-only deployment with the Apex tests) against the org of the target branch. On GitHub it is the `check-deploy.yml` workflow, on GitLab the check job of `.gitlab-ci.yml`, on Azure DevOps `azure-pipelines-checks.yml`.
- Once merged, the pipeline runs `sf hardis:project:deploy:smart` on the target branch and deploys to its org (`process-deploy.yml` on GitHub, `azure-pipelines-deployment.yml` on Azure DevOps). It uses a Quick Deploy of the validation when it can.
- sfdx-hardis comments the Pull Request with the result of the check, the deployment errors and their fix tips, the Flow visual differences and the deployment actions. Read those comments first: they explain a failure better than the raw logs.

#### What gets deployed

- By default, the items listed in `manifest/package.xml`, minus the items of `manifest/package-no-overwrite.xml` that already exist in the target org. A component that is in the repository but not in `manifest/package.xml` is never deployed. The sources are in the package directories of `sfdx-project.json` (not always `force-app/`).
- `useDeltaDeployment: true`: from a feature branch to a major branch, only the metadata changed by the Pull Request, plus their dependencies with `useDeltaDeploymentWithDependencies: true`. Between two major branches the deployment stays full, unless `enableDeltaDeploymentBetweenMajorBranches: true`.
- `useSmartDeploymentTests: true`: Apex tests are skipped when a delta deployment only holds metadata that cannot break them (layouts, labels, reports...), never in production.
- `manifest/package-no-overwrite.xml` (or the file named by `packageNoOverwritePath` on a branch): items deployed only if they do not exist in the org yet. `manifest/packageDeployOnChange.xml`: items deployed only when they differ from the org. A difference between the two repositories on these items is expected.
- `manifest/destructiveChanges.xml`: items deleted from the org by the deployment.
- `installedPackages` in `config/.sfdx-hardis.yml`: the packages installed by the deployments.
- `testLevel`, `runtests`, `skipCodeCoverage`, `apexTestsMinCoverageOrgWide`: test settings, often per branch.

#### Deployment actions

Steps run before (`commandsPreDeploy`) or after (`commandsPostDeploy`) a deployment, unless `disableDeploymentActions: true`:

- For every deployment to a branch: in `config/.sfdx-hardis.yml` or `config/branches/.sfdx-hardis.<branch>.yml`.
- For one Pull Request: in `scripts/actions/.sfdx-hardis.<Pull Request number>.yml` (`scripts/actions/.sfdx-hardis.draft.yml` before the Pull Request exists). They run when that Pull Request is deployed, and again at each later step of the pipeline.
- Types: `command`, `apex` (anonymous Apex script), `data` (SFDMU import), `publish-community`, `schedule-batch`, `remove-packagexml-items`, and `manual` (a step a person performs, ticked off in the Pull Request comment when `manualActionsMode: sfdxHardis`; otherwise manual steps are in the file of `manualActionsFileUrl`).
- `context` says whether it runs during the check, the deployment or both; `runOnlyOnceByOrg` skips it in an org where it already ran.

So "why is this record, schedule or setting like this in the org?" can have its answer in an action, not in the metadata.

#### History

- Each merge into a major branch is a Pull Request, deployed to the org of that branch. The Pull Request number is in the merge commit message: `Merge pull request #12` or `(#12)` on GitHub, `See merge request group/project!12` on GitLab, `Merged PR 12` on Azure DevOps, `(pull request #12)` on Bitbucket.
- The ticket of a User Story (Jira, Azure Boards...) is usually in the branch name, the Pull Request title or its description.

### Recipes

- **Deployed or made in the org?** Find the backup commit that shows the change here: the change happened between the previous backup and that one. Then look for a commit of the deployment branch in that window that touches the same component: `git -C ../<name> log origin/<branch> --since=<previous backup> --until=<this backup> --format="%H %ci %s" -- <path of the component in the package directory>`. One found: it came through the CI/CD pipeline, name its Pull Request. None found: it was probably made directly in the org. Say "probably", and point to the Setup Audit Trail for who did it.
- **Which Pull Request brought this version?** `git -C ../<name> log origin/<branch> --first-parent --format="%H %ci %s" -- <path>` gives the merges that touched the component, newest first.
- **Repository and org differ?** Compare a file of the deployment branch with the same file here: `git -C ../<name> show origin/<branch>:<path>` against `force-app/main/default/<same path>`. Before calling it a drift, check that the item is in the `manifest/package.xml` of the deployment branch (otherwise the pipeline never deploys it), that it is not in `package-no-overwrite.xml` or `packageDeployOnChange.xml`, and that the backup does not skip it.

### Git server access

The git server of each repository comes from its URL: `github.com` is GitHub, a host with `gitlab` in its name is GitLab (often self-hosted), `dev.azure.com` or `*.visualstudio.com` is Azure DevOps, `bitbucket.org` is Bitbucket Cloud. The URL of this repository is `git remote get-url origin`. Jenkins has no standard API: ask the user for the logs.

Credentials, in this order:

1. A command line tool the user is already logged in with: `gh auth status`, `glab auth status`, `az account show` (with the `azure-devops` extension). Use it as is.
2. Otherwise, a `.env` file at the root of this repository (git ignores it). Load it into the environment of your commands only, for example `set -a; . ./.env; set +a`, and use the variables by name in the commands, never their value. The variable names are the ones sfdx-hardis uses:
   - GitHub: `CI_SFDX_HARDIS_GITHUB_TOKEN` or `GITHUB_TOKEN`
   - GitLab: `CI_SFDX_HARDIS_GITLAB_TOKEN` or `ACCESS_TOKEN`
   - Azure DevOps: `CI_SFDX_HARDIS_AZURE_TOKEN` or `SYSTEM_ACCESSTOKEN`
   - Bitbucket: `CI_SFDX_HARDIS_BITBUCKET_TOKEN`, with `CI_SFDX_HARDIS_BITBUCKET_EMAIL` when the token is an Atlassian account API token
3. Neither: tell the user which login or which variable is missing, and answer with what git alone shows.

Read-only calls for the pipelines and the Pull Requests. `<branch>` is the deployment branch for the deployment repository, and the current branch for this one:

- **GitHub**
  - Runs: `gh run list -R <owner>/<repo> --branch <branch> --limit 20`, then `gh run view <run id> -R <owner>/<repo> --log-failed`
  - Pull Requests: `gh pr list -R <owner>/<repo> --base <branch> --state merged --limit 30`, `gh pr view <number> -R <owner>/<repo> --comments`
  - Without `gh`: `curl -H "Authorization: Bearer $GITHUB_TOKEN" "https://api.github.com/repos/<owner>/<repo>/actions/runs?branch=<branch>&per_page=20"`, then `/actions/runs/<run id>/jobs` and `/actions/jobs/<job id>/logs`
- **GitLab** (`<project>` is the URL-encoded path, like `group%2Fproject`)
  - Pipelines: `glab api "projects/<project>/pipelines?ref=<branch>&per_page=20"`, then `projects/<project>/pipelines/<id>/jobs` and `projects/<project>/jobs/<job id>/trace`
  - Merge Requests: `glab mr list -R <group>/<project> --merged --target-branch <branch>`, `glab mr view <number> -R <group>/<project> --comments`
  - Without `glab`: the same API paths with `curl -H "PRIVATE-TOKEN: $CI_SFDX_HARDIS_GITLAB_TOKEN" "https://<gitlab host>/api/v4/..."`
- **Azure DevOps**
  - Runs: `az pipelines runs list --org https://dev.azure.com/<org> --project <project> --branch <branch> --top 20`, `az pipelines runs show --org ... --project ... --id <id>`
  - Logs: `curl -u ":$CI_SFDX_HARDIS_AZURE_TOKEN" "https://dev.azure.com/<org>/<project>/_apis/build/builds/<id>/logs?api-version=7.1"`, then `.../logs/<log id>?api-version=7.1`
  - Pull Requests: `az repos pr list --org ... --project ... --repository <repo> --target-branch <branch> --status completed`
- **Bitbucket Cloud** (`Authorization: Bearer $CI_SFDX_HARDIS_BITBUCKET_TOKEN`, or `-u "$CI_SFDX_HARDIS_BITBUCKET_EMAIL:$CI_SFDX_HARDIS_BITBUCKET_TOKEN"` with an account API token)
  - Pipelines: `https://api.bitbucket.org/2.0/repositories/<workspace>/<repo>/pipelines/?sort=-created_on&pagelen=50`, keep the ones whose `target.ref_name` is `<branch>`, then `.../pipelines/<uuid>/steps/` and `.../pipelines/<uuid>/steps/<step uuid>/log`
  - Pull Requests: `https://api.bitbucket.org/2.0/repositories/<workspace>/<repo>/pullrequests?state=MERGED&q=destination.branch.name="<branch>"`

In the logs of this repository, the job that runs `sf hardis:org:monitor:backup` explains a missing or failed backup, and the job that runs `sf hardis:org:monitor:all` explains a missing check. In the deployment repository, the deployment jobs run `sf hardis:project:deploy:smart`.

## Monitoring results in Grafana

{{grafanaStatus}}

The results of the monitoring checks are not stored in this repository. When the pipeline sets `NOTIF_API_URL` and `NOTIF_API_METRICS_URL`, every notification of the backup and of `sf hardis:org:monitor:all` is also sent to Grafana: one JSON log line to Loki with the whole report, and its numbers to Prometheus. The CI/CD pipeline of the deployment repository sends each deployment there too. That is the day by day history of the org, and what the [Org Monitoring by sfdx-hardis dashboards](https://sfdx-hardis.cloudity.com/salesforce-monitoring-grafana-v2/) display. Use it for questions like:

- How did the API requests usage evolve over the last three months? Which limit is closest to its maximum?
- On which days did Apex errors spike, and which classes caused them? Which Flows fail the most this week?
- When will the data storage be full at the current pace?
- Which users have not logged in for six months? Which licenses are unused?
- What did the last Security Health Check report, and how did the score evolve?
- Which deployments reached this org this month, and did they succeed?
- Did the backup run every night this month?
- Which other monitored orgs have this package installed, or more Apex errors than this one?

### Connect

1. **Grafana instance**: the `GRAFANA_API_URL` environment variable, else `grafanaUrl` in `.sfdx-hardis.yml` (see above). Below, `$GRAFANA_API_URL` stands for that URL, without a trailing `/`.
2. **Token**: a Grafana tool you already have (a Grafana MCP server) needs nothing more. Otherwise use the `GRAFANA_API_TOKEN` environment variable, or the same name in the `.env` file at the root of this repository, loaded as described for the git providers. A service account token with the **Viewer** role is enough. When the instance restricts data source permissions, the service account also needs the **Query** permission on the Loki and Prometheus data sources (**Connections** > **Data sources** > the data source > **Permissions**): without it, calls answer `Access denied to datasource`. The token never goes in `.sfdx-hardis.yml`.
3. **No token**: tell the user they can create a service account token with the Viewer role (Grafana: **Administration** > **Users and access** > **Service accounts**) and put it as `GRAFANA_API_TOKEN` in `.env`, then answer without Grafana. Do not reuse the `NOTIF_API_*` credentials of the pipeline: they are CI secrets, usually allowed to write only.

Only send `GET` requests. Queries hold `{`, `"` and `|`, so let curl encode them:

```sh
curl -sG -H "Authorization: Bearer $GRAFANA_API_TOKEN" "$LOKI/query_range" \
  --data-urlencode 'query={source="sfdx-hardis", orgIdentifier="acme", type="ORG_LIMITS"} | json t="_title" | line_format "{{.t}}" | keep type' \
  --data-urlencode 'start=2026-09-01T00:00:00Z' --data-urlencode 'limit=10'
```

### Find the datasources

Use `grafanaLokiDatasourceUid` and `grafanaPrometheusDatasourceUid` from `.sfdx-hardis.yml` when they are set. Otherwise call `GET $GRAFANA_API_URL/api/datasources`: it lists only the datasources the token can query. Keep the ones of type `loki` and `prometheus`, leaving out the Grafana Cloud internal ones (`alert-state-history`, `usage-insights`, `ml-metrics` or `usage` in the uid). On Grafana Cloud they are usually `grafanacloud-logs` and `grafanacloud-prom`: try them first. When several remain, keep the one where `count(last_over_time({source="sfdx-hardis"}[2d]))` (Prometheus, `/query`) or `sum(count_over_time({source="sfdx-hardis"}[1d]))` (Loki, `/query`) returns data. A datasource that answers an error, like `Invalid data source URL`, is not the one. When none has sfdx-hardis data, the token probably lacks the Query permission: tell the user (see above). Offer to write the two uids in `.sfdx-hardis.yml`, so the next agent skips this step.

Below, `$LOKI` stands for `$GRAFANA_API_URL/api/datasources/proxy/uid/<loki uid>/loki/api/v1` and `$PROM` for `$GRAFANA_API_URL/api/datasources/proxy/uid/<prometheus uid>/api/v1`.

### Find this org

Every log line and metric has a `gitIdentifier` label: `<repository name>/<branch>` of the job that sent it. For this branch, it is the last part of `git remote get-url origin` without `.git`, a `/`, then `git branch --show-current`. Get the `orgIdentifier` from it:

```sh
curl -sG -H "Authorization: Bearer $GRAFANA_API_TOKEN" "$PROM/label/orgIdentifier/values" \
  --data-urlencode 'match[]={source="sfdx-hardis", gitIdentifier="acme-monitoring/monitoring_acme__uat_sandbox"}'
```

If that returns nothing, the `orgIdentifier` is usually `instanceUrl` of `.sfdx-hardis.yml` without `https://` and `.my.salesforce.com`, dots replaced by `__`: `https://acme--uat.sandbox.my.salesforce.com` gives `acme--uat__sandbox`. The pipeline can override it with `SFDX_HARDIS_MONITORING_KEY`, so check it exists in `GET $PROM/label/orgIdentifier/values`. Query all the orgs of this repository the same way, with the other branches of `git branch -r`.

Which checks send data for this org, and how many lines in 30 days: `GET $LOKI/query` with `query=sum by (type) (count_over_time({source="sfdx-hardis", orgIdentifier="acme"}[30d]))`. An org monitored by the backup only sends `BACKUP`.

### What is sent

Labels, on logs and metrics:

- `source`: always `sfdx-hardis`
- `orgIdentifier`: the monitored org (see above)
- `type`: the notification type. The `notificationTypes` of the checks listed below, plus `BACKUP` (each backup), `MONITORING_SUMMARY` (each run of the checks) and `DEPLOYMENT` (each deployment by the CI/CD pipeline, its `gitIdentifier` is then the deployment repository and branch)
- `severity` (logs only): `critical`, `error`, `warning`, `info`, `success` or `log`
- `gitIdentifier`: `<repository name>/<branch>` of the job that sent it

Grafana Cloud adds `service_name` and `detected_level`: ignore them.

**Log lines** are JSON documents: `_title` (one line summary), `_logBodyText` (the notification text), `_logElements` (the rows of the report, cut at 500 rows, then `_logElementsTruncated` is true), `metric` (the main value), `_metrics`, `_jobUrl` (the CI job that sent it) and `_dateTime`. Some types add their own fields: `topFailingApex` (`APEX_ERROR`), `topFailingFlows` and `topFailingSteps` (`FLOW_ERROR`), `installedPackages` (`BACKUP`), `licenses` (`LICENSES`), `limits` (`ORG_LIMITS`), `entitlements` (`USAGE_ENTITLEMENTS`), `healthScoreDetails` (weekly `MONITORING_SUMMARY` only). To know the fields of a type, read one line of it with `limit=1`.

**Metrics**: each key of `_metrics` gives `<Key>_metric`, plus `<Key>_percent`, `<Key>_max` and `<Key>_min` when the key has these values (`ORG_LIMITS` gives `DailyApiRequests_metric`, `DailyApiRequests_max` and `DailyApiRequests_percent`). With a Prometheus Pushgateway instead of Grafana Cloud, the main value is `<Key>` without `_metric`. Key names mix cases (`ApexErrors`, `unusedApexClasses`, `UNUSED_USERS`): list them instead of guessing, with `GET $PROM/label/__name__/values` and `match[]={source="sfdx-hardis", type="ORG_LIMITS", orgIdentifier="acme"}`.

**Personal data**: when the checks run in CI, the user fields of their reports (username, email, first and last name, user Id) are pseudonymized, like `user_ee329d2dc7` or `id_219ea85aee`. Never try to find who is behind an alias. Other text is sent as is, like the commit authors in a `DEPLOYMENT` line, and by default the users who made the Setup Audit Trail actions: auditing needs their names.

### Query rules

- **Metrics arrive once a day.** A plain selector looks back 5 minutes only and returns nothing: wrap it in a range function. `last_over_time(...[2d])` for the current value (`[8d]` for the weekly health score, longer for checks that run weekly or monthly, see the frequency in the checks table), `max_over_time(...[30d])` for a peak, and `last_over_time(...[1d])` with `query_range` and `step=1d` for a daily history.
- **A daily point is dated the day after.** With `last_over_time(...[1d])` and `step=1d`, the point at `2026-09-23T00:00:00Z` holds the value sent during 2026-09-22. And the checks run at night on the day before: `ApexErrors` sent on 2026-09-22 counts the errors of 2026-09-21 (the `_title` of the log line says "over the last 1 day(s)"). Say which day you mean.
- **Windows and ranges are capped.** On Grafana Cloud, a range function window (`[30d]`) cannot exceed 32 days (`err-mimir-max-query-length`). For a longer period, use `query_range` with `step=1d` over the whole period, and compute the peak or average from the points: metrics are kept about 13 months.
- **Logs are kept about a month.** Loki refuses a query longer than 30 days (`the query time range exceeds the limit`) or older than 31 days. A calendar month from midnight to midnight is already too long: for "the last month" or "the last 30 days", pass a `start` 29 days ago at `00:00:00Z` and no `end` (it defaults to now). For an older period, use the metrics.
- **Always pass `start` to Loki**: without it, a query only reads the last hour, and label values the last 6 hours. `start` and `end` take RFC 3339 dates in UTC, like `2026-09-01T00:00:00Z`, on both APIs. A log query that does not select an org can hit the 500 streams limit: add `orgIdentifier`, or count with `sum(count_over_time(...))`.
- **Keep only `.data.result`** of the answers (with `jq` or `node`): Loki adds a `stats` object that is often bigger than the result.
- **A log line can weigh hundreds of KB** (a day with thousands of Apex errors). Never pull raw lines over a range. Extract the fields you need with `| json a="field" | line_format "{{.a}}" | keep type`, and use `limit=1` for the latest report. `keep type` stops Loki from copying the extracted fields into the labels of each result. The rows of one report can still be large (hundreds of users or errors): save the answer to a file under `hardis-report/` and filter it there, rather than reading it whole.
- **A metric can exist without its log line.** Loki refuses a line bigger than its size limit (256 KB on Grafana Cloud), which happens on days with thousands of errors: the numbers are in Prometheus, the rows and the `topFailing*` fields are lost. Say so, and give the numbers.
- **No data is not zero.** When a query returns nothing, check the org, the metric name and the time range before answering, and say that there is no data.

### Grafana recipes

Replace `acme` with the `orgIdentifier`. `$PROM/query` returns one value, `$PROM/query_range` with `start`, `end` and `step=1d` a daily history. `$LOKI/query_range` with `start` and `limit` returns lines, `$LOKI/query` counts lines.

Limits and capacity:

- The 10 most used limits: `topk(10, max by (__name__) (last_over_time({__name__=~".+_percent", source="sfdx-hardis", type="ORG_LIMITS", orgIdentifier="acme"}[2d])))`
- History of one limit, with `query_range`: `max(last_over_time(DailyApiRequests_percent{source="sfdx-hardis", orgIdentifier="acme"}[1d]))`. Its peak over 30 days: `max(max_over_time(DailyApiRequests_percent{source="sfdx-hardis", orgIdentifier="acme"}[30d]))`. Over three months, take the highest point of the daily history instead.
- Days until the data storage is full, at the pace of the last 30 days: `(100 - last_over_time(DataStorageMB_percent{source="sfdx-hardis", orgIdentifier="acme"}[2d])) / clamp_min(deriv(DataStorageMB_percent{source="sfdx-hardis", orgIdentifier="acme"}[30d]) * 86400, 0.000001)`. A huge result means it does not grow. Same with `FileStorageMB_percent`.

Errors:

- Apex errors per day, with `query_range`: `max(last_over_time(ApexErrors_metric{source="sfdx-hardis", orgIdentifier="acme"}[1d]))`, and `FlowErrors_metric` for Flows. This week against the previous one: `sum(sum_over_time(ApexErrors_metric{source="sfdx-hardis", orgIdentifier="acme"}[7d])) - sum(sum_over_time(ApexErrors_metric{source="sfdx-hardis", orgIdentifier="acme"}[7d] offset 7d))`
- The classes behind the errors, day by day: `{source="sfdx-hardis", orgIdentifier="acme", type="APEX_ERROR"} | json n="metric", top="topFailingApex" | line_format "{{.n}} errors, top: {{.top}}" | keep type`. For Flows, `topFailingFlows` and `topFailingSteps` of `FLOW_ERROR`.
- The days a class or a message appears in the error reports: `{source="sfdx-hardis", orgIdentifier="acme", type="APEX_ERROR"} |= "InvoiceService" | json t="_title" | line_format "{{.t}}" | keep type`, then read the `_logElements` of one of these days for the stack traces.
- Everything that went wrong recently: `{source="sfdx-hardis", orgIdentifier="acme", severity=~"error|critical"} | json t="_title" | line_format "{{.t}}" | keep type`

Latest report of a check, with its rows: `{source="sfdx-hardis", orgIdentifier="acme", type="UNUSED_USERS"} | json t="_title", e="_logElements" | line_format "{{.t}} {{.e}}" | keep type` with `limit=1`. It works for every type: `LICENSES`, `ORG_HEALTH_CHECK`, `AUDIT_TRAIL`, `UNSECURED_CONNECTED_APPS`, `RELEASE_UPDATES`... For inactive users, `UNUSED_USERS` covers every license, `UNUSED_USERS_CRM_6_MONTHS` and `UNUSED_USERS_EXPERIENCE_6_MONTHS` split internal and Experience Cloud users. A report cut at 500 rows cannot be compared row by row with another one: compare their counts.

Scores and trends (other names: list them, see above):

- Health score and its sub-scores, computed weekly: `max by (__name__) (last_over_time({__name__=~"HealthScore.*_metric", source="sfdx-hardis", orgIdentifier="acme"}[8d]))`. The reasons are only on the weekly `MONITORING_SUMMARY` line, with a `start` 8 days ago: `{source="sfdx-hardis", orgIdentifier="acme", type="MONITORING_SUMMARY"} |= "healthScoreDetails" | json d="healthScoreDetails" | line_format "{{.d}}" | keep type` with `limit=1`.
- Metrics the dashboards use: `ApexTestsCodeCoverage_metric`, `Score_metric` and `HighRisk_metric` (Security Health Check), `SuspectMetadataUpdates_metric` (audit trail), `ACTIVE_USERS_CRM_WEEKLY_metric`, `UNUSED_USERS_CRM_6_MONTHS_metric`, `unusedApexClasses_metric`, `MetadatasWithoutDescription_metric`, `AiUsageCreditsTotal_metric`, `deploymentsTotal_metric`, `deploymentSuccessRate_metric`, `DoraLeadTimeDays_metric`.

Backups, checks and deployments:

- Did the backup run every night, with `$LOKI/query_range` and `step=1d`: `sum(count_over_time({source="sfdx-hardis", orgIdentifier="acme", type="BACKUP"}[1d]))`. A day missing from the result had no backup: the backup sends no notification when it fails, so the pipeline logs of this repository say why.
- Checks that failed in the last week: `max(max_over_time(CommandsFailed_metric{source="sfdx-hardis", orgIdentifier="acme"}[7d]))`. Which ones is only in the pipeline logs.
- Deployments to this org: `{source="sfdx-hardis", orgIdentifier="acme", type="DEPLOYMENT"} | json t="_title", j="_jobUrl" | line_format "{{.t}} {{.j}}" | keep severity`. The `_logBodyText` of a deployment lists its deployment actions, its commits and the link of its Pull Request.

All the monitored orgs (leave out `orgIdentifier`):

- The orgs with the most Apex errors in 7 days: `topk(10, sum by (orgIdentifier) (sum_over_time(ApexErrors_metric{source="sfdx-hardis"}[7d])))`
- The orgs where a package is installed, with `$LOKI/query`: `sum by (orgIdentifier) (count_over_time({source="sfdx-hardis", type="BACKUP"} |= "\"SubscriberPackageNamespace\":\"FSL\"" [7d]))`. Match the namespace exactly, or the name with `|~ "\"SubscriberPackageName\":\"[^\"]*(?i:field service)"`: a bare word also matches the rest of the line. Each entry of `installedPackages` has `SubscriberPackageName`, `SubscriberPackageNamespace` and `SubscriberPackageVersionNumber`.
- The orgs that stopped sending data, with `$LOKI/query`: `(sum by (orgIdentifier) (count_over_time({source="sfdx-hardis"}[7d])) > 0) unless (sum by (orgIdentifier) (count_over_time({source="sfdx-hardis"}[36h])) > 0)`. The last day each org sent data, in one call, with `$LOKI/query_range`, `step=1d` and a `start` 7 days ago: `sum by (orgIdentifier) (count_over_time({source="sfdx-hardis"}[1d]))`, then take the last point of each series.

### Answer

- Give the values with their dates in UTC, and say which check they come from.
- Add the link of the dashboard that shows the answer, when the instance has them (`GET $GRAFANA_API_URL/api/search?folderUIDs=sfdx-hardis-v2`): `$GRAFANA_API_URL/d/<uid>?var-org=acme&from=now-30d&to=now`. The uids: `sfdx-hardis-v2-org-home` (overview of one org), `sfdx-hardis-v2-org-reliability` (Apex and Flow errors), `sfdx-hardis-v2-org-limits`, `sfdx-hardis-v2-org-devops` (deployments), `sfdx-hardis-v2-org-security`, `sfdx-hardis-v2-org-debt` (technical debt, test coverage), `sfdx-hardis-v2-org-adoption` (users, licenses), `sfdx-hardis-v2-org-usage` (AI credits, consumption), `sfdx-hardis-v2-dtl-indicator` (any metric, with `var-type` and `var-metric`), `sfdx-hardis-v2-fleet` (all the orgs).

## Files and folders

| Path | Content |
| ---- | ------- |
| `force-app/main/default/` | The metadata of the org, in Salesforce DX source format: one folder per metadata type (`objects/`, `classes/`, `triggers/`, `flows/`, `lwc/`, `aura/`, `permissionsets/`, `profiles/`, `layouts/`...). This is the backup. Files are added and updated, never deleted: a component deleted in the org stays here. |
| `installedPackages/` | One JSON file per package installed in the org: name, namespace, version name and number. |
| `manifest/package-all-org-items.xml` | Every metadata item that exists in the org, including the ones that are not backed up. Use it to check if a component exists in the org. |
| `manifest/package-backup-items.xml` | The items actually retrieved: the full list, minus the filters below. |
| `manifest/package-skip-items.xml` | Filters maintained by hand: the types or members never retrieved. Sensitive types (`AuthProvider`, `Certificate`, `ConnectedApp`) are there by default. |
| `manifest/package-skip-items-dynamic-do-not-update-manually.xml` | Filters built from the `MONITORING_BACKUP_SKIP_METADATA_TYPES` variable, when it is set. |
| `manifest/package-backup-datacloud-items.xml` | Data Cloud items (`__dlm`, `__dll` objects and Data Cloud metadata types), retrieved in a separate call. |
| `manifest/chunks/` | Only in full mode (`--full`): the list of items split in several retrieves. |
| `docs/` | Project documentation generated from the metadata after each backup, unless disabled: objects, Apex, Flows with their visual history (`docs/flows/*-history.md`), Lightning pages, profiles, permission sets, packages, and an object model diagram. |
| `mkdocs.yml` | Menu and settings of the documentation site built from `docs/`. |
| `.sfdx-hardis.yml` | sfdx-hardis configuration of the branch: monitored org, notification settings, custom `monitoringCommands` and `monitoringDisable`, the `deploymentRepository` (and optional `deploymentBranch`) that deploys to the org, and the `grafanaUrl` (and optional datasource uids) that receives the monitoring results. Never a secret. |
| `sfdx-project.json` | Salesforce DX project definition, including the API version used for the retrieve. |
| `.gitlab-ci.yml`, `.github/workflows/`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`, `Jenkinsfile` | The monitoring pipeline for each CI/CD platform. Only one of them is used. On GitHub, the workflow lives on the default branch and runs all monitoring branches. |
| `.mega-linter.yml`, `.jscpd.json` | MegaLinter and copy-paste detection settings. |
| `THIS_IS_MONITORING`, `DO_NOT_DEPLOY_FROM_THIS_REPO` | Empty marker files: this repository is for monitoring only. |

## What is not in the backup

- **Data**: no records, only metadata.
- **Managed packages content**: items with the namespace of an installed package are skipped. Their name and version are in `installedPackages/`.
- **Standard objects without custom fields**, and standard members named `standard__*`.
- **Sensitive metadata**: certificates, auth providers, connected apps (see `manifest/package-skip-items.xml` and `.gitignore`).
- **Anything added to `manifest/package-skip-items.xml`** by the team, often to avoid a retrieve that fails or takes too long.

If a component is in `manifest/package-all-org-items.xml` but not in `force-app/`, one of these filters skipped it.

The other way around, a component in `force-app/` but not in `manifest/package-all-org-items.xml` was deleted from the org: the backup never deletes files. To know whether a component exists in the org today, always check the manifest.

## Monitoring checks configured on this branch

`sf hardis:org:monitor:all` runs these checks, each at its own frequency. This list merges the defaults of sfdx-hardis with the `monitoringCommands` and `monitoringDisable` settings of `.sfdx-hardis.yml`.

{{monitoringCommandsTable}}

## Rules for coding agents

- Never deploy anything from this repository to an org.
- Do not edit the files under `force-app/`, `manifest/package-all-org-items.xml`, `manifest/package-backup-items.xml`, `installedPackages/` or `docs/`: the next backup overwrites them.
- Changes worth making here are configuration: `manifest/package-skip-items.xml`, `.sfdx-hardis.yml`, the pipeline file. They apply to the branch they are committed on, so to one org.
- To answer "what does this org do", read the sources in `force-app/main/default/` first, then the generated `docs/` when present. Before describing a component, check that it is still in `manifest/package-all-org-items.xml`.
- Only read the deployment repository and the git servers. Never commit, push, check out a branch in the local clone of the deployment repository, create a branch, comment, approve or merge a Pull Request, start, retry or cancel a pipeline, or change a variable or a setting of either repository.
- Only read Grafana: never create, change or delete a dashboard, an alert rule, a silence, a datasource or a service account.
- Never print a token, and never write one in a file or in an answer.

## Documentation

- [Monitoring overview](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/)
- [Metadata backup](https://sfdx-hardis.cloudity.com/salesforce-monitoring-metadata-backup/)
- [Monitoring configuration](https://sfdx-hardis.cloudity.com/salesforce-monitoring-config-home/)
- [Grafana dashboards](https://sfdx-hardis.cloudity.com/salesforce-monitoring-grafana-v2/)

<!-- markdownlint-enable MD013 -->
<!-- sfdx-hardis-monitoring-agents-end -->
