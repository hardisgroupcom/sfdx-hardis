---
title: Validate a merge request on a Salesforce CI/CD project
description: Learn how to validate a merge request on a Salesforce CI/CD project
---
<!-- markdownlint-disable MD013 -->

- [Conflicts](#conflicts)
- [Control jobs](#control-jobs)
  - [Check deploy job](#check-deploy-job)
  - [Code Quality job](#code-quality-job)
- [Merge the Pull Request / Merge Request](#merge)
  - [Pre-deployment actions](#pre-deployment-actions)
  - [Effective merge](#effective-merge)
  - [Post-deployment actions](#pre-deployment-actions)

___

## Conflicts

_This section must be managed by team members with git knowledge_

If elements has been modified in another branch, you need to manage conflicts before being able to merge.

- Merge conflicts then commit and push your updates, it will trigger again the control job with the new branch state.

This video shows how to merge conflicts with Visual Studio Code.

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/lz5OuKzvadQ" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>

In case conflicts are too complicated to manage (like on a Flow for example), you need to:

- Retrofit the new version of the flow in your branch (that will overwrite your updates)
- Sfdx Push it to your source-tracked sandbox or scratch org
- Make again the updates in the Salesforce Setup
- Sfdx Pull the updated version in your local branch
- Git Commit & Push to your branch

___

## Control jobs

Each merge request runs automatically the control jobs that will insure that the future deployment with be valid.

___

### Check deploy job

See [Handle Deployment errors](salesforce-ci-cd-solve-deployment-errors.md)

___

### Code Quality job

See [Handle MegaLinter errors](salesforce-ci-cd-solve-megalinter-errors.md)

___

## Merge

_Depending on the project organization, this action can be allowed only to Release managers, or to more team members_

If there are no conflicts and if all control jobs are in success, you can proceed to the merge of the merge request.

___

### Pre deployment actions

If pre-deployment actions are required, perform them before clicking on the button to merge the Merge Request / Pull Request

Pre-deployment actions can usually be found in README.md

**IMPORTANT**: If **Custom Profiles** are deployed for the **first time**, you MUST **create them manually** in target org, by **cloning them from "Minimal access" Profile**

___

### Effective merge

- **Click on Merge**
  - If the merge request is from a **minor branch** (dev or config task), make sure that **Squash commits** and **Delete after merge** are **checked**
  - If the merge request if from a major branch (develop, recette, uat, preprod...), make sure that **Squash commits** and **Delete after merge** are **NOT checked**

- The merge commit in the target branch will **trigger a new job** that will automatically **deploy the updated source to the corresponding Salesforce org**

___

### Post deployment actions

If post-deployment actions are required, perform them before clicking on the button to merge the Merge Request / Pull Request

Post-deployment actions can usually be found in README.md