---
title: Salesforce CI/CD with sfdx-hardis
description: Easy handling of Salesforce DX to use CI/CD & DevOps principles on your Salesforce projects
---
<!-- markdownlint-disable MD013 -->

- [Why choose sfdx-hardis?](#why-choose-sfdx-hardis)
  - [Because it is user-friendly](#because-it-is-user-friendly)
  - [Because it is powerful](#because-it-is-powerful)
  - [Because there are no license costs](#because-there-are-no-license-costs)
  - [Because it is widely adopted](#because-it-is-widely-adopted)
- [Get started](#get-started)
  - [Setup sfdx-hardis](#setup-sfdx-hardis)
  - [As a Contributor](#as-a-contributor)
  - [As a Release Manager](#as-a-release-manager)

___

## Why choose sfdx-hardis?

There are many ways to do DevOps with Salesforce. Each has its advantages and limitations, as shown in the following comparison table.

![](assets/images/devops-comparison.png){ align=center }

### Because it is user-friendly

![DevOps Pipeline](assets/images/sfdx-hardis-pipeline-view.gif)

- **Admins** can [build their pull requests](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-publish-task/) using the **VS Code extension** with clicks, no command line required.
- **Developers** understand what's happening under the hood with the **Salesforce CLI**, thanks to the **Advanced mode** in the UI.
- **Release Managers** can configure the CI/CD process using the **Visual DevOps Pipeline Builder**.
- **Project Managers** can follow application lifecycle management using sfdx-hardis **native integrations** with ticketing systems like **Jira** and **Azure Boards**.

### Because it is powerful

Advanced features make sfdx-hardis a credible alternative to expensive Salesforce DevOps tools:

- [**Delta Deployments**](salesforce-ci-cd-config-delta-deployment.md): Improve performance by deploying only updated metadata.
- [**Overwrite Management**](salesforce-ci-cd-config-overwrite.md): Define which metadata will never be overwritten if it already exists in the target org.
- [**Smart Apex Test Runs**](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/#smart-deployments-tests): If your pull request to a sandbox cannot break Apex tests, skip them to improve performance.
- [**Automated source cleaning**](salesforce-ci-cd-config-cleaning.md): Clean profiles of attributes that exist in permission sets, tidy flow element positions, and more.
- [**Integration with messaging platforms**](salesforce-ci-cd-setup-integrations-home.md): Receive detailed deployment notifications on **Slack**, **Microsoft Teams**, and email.
- Integration with **ticketing systems**: [**Jira**](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-jira/), [**Azure Boards**](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-azure-boards/), or [any other tool](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-generic-ticketing/).
- [**AI integration**](salesforce-deployment-assistant-home.md) to help resolve deployment issues (use Agentforce or direct calls to OpenAI, Anthropic, Gemini).

We provide **ready-to-use CI/CD pipeline workflows** for the following Git platforms, with the results of deployment simulation jobs posted as comments on pull requests:

- [GitLab](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/ci/.gitlab-ci.yml)
- [Azure](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/ci/azure-pipelines-checks.yml)
- [GitHub & Gitea](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/ci/.github/workflows/deploy.yml)
- [Bitbucket](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/ci/bitbucket-pipelines.yml)
- [Jenkins](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/ci/Jenkinsfile)

Pipelines can easily be adapted to other platforms like [TeamCity](https://www.jetbrains.com/teamcity/).

_Here is an advanced example of a Salesforce CI/CD pipeline that you can define using sfdx-hardis._
_You can define much simpler branch/org models to manage only RUN operations._

![](assets/images/ci-cd-schema-main.jpg){ align=center }

[![Questions/Answers](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-questions-answers.jpg)](https://nicolas.vuillamy.fr/what-devops-experts-want-to-know-about-salesforce-ci-cd-with-sfdx-hardis-q-a-1f412db34476)

### Because there are no license costs

As everything is **open source**, there are **no license costs**!

> In comparison, many Salesforce DevOps vendors charge more than 250€/user/month per contributor.

You can handle everything yourself, or ask [**Cloudity**](https://cloudity.com/) Professional Services for support.

### Because it is widely adopted

sfdx-hardis CI/CD is used in production by major companies around the world.

![](assets/images/sfdx-hardis-usage.png)

It is also featured in many conferences, blogs, and webinars.

_See the presentation of sfdx-hardis at Dreamforce!_

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/o0Mm9F07UFs" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

_See slides of the [Dreamforce '23 session](https://reg.salesforce.com/flow/plus/df23/sessioncatalog/page/catalog/session/1684196389783001OqEl){target=_blank}_

<iframe src="https://www.slideshare.net/slideshow/embed_code/key/qroQjoKmRUUjqx?hostedIn=slideshare&page=upload" width="714" height="600" frameborder="0" marginwidth="0" marginheight="0" scrolling="no"></iframe>

_See a detailed article on SalesforceDevOps.net_

[![](assets/images/article-cicd-salesforcedevopsnet.jpg)](https://salesforcedevops.net/index.php/2023/03/01/sfdx-hardis-open-source-salesforce-release-management/){target=_blank}

___

## Get started

### Setup sfdx-hardis

If you are comfortable with **Git**, **Salesforce CLI**, and **DevOps**, you can set up and use sfdx-hardis CI/CD on your own.

You can also contact us at [**Cloudity**](https://cloudity.com/). Our Professional Services team will be glad to assist you with:

- Technical setup and initialization from your existing Salesforce production org
- Release management strategy definition
- Training for your contributors and release managers
- Change management to accelerate DevOps adoption in your organization

Please read the [Setup Guide](salesforce-ci-cd-setup-home.md) to learn how to initialize and maintain a Salesforce CI/CD project.

### As a Contributor

Please read the [Contributor Guide](salesforce-ci-cd-use-home.md) to learn how to work on CI/CD projects as a **Business Analyst**, **Salesforce Administrator**, or **Salesforce Developer**.

### As a Release Manager

Please read the [Release Manager Guide](salesforce-ci-cd-release-home.md) to learn how to be a release manager on a Salesforce CI/CD project.



