---
title: Configure CI Server authentication to Salesforce orgs
description: Learn how to configure CI Server authentication to automate deployments
---
<!-- markdownlint-disable MD013 -->

## Major orgs

To automate [deployments from major branches to their related org](salesforce-ci-cd-deploy-major-branches.md), you need to **configure the secure authentication from CI server to a SF connected app**.

Note: _You need [openssl](https://www.openssl.org/) installed on your computer (available in `Git bash`)_

- Remain in your initialization branch `cicd`
- For each major branch to link to an org, run the sfdx-hardis command **Configuration -> Configure Org Ci Authentication**

Or the command line version:

```shell
sfdx hardis:project:configure:auth
```

For example, run the following command to configure integration, uat, preprod and production major branches.

_Note: If you have errors in your apex tests classes, you may not be able to configure the app for Production org. You will need do create the connected app manually by following the instructions in yellow in the error message. You can do it later, after having succeeded to merge the first merge request in lower major branch (usually `integration`)_

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/OzREUu5utVI" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

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


