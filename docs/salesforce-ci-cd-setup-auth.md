---
title: Configure CI Server authentication to Salesforce orgs
description: Learn how to configure CI Server authentication to automate deployments
---
<!-- markdownlint-disable MD013 -->

## Major orgs

To automate [deployments from major branches to their related org](salesforce-ci-cd-deploy-major-branches.md), you need to **configure the secure authentication from CI server to a SF connected app**.

Note: _You need [openssl](https://www.openssl.org/) installed on your computer (available in `Git bash`)_

- Remain in your initialization branch `cicd`, or a sub branch of your lowest level major branch (usually `integration`)
- For each major branch to link to an org, run the sfdx-hardis command **Configuration ->** ![Configure Org CI Authentication](assets/images/btn-configure-ci-auth.jpg) (`sfdx hardis:project:configure:auth`)

For example, run the command for `integration`, `uat`, `preprod` and `production` major branches.

> If messages ask you to **run twice** the same command, it's **normal**, it's for technical reasons :)

> If you have **errors in your apex tests classes**, you may not be able to configure the app for Production org.
> You will need do **create the connected app manually by following the instructions** in yellow in the error message.
> You can do it later, after having succeeded to merge the first merge request in lower major branch (usually `integration`)

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/OzREUu5utVI" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

How to set CI variables on different Git providers:

- [Gitlab](https://docs.gitlab.com/ee/ci/variables/#for-a-project): Protect variables = false, Mask variables = true
- [Azure](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/variables?view=azure-devops&tabs=classic%2Cbatch): Set Variables in Pipeline -> Tab **Classic**
- [GitHub](https://docs.github.com/en/actions/security-guides/encrypted-secrets#creating-encrypted-secrets-for-a-repository)
- [BitBucket](https://support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets/#Secured-variables)

> ![Under the hood](assets/images/engine.png) **_Under the hood_**
>
> This command will create/update:
>
> - .sfdx-hardis.yml configuration file (repo)
> - Self signed certificate (encrypted in repo)
> - Connected App (uploaded to org via metadata api)
> - CI environment variables (manually set in CI/CD server UIs)

## Dev Hub

If you are **using scratch orgs**, you need to also **configure authentication for the Dev Hub** (even if you already configured authentication for production org)

To do that, run the following command

```shell
sfdx hardis:project:configure:auth --devhub
```


