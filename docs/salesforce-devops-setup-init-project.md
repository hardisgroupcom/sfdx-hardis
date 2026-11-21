---
title: Initialize the SFDX project for CI/CD
description: Learn how to initialize a Salesforce DX project for CI/CD with sfdx-hardis, and which workflow files to keep for your Git provider
---

<!-- markdownlint-disable MD013 -->

## Initialize the SFDX project

- Clone locally the [repository that you created in the previous step](salesforce-devops-setup-git.md) (or reuse an existing SFDX project repository)

- Create a new git branch named **cicd** under your lowest major branch (usually **integration**)

- Run the command **Configuration ->** ![Create new sfdx project](assets/images/btn-create-project.jpg) (`sf hardis:project:create`) and select the options to create a new sfdx-hardis project

> Use the sfdx-hardis command to create the new project, not the default Salesforce one.

- Open the file **manifest/package.xml** and replace its content with the following code

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
<version>65.0</version> <!-- use the current Salesforce API version -->
</Package>
```

- If you use GitLab CI and sandboxes only (no scratch orgs), open **gitlab-ci-config.yml** at the root of the repository and set the variable **USE_SCRATCH_ORGS** to `"false"`

- With GitHub, Azure, Bitbucket or Jenkins, the scratch org jobs (create a scratch org or take one from the scratch org pool, run the Apex tests on it, delete it) are off by default: set the variable **USE_SCRATCH_ORGS** to `"true"` to run them. To keep scratch orgs ready in a pool, see [Set up a scratch org pool](salesforce-devops-setup-scratch-org-pool.md).

- Depending on your Git provider, keep the related workflow files and delete the others

  - GitLab
    - `gitlab-ci.yml`
    - `gitlab-ci-config.yml`
  - Azure
    - `azure-pipelines-checks.yml`
    - `azure-pipelines-deployment.yml`
    - `azure-pipelines-scratch-pool.yml` (only if you use a scratch org pool)
    - `azure-pipelines-major-branch-check.yml` (only if you use the [major branch deployment check](salesforce-devops-setup-major-branch-check.md))
  - GitHub
    - Folder `.github/workflows`
  - Bitbucket
    - `bitbucket-pipelines.yml`

- During the CI/CD setup, find the variable **SFDX_DISABLE_FLOW_DIFF** in the pipeline of your Git provider and set its value to **true**, to avoid generating too many Pull Request comments during the setup. At the end of the setup, set the variable back to false.

> Some workflow files contain additional configuration instructions: read the comments at the beginning of the files.

### Upgrade the CI/CD files

The CI/CD files are copied once, when the project is created: a new version of sfdx-hardis does not update them. Each one starts with the URL of the sfdx-hardis template it comes from, for example:

```yaml
# Source of this file: the sfdx-hardis default template
#   https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/ci/.gitlab-ci.yml
```

To upgrade a file, by hand or with a coding agent, compare it with the latest version of its template and bring in the changes, keeping what is specific to your project: branch names, secrets, runner tags, image, custom jobs. `.gitlab-ci-config.yml` holds the values of your project: only add its new keys. The [changelog](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/CHANGELOG.md) says what changed between versions.

## Cancelled pipelines

When a new commit is pushed on a Pull Request, the Git provider cancels the previous pipeline. Cancelling it does not stop its deployment simulation in the Salesforce org: Salesforce keeps it running, and the next simulations on the same org wait for it.

The GitLab, GitHub, Azure and Jenkins workflow files call [hardis:project:deploy:cancel](hardis/project/deploy/cancel.md) when a deployment simulation job is cancelled, so the simulation is cancelled in the org too. Only the simulation of the cancelled job is cancelled, never the one of another Pull Request, and never a real deployment.

This holds when each CI job runs in its own container, as in the default templates. When several jobs run at the same time on the same host without a container (GitLab shell executor, self-hosted GitHub or Azure runners) and share the same home folder, a cancelled job can cancel the simulation of another Pull Request.

| Git provider | Cancellation hook                                 | Requirement                                          |
|--------------|---------------------------------------------------|------------------------------------------------------|
| GitLab       | `after_script` when `CI_JOB_STATUS` is `canceled` | GitLab 17.0 or later, GitLab Runner 16.11 or later   |
| GitHub       | step with `if: cancelled()`                       | -                                                    |
| Azure        | step with `condition: canceled()`                 | -                                                    |
| Jenkins      | `post { unsuccessful }` of the Validation stage   | Pipeline: Job plugin 2.42 or later (`abortPrevious`) |
| Bitbucket    | Not available                                     | -                                                    |

Bitbucket runs no script when a step is stopped or times out (`after-script` only runs after a success or a failure), and a `final` step starts in a new container that cannot see the job id recorded by the stopped step. A simulation of a stopped Bitbucket step keeps running in the org until it ends.

On Jenkins, a new commit on a Pull Request aborts the build of the previous commit (`disableConcurrentBuilds(abortPrevious: env.CHANGE_ID != null)`), while the builds of the other branches wait for each other.

On GitLab, a new commit only cancels the previous pipeline while none of its non-interruptible jobs has started. To cancel its interruptible jobs in any case, uncomment the `workflow: auto_cancel: on_new_commit: interruptible` block at the beginning of `.gitlab-ci.yml` (GitLab 16.10 or later).

Real deployments, after a merge, are not cancelled by the next merge: they run one after the other.

**GitLab**: the `deploy_to_org` jobs of a branch share a resource group. GitLab runs the waiting jobs of a resource group in any order by default, so an older merge could be deployed after a newer one. Set the resource group to run them in pipeline order, once per major branch (`integration`, `uat`, `preprod`, `main`...):

```shell
curl --request PUT --header "PRIVATE-TOKEN: <your_access_token>" \
  --data "process_mode=oldest_first" \
  "https://gitlab.example.com/api/v4/projects/<project_id>/resource_groups/deploy-<branch>"
```

The resource group exists once a first `deploy_to_org` job of the branch has run.

**GitHub**: a workflow keeps only one waiting run per branch. When a third merge arrives while a deployment runs and a second one waits, the waiting run is cancelled before it starts. Its metadata is deployed by the newer run, but its pre-deployment and post-deployment actions are not run: run them by hand, or merge the Pull Requests one at a time.

If your project was created with an older version of sfdx-hardis, bring these parts into your workflow files: see [Upgrade the CI/CD files](#upgrade-the-cicd-files).

You can now go to step [4. Configure CI authentication](salesforce-devops-setup-auth.md).
