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

> ![Under the hood](assets/images/engine.png) **_Under the hood_**
>
> This command will create/update:
>
> - .sfdx-hardis.yml configuration file (repo)
> - Self signed certificate (encrypted in repo as .key)
> - Connected App (uploaded to org via metadata api)
> - CI environment variables (manually set in CI/CD server UIs)
>
> At runtime, we use [OAuth 2.0 JSON Web Tokens (JWT) bearer flow](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_auth_jwt_flow.htm) with the client Id stored in secured CI/CD Variable + the Certificate decrypted on the fly using token stored in secured CI/CD variable.

See how to set CI variables on different Git providers:

- [Gitlab tutorial](salesforce-ci-cd-setup-auth-gitlab.md)
- [Azure tutorial](salesforce-ci-cd-setup-auth-azure.md)
- [GitHub tutorial](salesforce-ci-cd-setup-auth-github.md)
- [BitBucket tutorial](salesforce-ci-cd-setup-auth-bitbucket.md)
- [Jenkins tutorial](salesforce-ci-cd-setup-auth-jenkins.md)

## Dev Hub

If you are **using scratch orgs**, you need to also **configure authentication for the Dev Hub** (even if you already configured authentication for production org)

To do that, run the following command

```shell
sfdx hardis:project:configure:auth --devhub
```


