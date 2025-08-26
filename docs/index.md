<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
<!-- markdownlint-disable MD034 -->

[![sfdx-hardis by Cloudity Banner](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/sfdx-hardis-banner.png)](https://sfdx-hardis.cloudity.com)

_Presented at_ [_Dreamforce 23_](https://reg.salesforce.com/flow/plus/df23/sessioncatalog/page/catalog/session/1684196389783001OqEl) _and [_Dreamforce 24!_](https://reg.salesforce.com/flow/plus/df24/sessioncatalog/page/catalog/session/1718915808069001Q7HH)_

[![Version](https://img.shields.io/npm/v/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
[![Downloads/week](https://img.shields.io/npm/dw/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
[![Downloads/total](https://img.shields.io/npm/dt/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
[![Docker Pulls](https://img.shields.io/docker/pulls/hardisgroupcom/sfdx-hardis)](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis/tags)
[![GitHub stars](https://img.shields.io/github/stars/hardisgroupcom/sfdx-hardis)](https://GitHub.com/hardisgroupcom/sfdx-hardis/stargazers/)
[![GitHub contributors](https://img.shields.io/github/contributors/hardisgroupcom/sfdx-hardis.svg)](https://gitHub.com/hardisgroupcom/sfdx-hardis/graphs/contributors/)
[![Mega-Linter](https://github.com/hardisgroupcom/sfdx-hardis/workflows/Mega-Linter/badge.svg?branch=main)](https://github.com/hardisgroupcom/sfdx-hardis/actions?query=workflow%3AMega-Linter+branch%3Amain)
[![Secured with Trivy](https://img.shields.io/badge/Trivy-secured-green?logo=docker)](https://github.com/aquasecurity/trivy)
[![License](https://img.shields.io/npm/l/sfdx-hardis.svg)](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

Sfdx-hardis is a Salesforce CLI Plugin, by [**Cloudity**](https://cloudity.com/) & friends, natively compliant with most Git platforms, messaging tools, ticketing systems and AI providers.

![Native Integrations](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/integrations.png)

It will allow you to:

- Do with simple commands what could be done manually in minutes/hours
- [Define a **ready to use CI/CD Pipeline** for your Salesforce project](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/)
- [**Backup Metadatas** and **monitor any Salesforce org**](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/)
- [Generate your **project documentation**](https://sfdx-hardis.cloudity.com/salesforce-project-documentation/), including AI-generated description and Flow Visual History

[_Please see the full list of commands in Online documentation_](https://sfdx-hardis.cloudity.com)

___

**sfdx-hardis** commands and configuration are best used with an UI in [**SFDX Hardis Visual Studio Code Extension**](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

[![VsCode SFDX Hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/extension-demo.gif)](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

___

_See Dreamforce presentation_

[![See Dreamforce presentation](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/play-dreamforce-session.png)](https://www.youtube.com/watch?v=o0Mm9F07UFs)

## Installation

<!-- installation.md start -->

### With IDE

You can install [Visual Studio Code](https://code.visualstudio.com/) extension [VsCode SFDX Hardis](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

Once installed, click on ![Hardis Group button](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/hardis-button.jpg) in VsCode left bar, and follow the additional installation instructions

[![Installation tutorial](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/play-install-tuto.png)](https://www.youtube.com/watch?v=LA8m-t7CjHA)

___

### As SFDX Plugin

#### Pre-requisites

- Install Node.js ([recommended version](https://nodejs.org/en/))
- Install Salesforce DX by running `npm install @salesforce/cli --global` command line

#### Plugin installation

```sh-session
sf plugins install sfdx-hardis
```

For advanced use, please also install dependencies

```sh-session
sf plugins install @salesforce/plugin-packaging
sf plugins install sfdx-git-delta
sf plugins install sfdmu
```

If you are using CI/CD scripts, use `echo y | sf plugins install ...` to bypass prompt.

___

### Docker

You can use sfdx-hardis docker images to run in CI

- Docker Hub

  - [**hardisgroupcom/sfdx-hardis:latest**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis) (with latest @salesforce/cli version)
  - [**hardisgroupcom/sfdx-hardis:latest-sfdx-recommended**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis) (with recommended @salesforce/cli version, in case the latest version of @salesforce/cli is buggy)

- GitHub Packages (ghcr.io)
  - [**ghcr.io/hardisgroupcom/sfdx-hardis:latest**](https://github.com/orgs/hardisgroupcom/packages) (with latest @salesforce/cli version)
  - [**ghcr.io/hardisgroupcom/sfdx-hardis:latest-sfdx-recommended**](https://github.com/orgs/hardisgroupcom/packages) (with recommended @salesforce/cli version, in case the latest version of @salesforce/cli is buggy)

_See [Dockerfile](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/Dockerfile)_

<!-- installation.md end -->

## Usage

```sh-session
sf hardis:<COMMAND> <OPTIONS>
```

## Events

<!-- events.md start -->

### London's Calling '25, London

Auto-generate your SF project Documentation site with open-source and Agentforce

![image](https://github.com/user-attachments/assets/9b99120c-b660-4f67-b734-793148ac9d00)

### Czech Dreamin '25, Prague

Auto-generate your SF project Documentation site with open-source and Agentforce, with [Mariia Pyvovarchuk](https://www.linkedin.com/in/mpyvo/)

![Czech Dreamin 2025](https://github.com/user-attachments/assets/fa7b7f12-6d6a-437c-badd-20a626bb2163)

### Trailblazer Admin Group '25, Lyon

Techs for Admins: Afterwork Salesforce Inspector Reloaded & sfdx-hardis, with Thomas Prouvot

![](https://github.com/user-attachments/assets/90621fe0-6527-4a34-8a0b-c14bd6d21cbd)

### Dreamforce 2024, San Francisco

[Save the Day by Monitoring Your Org with Open-Source Tools](https://reg.salesforce.com/flow/plus/df24/sessioncatalog/page/catalog/session/1718915808069001Q7HH), with Olga Shirikova

[![Dreamforce 2024 Video](https://img.youtube.com/vi/NxiLiYeo11A/0.jpg)](https://www.youtube.com/watch?v=NxiLiYeo11A)

### Wir Sind Ohana '24, Berlin

Automate the Monitoring of your Salesforce orgs with open-source tools only!, with Yosra Saidani

[![Wir Sind Ohana Video](https://img.youtube.com/vi/xGbT6at7RZ0/0.jpg)](https://www.youtube.com/watch?v=xGbT6at7RZ0)

### Polish Dreamin '24, Wroclaw, Poland

[Easy and complete Salesforce CI/CD with open-source only!](https://coffeeforce.pl/dreamin/speaker/nicolas-vuillamy/), with Wojciech Suwiński

![Polish Dreamin 2024](https://github.com/nvuillam/nvuillam/assets/17500430/e843cc08-bf8a-452d-b7f0-c64a314f1b60)

### French Touch Dreamin '23, Paris

[Automate the Monitoring of your Salesforce orgs with open-source tools only!](https://frenchtouchdreamin.com/index.php/schedule/), with Maxime Guenego

![French Touch Dreamin 2023](https://github.com/nvuillam/nvuillam/assets/17500430/8a2e1bbf-3402-4929-966d-5f99cb13cd29)

### Dreamforce 2023, San Francisco

[Easy Salesforce CI/CD with open-source and clicks only thanks to sfdx-hardis!](https://reg.salesforce.com/flow/plus/df23/sessioncatalog/page/catalog/session/1684196389783001OqEl), with Jean-Pierre Rizzi

[![Dreamforce 2023 Video](https://img.youtube.com/vi/o0Mm9F07UFs/0.jpg)](https://www.youtube.com/watch?v=o0Mm9F07UFs)

### Yeur Dreamin' 2023, Brussels

An easy and complete Salesforce CI/CD release management with open-source only !, with Angélique Picoreau

[![image](https://github.com/nvuillam/nvuillam/assets/17500430/6470df20-7449-444b-a0a5-7dc22f5f6188)](https://www.linkedin.com/posts/nicolas-vuillamy_cicd-opensource-trailblazercommunity-activity-7076859027321704448-F1g-?utm_source=share&utm_medium=member_desktop)

<!-- events.md end -->

## Articles & Videos

<!-- articles-videos.md start -->

### Web Articles

Here are some articles about [sfdx-hardis](https://sfdx-hardis.cloudity.com/)

- English

[![Conga Deployment Cheat Sheet](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-conga-banner.jpg)](https://nicolas.vuillamy.fr/how-to-deploy-conga-composer-configuration-using-salesforce-cli-plugins-c2899641f36b)
[![Questions/Answers](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-questions-answers.jpg)](https://nicolas.vuillamy.fr/what-devops-experts-want-to-know-about-salesforce-ci-cd-with-sfdx-hardis-q-a-1f412db34476)
[![Salesforce Developers Podcast](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-sfdev.jpg)](https://developer.salesforce.com/podcast/2023/06/sfdx)
[![sfdx-hardis: A release management tool for open-source](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-cicd-salesforcedevopsnet.jpg)](https://salesforcedevops.net/index.php/2023/03/01/sfdx-hardis-open-source-salesforce-release-management/)
[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)
[![Handle Salesforce API versions Deprecation like a pro](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deprecated-api.jpg)](https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238)
[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)
[![How to freeze / unfreeze users during a Salesforce deployment](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-freeze.jpg)](https://medium.com/@dimitrimonge/freeze-unfreeze-users-during-salesforce-deployment-8a1488bf8dd3)
[![How to detect bad words in Salesforce records using SFDX Data Loader and sfdx-hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-badwords.jpg)](https://nicolas.vuillamy.fr/how-to-detect-bad-words-in-salesforce-records-using-sfdx-data-loader-and-sfdx-hardis-171db40a9bac)
[![Reactivate all the sandbox users with .invalid emails in 3 clicks](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-invalid-email.jpg)](https://nicolas.vuillamy.fr/reactivate-all-the-sandbox-users-with-invalid-emails-in-3-clicks-2265af4e3a3d)
[![Invalid scope:Mine, not allowed ? Deploy your ListViews anyway !](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-invalid-scope-mine.jpg)](https://nicolas.vuillamy.fr/invalid-scope-mine-not-allowed-deploy-your-listviews-anyway-443aceca8ac7)

- French
  - [Versions d'API Salesforce décommissionnées: Que faire ?](https://leblog.hardis-group.com/portfolio/versions-dapi-salesforce-decommissionnees-que-faire/)
  - [Exporter en masse les fichiers d’une org Salesforce](https://leblog.hardis-group.com/portfolio/exporter-en-masse-les-fichiers-dune-org-salesforce/)
  - [Suspendre l’accès aux utilisateurs lors d’une mise en production Salesforce](https://leblog.hardis-group.com/portfolio/suspendre-lacces-aux-utilisateurs-lors-dune-mise-en-production-salesforce/)

### Recorded Conferences

#### Dreamforce Sessions

- Dreamforce 2024 - Save the Day by Monitoring Your Org with Open-Source Tools (with Olga Shirikova)

[![Dreamforce 2024: Save the Day by Monitoring Your Org with Open-Source Tools](https://img.youtube.com/vi/NxiLiYeo11A/0.jpg)](https://www.youtube.com/watch?v=NxiLiYeo11A){target=blank}

- Dreamforce 2023 - Easy Salesforce CI/CD with open-source and clicks only thanks to sfdx-hardis! (with Jean-Pierre Rizzi)

[![Dreamforce 2023: Easy Salesforce CI/CD with open-source](https://img.youtube.com/vi/o0Mm9F07UFs/0.jpg)](https://www.youtube.com/watch?v=o0Mm9F07UFs){target=blank}

#### Community Events

- Wir Sind Ohana 2024 - Automate the Monitoring of your Salesforce orgs with open-source tools only! (with Yosra Saidani)

[![Wir Sind Ohana 2024: Automate Monitoring with Open-Source](https://img.youtube.com/vi/xGbT6at7RZ0/0.jpg)](https://www.youtube.com/watch?v=xGbT6at7RZ0){target=blank}

### Podcasts

- Apex Hours 2025 - Org monitoring with Grafana + AI generated doc

[![Apex Hours 2025: Org monitoring with Grafana + AI generated doc](https://img.youtube.com/vi/oDaCh66pRcI/0.jpg)](https://www.youtube.com/watch?v=oDaCh66pRcI){target=blank}

- Salesforce Way Podcast #102 - Sfdx-hardis with Nicolas Vuillamy

[![Salesforce Way Podcast: Sfdx-hardis](https://img.youtube.com/vi/sfdx-hardis/0.jpg)](https://salesforceway.com/podcast/sfdx-hardis/){target=blank}

- Salesforce Developers Podcast Episode 182: SFDX-Hardis with Nicolas Vuillamy

[![Salesforce Developers Podcast](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-sfdev.jpg)](https://developer.salesforce.com/podcast/2023/06/sfdx){target=blank}

### sfdx-hardis Usage

#### Features Overview

- sfdx-hardis 2025 new features overview

[![sfdx-hardis 2025 new features](https://img.youtube.com/vi/JRKH5COUVQ0/0.jpg)](https://youtu.be/JRKH5COUVQ0){target=blank}

- SFDX-HARDIS – A demo with Nicolas Vuillamy from Cloudity

[![SalesforceDevOps.net Demo](https://img.youtube.com/vi/qP6MaZUGzik/0.jpg)](https://www.youtube.com/watch?v=qP6MaZUGzik){target=blank}

#### Installation & Setup

- Complete installation tutorial for sfdx-hardis - [📖 Documentation](https://sfdx-hardis.cloudity.com/installation/)

[![Installation Tutorial](https://img.youtube.com/vi/LA8m-t7CjHA/0.jpg)](https://www.youtube.com/watch?v=LA8m-t7CjHA){target=blank}

#### CI/CD Workflows

- Complete CI/CD workflow for Salesforce projects - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/)

[![Dreamforce demo video: Easy Salesforce CI/CD with sfdx-hardis and open-source only !](https://img.youtube.com/vi/zEYqTd2txU4/0.jpg)](https://www.youtube.com/watch?v=zEYqTd2txU4){target=blank}

- How to start a new User Story in sandbox - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-create-new-task/)

[![Create New User Story](https://img.youtube.com/vi/WOqssZwjPhw/0.jpg)](https://www.youtube.com/watch?v=WOqssZwjPhw){target=blank}

- How to commit updates and create merge requests - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-publish-task/)

[![Publish User Story Tutorial](https://img.youtube.com/vi/Ik6whtflmfY/0.jpg)](https://www.youtube.com/watch?v=Ik6whtflmfY){target=blank}

- How to resolve git merge conflicts in Visual Studio Code - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-validate-merge-request/)

[![Merge Conflicts Resolution](https://img.youtube.com/vi/lz5OuKzvadQ/0.jpg)](https://www.youtube.com/watch?v=lz5OuKzvadQ){target=blank}

- How to install packages in your org - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-work-on-task-install-packages/)

[![Install Packages Tutorial](https://img.youtube.com/vi/5-MgqoSLUls/0.jpg)](https://www.youtube.com/watch?v=5-MgqoSLUls){target=blank}

- Configure CI server authentication to Salesforce orgs - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-auth/)

[![Configure CI Authentication](https://img.youtube.com/vi/OzREUu5utVI/0.jpg)](https://www.youtube.com/watch?v=OzREUu5utVI){target=blank}

#### Monitoring

- How to configure monitoring for your Salesforce org - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-monitoring-config-home/)

[![Org Monitoring Setup](https://img.youtube.com/vi/bcVdN0XItSc/0.jpg)](https://www.youtube.com/watch?v=bcVdN0XItSc){target=blank}

#### Integrations

- Configure Slack integration for deployment notifications - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-slack/)

[![Slack Integration](https://img.youtube.com/vi/se292ABGUmI/0.jpg)](https://www.youtube.com/watch?v=se292ABGUmI){target=blank}

- How to create a Personal Access Token in GitLab - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-clone-repository/)

[![GitLab Personal Access Token](https://img.youtube.com/vi/9y5VmmYHuIg/0.jpg)](https://www.youtube.com/watch?v=9y5VmmYHuIg){target=blank}

#### Documentation

- How to generate AI-enhanced Salesforce project documentation - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-project-doc-generate/)

[![Generate Project Documentation](https://img.youtube.com/vi/ZrVPN3jp1Ac/0.jpg)](https://www.youtube.com/watch?v=ZrVPN3jp1Ac){target=blank}

- Host your documentation on Cloudflare free tier - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-project-doc-cloudflare/)

[![Cloudflare Doc Hosting Setup](https://img.youtube.com/vi/AUipbKjgsDI/0.jpg)](https://www.youtube.com/watch?v=AUipbKjgsDI){target=blank}

<!-- articles-videos.md end -->

## Contributing

<!-- contributing.md start -->

Everyone is welcome to contribute to sfdx-hardis (even juniors: we'll assist you !)

- Install Node.js ([recommended version](https://nodejs.org/en/))
- Install typescript by running `npm install typescript --global`
- Install yarn by running `npm install yarn --global`
- Install Salesforce DX by running `npm install @salesforce/cli --global` command line
- Fork this repo and clone it (or just clone if you are an internal contributor)
- At the root of the repository:
  - Run `yarn` to install dependencies
  - Run `sf plugins link` to link the local sfdx-hardis to SFDX CLI
  - Run `tsc --watch` to transpile typescript into js everytime you update a TS file
- Debug commands using `NODE_OPTIONS=--inspect-brk sf hardis:somecommand -someparameter somevalue`

<!-- contributing.md end -->

## Dependencies

**sfdx-hardis** partially relies on the following SFDX Open-Source packages

- [Salesforce Data Move Utility](https://github.com/forcedotcom/SFDX-Data-Move-Utility)
- [SFDX Git Delta](https://github.com/scolladon/sfdx-git-delta)

## Contributors

<!-- contributors.md start -->

### Organization

sfdx-hardis is primarily led by Nicolas Vuillamy & [Cloudity](https://www.cloudity.com/), but has many external contributors that we cant thank enough !

### Pull Requests Authors

<a href="https://github.com/hardisgroupcom/sfdx-hardis/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hardisgroupcom/sfdx-hardis" />
</a>

### Special Thanks

- [Roman Hentschke](https://www.linkedin.com/in/derroman/), for building the BitBucket CI/CD integration
- [Leo Jokinen](https://www.linkedin.com/in/leojokinen/), for building the GitHub CI/CD integration
- [Mariia Pyvovarchuk](https://www.linkedin.com/in/mpyvo/), for her work about generating automations documentation
- [Matheus Delazeri](https://www.linkedin.com/in/matheus-delazeri-souza/), for the PDF output of documentation
- [Taha Basri](https://www.linkedin.com/in/tahabasri/), for his work about generating documentation of LWC
- [Anush Poudel](https://www.linkedin.com/in/anushpoudel/), for integrating sfdx-hardis with multiple LLMs using langchainJs
- [Sebastien Colladon](https://www.linkedin.com/in/sebastien-colladon/), for providing sfdx-git-delta which is highly used within sfdx-hardis

<!-- contributors.md end -->



## Commands

### hardis:auth

| Command                                       | Title |
|:----------------------------------------------|:------|
| [**hardis:auth:login**](hardis/auth/login.md) |       |

### hardis:cache

| Command                                         | Title |
|:------------------------------------------------|:------|
| [**hardis:cache:clear**](hardis/cache/clear.md) |       |

### hardis:config

| Command                                       | Title |
|:----------------------------------------------|:------|
| [**hardis:config:get**](hardis/config/get.md) |       |

### hardis:deploy

| Command                                                 | Title |
|:--------------------------------------------------------|:------|
| [**hardis:deploy:quick**](hardis/deploy/quick.md)       |       |
| [**hardis:deploy:start**](hardis/deploy/start.md)       |       |
| [**hardis:deploy:validate**](hardis/deploy/validate.md) |       |

### hardis:doc

| Command                                                                     | Title |
|:----------------------------------------------------------------------------|:------|
| [**hardis:doc:extract:permsetgroups**](hardis/doc/extract/permsetgroups.md) |       |
| [**hardis:doc:fieldusage**](hardis/doc/fieldusage.md)                       |       |
| [**hardis:doc:flow2markdown**](hardis/doc/flow2markdown.md)                 |       |
| [**hardis:doc:mkdocs-to-cf**](hardis/doc/mkdocs-to-cf.md)                   |       |
| [**hardis:doc:mkdocs-to-salesforce**](hardis/doc/mkdocs-to-salesforce.md)   |       |
| [**hardis:doc:override-prompts**](hardis/doc/override-prompts.md)           |       |
| [**hardis:doc:packagexml2markdown**](hardis/doc/packagexml2markdown.md)     |       |
| [**hardis:doc:plugin:generate**](hardis/doc/plugin/generate.md)             |       |
| [**hardis:doc:project2markdown**](hardis/doc/project2markdown.md)           |       |

### hardis:git

| Command                                                                     | Title |
|:----------------------------------------------------------------------------|:------|
| [**hardis:git:pull-requests:extract**](hardis/git/pull-requests/extract.md) |       |

### hardis:lint

| Command                                                               | Title |
|:----------------------------------------------------------------------|:------|
| [**hardis:lint:access**](hardis/lint/access.md)                       |       |
| [**hardis:lint:metadatastatus**](hardis/lint/metadatastatus.md)       |       |
| [**hardis:lint:missingattributes**](hardis/lint/missingattributes.md) |       |
| [**hardis:lint:unusedmetadatas**](hardis/lint/unusedmetadatas.md)     |       |

### hardis:mdapi

| Command                                           | Title |
|:--------------------------------------------------|:------|
| [**hardis:mdapi:deploy**](hardis/mdapi/deploy.md) |       |

### hardis:misc

| Command                                                                               | Title |
|:--------------------------------------------------------------------------------------|:------|
| [**hardis:misc:custom-label-translations**](hardis/misc/custom-label-translations.md) |       |
| [**hardis:misc:purge-references**](hardis/misc/purge-references.md)                   |       |
| [**hardis:misc:servicenow-report**](hardis/misc/servicenow-report.md)                 |       |
| [**hardis:misc:toml2csv**](hardis/misc/toml2csv.md)                                   |       |

### hardis:org

| Command                                                                                       | Title |
|:----------------------------------------------------------------------------------------------|:------|
| [**hardis:org:community:update**](hardis/org/community/update.md)                             |       |
| [**hardis:org:configure:data**](hardis/org/configure/data.md)                                 |       |
| [**hardis:org:configure:files**](hardis/org/configure/files.md)                               |       |
| [**hardis:org:configure:monitoring**](hardis/org/configure/monitoring.md)                     |       |
| [**hardis:org:connect**](hardis/org/connect.md)                                               |       |
| [**hardis:org:create**](hardis/org/create.md)                                                 |       |
| [**hardis:org:data:delete**](hardis/org/data/delete.md)                                       |       |
| [**hardis:org:data:export**](hardis/org/data/export.md)                                       |       |
| [**hardis:org:data:import**](hardis/org/data/import.md)                                       |       |
| [**hardis:org:diagnose:audittrail**](hardis/org/diagnose/audittrail.md)                       |       |
| [**hardis:org:diagnose:instanceupgrade**](hardis/org/diagnose/instanceupgrade.md)             |       |
| [**hardis:org:diagnose:legacyapi**](hardis/org/diagnose/legacyapi.md)                         |       |
| [**hardis:org:diagnose:licenses**](hardis/org/diagnose/licenses.md)                           |       |
| [**hardis:org:diagnose:releaseupdates**](hardis/org/diagnose/releaseupdates.md)               |       |
| [**hardis:org:diagnose:unused-apex-classes**](hardis/org/diagnose/unused-apex-classes.md)     |       |
| [**hardis:org:diagnose:unused-connected-apps**](hardis/org/diagnose/unused-connected-apps.md) |       |
| [**hardis:org:diagnose:unusedlicenses**](hardis/org/diagnose/unusedlicenses.md)               |       |
| [**hardis:org:diagnose:unusedusers**](hardis/org/diagnose/unusedusers.md)                     |       |
| [**hardis:org:files:export**](hardis/org/files/export.md)                                     |       |
| [**hardis:org:files:import**](hardis/org/files/import.md)                                     |       |
| [**hardis:org:fix:listviewmine**](hardis/org/fix/listviewmine.md)                             |       |
| [**hardis:org:generate:packagexmlfull**](hardis/org/generate/packagexmlfull.md)               |       |
| [**hardis:org:monitor:all**](hardis/org/monitor/all.md)                                       |       |
| [**hardis:org:monitor:backup**](hardis/org/monitor/backup.md)                                 |       |
| [**hardis:org:monitor:limits**](hardis/org/monitor/limits.md)                                 |       |
| [**hardis:org:multi-org-query**](hardis/org/multi-org-query.md)                               |       |
| [**hardis:org:purge:apexlog**](hardis/org/purge/apexlog.md)                                   |       |
| [**hardis:org:purge:flow**](hardis/org/purge/flow.md)                                         |       |
| [**hardis:org:refresh:after-refresh**](hardis/org/refresh/after-refresh.md)                   |       |
| [**hardis:org:refresh:before-refresh**](hardis/org/refresh/before-refresh.md)                 |       |
| [**hardis:org:retrieve:packageconfig**](hardis/org/retrieve/packageconfig.md)                 |       |
| [**hardis:org:retrieve:sources:analytics**](hardis/org/retrieve/sources/analytics.md)         |       |
| [**hardis:org:retrieve:sources:dx**](hardis/org/retrieve/sources/dx.md)                       |       |
| [**hardis:org:retrieve:sources:dx2**](hardis/org/retrieve/sources/dx2.md)                     |       |
| [**hardis:org:retrieve:sources:metadata**](hardis/org/retrieve/sources/metadata.md)           |       |
| [**hardis:org:retrieve:sources:retrofit**](hardis/org/retrieve/sources/retrofit.md)           |       |
| [**hardis:org:select**](hardis/org/select.md)                                                 |       |
| [**hardis:org:test:apex**](hardis/org/test/apex.md)                                           |       |
| [**hardis:org:user:activateinvalid**](hardis/org/user/activateinvalid.md)                     |       |
| [**hardis:org:user:freeze**](hardis/org/user/freeze.md)                                       |       |
| [**hardis:org:user:unfreeze**](hardis/org/user/unfreeze.md)                                   |       |

### hardis:package

| Command                                                                 | Title |
|:------------------------------------------------------------------------|:------|
| [**hardis:package:create**](hardis/package/create.md)                   |       |
| [**hardis:package:install**](hardis/package/install.md)                 |       |
| [**hardis:package:mergexml**](hardis/package/mergexml.md)               |       |
| [**hardis:package:version:create**](hardis/package/version/create.md)   |       |
| [**hardis:package:version:list**](hardis/package/version/list.md)       |       |
| [**hardis:package:version:promote**](hardis/package/version/promote.md) |       |

### hardis:packagexml

| Command                                                     | Title |
|:------------------------------------------------------------|:------|
| [**hardis:packagexml:append**](hardis/packagexml/append.md) |       |
| [**hardis:packagexml:remove**](hardis/packagexml/remove.md) |       |

### hardis:project

| Command                                                                                       | Title |
|:----------------------------------------------------------------------------------------------|:------|
| [**hardis:project:audit:apiversion**](hardis/project/audit/apiversion.md)                     |       |
| [**hardis:project:audit:callincallout**](hardis/project/audit/callincallout.md)               |       |
| [**hardis:project:audit:duplicatefiles**](hardis/project/audit/duplicatefiles.md)             |       |
| [**hardis:project:audit:remotesites**](hardis/project/audit/remotesites.md)                   |       |
| [**hardis:project:clean:emptyitems**](hardis/project/clean/emptyitems.md)                     |       |
| [**hardis:project:clean:filter-xml-content**](hardis/project/clean/filter-xml-content.md)     |       |
| [**hardis:project:clean:flowpositions**](hardis/project/clean/flowpositions.md)               |       |
| [**hardis:project:clean:hiddenitems**](hardis/project/clean/hiddenitems.md)                   |       |
| [**hardis:project:clean:listviews**](hardis/project/clean/listviews.md)                       |       |
| [**hardis:project:clean:manageditems**](hardis/project/clean/manageditems.md)                 |       |
| [**hardis:project:clean:minimizeprofiles**](hardis/project/clean/minimizeprofiles.md)         |       |
| [**hardis:project:clean:orgmissingitems**](hardis/project/clean/orgmissingitems.md)           |       |
| [**hardis:project:clean:references**](hardis/project/clean/references.md)                     |       |
| [**hardis:project:clean:retrievefolders**](hardis/project/clean/retrievefolders.md)           |       |
| [**hardis:project:clean:sensitive-metadatas**](hardis/project/clean/sensitive-metadatas.md)   |       |
| [**hardis:project:clean:standarditems**](hardis/project/clean/standarditems.md)               |       |
| [**hardis:project:clean:systemdebug**](hardis/project/clean/systemdebug.md)                   |       |
| [**hardis:project:clean:xml**](hardis/project/clean/xml.md)                                   |       |
| [**hardis:project:configure:auth**](hardis/project/configure/auth.md)                         |       |
| [**hardis:project:convert:profilestopermsets**](hardis/project/convert/profilestopermsets.md) |       |
| [**hardis:project:create**](hardis/project/create.md)                                         |       |
| [**hardis:project:deploy:notify**](hardis/project/deploy/notify.md)                           |       |
| [**hardis:project:deploy:quick**](hardis/project/deploy/quick.md)                             |       |
| [**hardis:project:deploy:simulate**](hardis/project/deploy/simulate.md)                       |       |
| [**hardis:project:deploy:smart**](hardis/project/deploy/smart.md)                             |       |
| [**hardis:project:deploy:sources:dx**](hardis/project/deploy/sources/dx.md)                   |       |
| [**hardis:project:deploy:sources:metadata**](hardis/project/deploy/sources/metadata.md)       |       |
| [**hardis:project:deploy:start**](hardis/project/deploy/start.md)                             |       |
| [**hardis:project:deploy:validate**](hardis/project/deploy/validate.md)                       |       |
| [**hardis:project:fix:profiletabs**](hardis/project/fix/profiletabs.md)                       |       |
| [**hardis:project:fix:v53flexipages**](hardis/project/fix/v53flexipages.md)                   |       |
| [**hardis:project:generate:bypass**](hardis/project/generate/bypass.md)                       |       |
| [**hardis:project:generate:flow-git-diff**](hardis/project/generate/flow-git-diff.md)         |       |
| [**hardis:project:generate:gitdelta**](hardis/project/generate/gitdelta.md)                   |       |
| [**hardis:project:lint**](hardis/project/lint.md)                                             |       |
| [**hardis:project:metadata:findduplicates**](hardis/project/metadata/findduplicates.md)       |       |

### hardis:scratch

| Command                                                               | Title |
|:----------------------------------------------------------------------|:------|
| [**hardis:scratch:create**](hardis/scratch/create.md)                 |       |
| [**hardis:scratch:delete**](hardis/scratch/delete.md)                 |       |
| [**hardis:scratch:pool:create**](hardis/scratch/pool/create.md)       |       |
| [**hardis:scratch:pool:localauth**](hardis/scratch/pool/localauth.md) |       |
| [**hardis:scratch:pool:refresh**](hardis/scratch/pool/refresh.md)     |       |
| [**hardis:scratch:pool:reset**](hardis/scratch/pool/reset.md)         |       |
| [**hardis:scratch:pool:view**](hardis/scratch/pool/view.md)           |       |
| [**hardis:scratch:pull**](hardis/scratch/pull.md)                     |       |
| [**hardis:scratch:push**](hardis/scratch/push.md)                     |       |

### hardis:source

| Command                                                 | Title |
|:--------------------------------------------------------|:------|
| [**hardis:source:deploy**](hardis/source/deploy.md)     |       |
| [**hardis:source:push**](hardis/source/push.md)         |       |
| [**hardis:source:retrieve**](hardis/source/retrieve.md) |       |

### hardis:work

| Command                                                         | Title |
|:----------------------------------------------------------------|:------|
| [**hardis:work:new**](hardis/work/new.md)                       |       |
| [**hardis:work:refresh**](hardis/work/refresh.md)               |       |
| [**hardis:work:resetselection**](hardis/work/resetselection.md) |       |
| [**hardis:work:save**](hardis/work/save.md)                     |       |
| [**hardis:work:ws**](hardis/work/ws.md)                         |       |

### hello:world

| Command                           | Title |
|:----------------------------------|:------|
| [**hello:world**](hello/world.md) |       |
