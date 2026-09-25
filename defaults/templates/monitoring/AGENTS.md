<!-- sfdx-hardis-monitoring-agents-start -->
<!-- This block is rewritten by sfdx-hardis at each monitoring backup. Write your own notes after the end marker, they are kept. -->

# Salesforce org monitoring repository (sfdx-hardis)

This repository is an [sfdx-hardis Org Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/) repository. It holds a nightly backup of the metadata of one or more Salesforce orgs, made by a scheduled CI/CD pipeline. Nobody develops in it and nothing is ever deployed from it.

Read this file before answering questions about the org, and answer from the files of the repository and from its git history.

## How it works

- **One git branch per monitored org.** Branch names usually look like `monitoring_<client>` for production and `monitoring_<client>__<sandbox>` for sandboxes. The branch you are on is the org you are looking at. Run `git branch -a` to list the other monitored orgs.
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
2. List the backup commits of the current branch in that range, newest first:

   ```sh
   git log --since="2026-01-01 00:00:00 +0000" --until="2026-01-31 23:59:59 +0000" --format="%H %s" -- manifest/package-all-org-items.xml force-app installedPackages
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

- One `##` section per backup commit, newest first, titled with its date and time in UTC.
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

### What the deployment repository holds

| Path | Content |
| ---- | ------- |
| `sfdx-project.json` | The package directories: the sources are there, not always in `force-app/`. |
| `config/.sfdx-hardis.yml` | Project configuration: project name, deployment settings, deployment actions. |
| `config/branches/.sfdx-hardis.<branch>.yml` | The org of each major branch (`instanceUrl`, `targetUsername`) and its own settings. |
| `manifest/package-no-overwrite.xml`, `manifest/packageDeployOnChange.xml` | Items never deployed once they exist in the org, or only when they change. A difference between the two repositories on these items is expected. |
| `manifest/destructiveChanges.xml` | Items deleted from the orgs by the deployments. |
| History of a major branch | Each merge into it is a Pull Request, deployed to the org of that branch by the pipeline. |

The Pull Request number is in the merge commit message: `Merge pull request #12` or `(#12)` on GitHub, `See merge request group/project!12` on GitLab, `Merged PR 12` on Azure DevOps, `(pull request #12)` on Bitbucket.

### Recipes

- **Deployed or made in the org?** Find the backup commit that shows the change here: the change happened between the previous backup and that one. Then look for a commit of the deployment branch in that window that touches the same component: `git -C ../<name> log origin/<branch> --since=<previous backup> --until=<this backup> --format="%H %ci %s" -- <path of the component in the package directory>`. One found: it came through the CI/CD pipeline, name its Pull Request. None found: it was probably made directly in the org. Say "probably", and point to the Setup Audit Trail for who did it.
- **Which Pull Request brought this version?** `git -C ../<name> log origin/<branch> --first-parent --format="%H %ci %s" -- <path>` gives the merges that touched the component, newest first.
- **Repository and org differ?** Compare a file of the deployment branch with the same file here: `git -C ../<name> show origin/<branch>:<path>` against `force-app/main/default/<same path>`. Before calling it a drift, check that the item is not in `package-no-overwrite.xml` or `packageDeployOnChange.xml`, and that the backup does not skip it.

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
| `.sfdx-hardis.yml` | sfdx-hardis configuration of the branch: monitored org, notification settings, custom `monitoringCommands` and `monitoringDisable`, and the `deploymentRepository` (and optional `deploymentBranch`) that deploys to the org. |
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
- Never print a token, and never write one in a file or in an answer.

## Documentation

- [Monitoring overview](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/)
- [Metadata backup](https://sfdx-hardis.cloudity.com/salesforce-monitoring-metadata-backup/)
- [Monitoring configuration](https://sfdx-hardis.cloudity.com/salesforce-monitoring-config-home/)
- [Grafana dashboards](https://sfdx-hardis.cloudity.com/salesforce-monitoring-grafana-v2/)

<!-- sfdx-hardis-monitoring-agents-end -->
