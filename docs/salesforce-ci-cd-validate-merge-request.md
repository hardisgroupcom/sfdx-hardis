---
title: Validate a merge request on a Salesforce CI/CD project
description: Learn how to validate a merge request on a Salesforce CI/CD project
---
<!-- markdownlint-disable MD013 -->

- [Conflicts](#conflicts)
- [Control jobs](#control-jobs)
  - [Check deploy job](#check-deploy-job)
  - [Code Quality job](#code-quality-job)
- [Merge the merge request](#merge-the-merge-request)

___

## Conflicts

_This section must be managed by team members with git knownledge_

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

### Check deploy job

This CI job **simulates a deployment to the target org** (corresponding to the target branch of the merge request)

- Simulate deployment of all metadatas
- Run **all local Apex test classes**: all **must be in success**, and with at least **75% of code coverage**

If there are errors, you need to either:

- Push a **new commit with updates solving the error**
- Perform **manual operations in the target org**, that can be:
  - Manual **activation of features** (ex: Account teams, State and country picklists...)
  - Manual **updates in setup** in case of renaming of API Names (which is a bad practice to avoid as much as possible :) )

Under each error, you may see [instructions to solve the error](https://hardisgroupcom.github.io/sfdx-hardis/deployTips/) in yellow.

- If there is no instruction, try to copy-paste the error in google
- If you are lost or are not sure of what you do, call your [release manager](salesforce-ci-cd-use.md#release-manager-guide)
- If your release manager is lost or is not sure of what he does, [post an issue](https://github.com/hardisgroupcom/sfdx-hardis/issues) or [call Cloudity](https://cloudity.com/) to ask for support

### Code Quality job

[MegaLinter](https://megalinter.io/latest/) is used to perform code quality and security checks in Salesforce CI/CD repositories.

It embeds [SAST tools](https://megalinter.io/latest/flavors/salesforce/) that check Apex, Aura, LWC, copy-pastes and security issues.

If you consider Apex issues to be false-positives, you may [disable some rules using annotations and comments](https://pmd.github.io/latest/pmd_userdocs_suppressing_warnings.html)

- Never use `@SuppressWarnings('PMD')`, always name the rule that you want to disable, because you do not want to disable all rules
- `//NOPMD` at the end of a line will make the issue ignored, but again use it only in case of false positive, never to "Publish more quickly", else you'll create [technical debt](https://en.wikipedia.org/wiki/Technical_debt).

___

## Merge the merge request

_Depending on the project organization, this action can be allowed only to Release managers, or to more team members_

If there are no conflicts and if all control jobs are in success, you can proceed to the merge of the merge request.

- **Click on Merge**
  - If the merge request is from a **minor branch** (dev or config task), make sure that **Squash commits** and **Delete after merge** are **checked**
  - If the merge request if from a major branch (develop, recette, uat, preprod...), make sure that **Squash commits** and **Delete after merge** are **NOT checked**

- The merge commit in the target branch will **trigger a new job** that will automatically **deploy the updated source to the corresponding Salesforce org**
