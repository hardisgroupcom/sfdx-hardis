---
title: Review and merge Pull Requests on a Salesforce CI/CD project
description: Learn how to review, validate and merge a Pull Request on a Salesforce CI/CD project using sfdx-hardis, from conflicts to control jobs and deployment actions
---
<!-- markdownlint-disable MD013 -->

## Review and merge Pull Requests

- [Conflicts](#conflicts)
- [Control jobs](#control-jobs)
  - [Check deploy job](#check-deploy-job)
  - [Code quality job](#code-quality-job)
- [Merge](#merge)
- [Deployment actions](#deployment-actions)
- [After the merge](#after-the-merge)

___

A contributor has [published a User Story](salesforce-ci-cd-publish-task.md) as a Pull Request (Merge Request on GitLab). Before you merge it, check that it has no conflicts, that the control jobs pass, and that its deployment actions are under control.

___

## Conflicts

_This section requires git knowledge._

If the same metadata has been modified in another branch that is already merged in the target branch, you need to solve the conflicts before you can merge.

Solve the conflicts, then commit and push: the control jobs run again on the new state of the branch.

The Salesforce CLI plugin [sf-git-merge-driver](https://github.com/jayree/sf-git-merge-driver) automatically solves many XML conflicts (Profiles, Permission Sets, custom labels...). It is part of the [recommended tools](salesforce-ci-cd-use-install.md) and can be activated from the VS Code SFDX Hardis extension.

This video shows how to solve conflicts with VS Code.

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/lz5OuKzvadQ" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>

When conflicts are too complicated to solve by hand (on a Flow, for example), proceed this way:

- Retrofit the version of the Flow from the target branch into your branch (this overwrites your updates)
- Push it to your source-tracked dev sandbox or scratch org
- Do your updates again in the Salesforce Setup
- Pull the updated Flow into your local branch (`sf hardis:scratch:pull`)
- Commit and push to your branch

___

## Control jobs

Each Pull Request automatically runs control jobs that check that the future deployment will be valid. A new commit on the branch runs them again.

___

### Check deploy job

This job runs `sf hardis:project:deploy:smart --check`: it simulates the deployment in the target org, runs the Apex tests, checks the code coverage, and posts the results as a Pull Request comment, with a visual diff of the updated Flows.

See [Handle deployment errors](salesforce-ci-cd-solve-deployment-errors.md) when it fails.

The job log ends with a short deployment summary (components, Apex tests, code coverage, duration). The complete deployment response is available in the job artifacts, in `hardis-report/deploy-result-<package label>.json`.

___

### Code quality job

This job runs [MegaLinter](https://megalinter.io/) on the sources of the branch.

See [Handle MegaLinter errors](salesforce-ci-cd-solve-megalinter-errors.md) when it fails.

___

## Merge

_Depending on the project organization, merging can be reserved to release managers, or allowed to more team members._

When there are no conflicts and all control jobs succeed, you can merge the Pull Request.

- **Click on Merge**
  - If the Pull Request comes from a **minor branch** (a dev or config User Story), make sure that **Squash commits** and **Delete source branch after merge** are **checked**
  - If the Pull Request comes from a **major branch** (integration, uat, preprod...), make sure that **Squash commits** and **Delete source branch after merge** are **NOT checked**

___

## Deployment actions

Contributors declare the steps that must happen around the deployment of their User Story as [deployment actions](salesforce-ci-cd-work-on-task-deployment-actions.md), from the VS Code SFDX Hardis extension (**DevOps Pipeline -> My Pull Request -> Deployment Actions** tab).

- **Automated actions** (run a command, import data with SFDMU, run an Apex script, publish an Experience Cloud site, schedule an Apex batch, remove items from package.xml) run by themselves in each org at deployment time. You have nothing to do.
- **Manual steps** appear as checkboxes in the **Deployment Actions** comment of the Pull Request. Perform them at the right moment (before or after the deployment, as described in the step), then tick the box so sfdx-hardis records them as done. See [Track what has been done](salesforce-ci-cd-work-on-task-deployment-actions.md#track-what-has-been-done).

**Reviewing the manual steps is part of reviewing the Pull Request.** A manual step will be replayed in uat, preprod and production, maybe months later, maybe by someone else. Read each one as if you did not know the project, and ask yourself: can I do this without asking the author anything? If the step does not say the **exact Setup path**, the **exact name of the item**, the **value to set** and **how to check it worked**, reject the Pull Request and ask for a [click by click description](salesforce-ci-cd-work-on-task-deployment-actions.md#write-the-instructions-click-by-click). A good rule to give the team: *describe the manual action as if it was for someone who does not know Salesforce at all.*

**IMPORTANT**: If **custom Profiles** are deployed for the **first time**, you MUST **create them manually** in the target org, by **cloning them from the "Minimal Access" Profile**.

___

## After the merge

The merge commit in the target branch **triggers the deployment job**, which runs `sf hardis:project:deploy:smart` and **deploys the updated sources to the Salesforce org associated with the target branch**.

When the check deploy job already validated the same content, the deployment reuses that validation (Quick Deploy) instead of deploying and testing everything again. See [Smart Deploy internals](salesforce-ci-cd-smart-deployment.md) for details.

The deployment result is posted as a Pull Request comment and sent to the configured notification channels. To promote the changes to the next major org, see [Deploy to major orgs](salesforce-ci-cd-deploy-major-branches.md).
