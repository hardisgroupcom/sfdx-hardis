---
title: Configure CI Server authentication to Salesforce orgs
description: Learn how to configure CI Server authentification to automate deployments
---
<!-- markdownlint-disable MD013 -->

## Major orgs

To automate [deployments from major branches to their related org](salesforce-ci-cd-deploy-major-branches.md), you need to **configure the secure authentication from CI server to a SF connected app**.

Note: _You need [openssl](https://www.openssl.org/) installed on your computer (available in `Git bash`)_

- For each branch to link to an org, run the following command and follow instructions

```shell
sfdx hardis:project:configure:auth
```

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


