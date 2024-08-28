<!-- markdownlint-disable MD034 -->

[![sfdx-hardis by Cloudity Banner](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/sfdx-hardis-banner.png)](https://sfdx-hardis.cloudity.com)

# sfdx-hardis

[_Presented at Dreamforce 23!_](https://reg.salesforce.com/flow/plus/df23/sessioncatalog/page/catalog/session/1684196389783001OqEl)

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

Toolbox for Salesforce DX, by [Cloudity](https://cloudity.com/), natively compliant with most platforms and tools

![Native Integrations](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/integrations.png)

It will allow you to:

- Do with simple commands what could be done manually in minutes/hours
- [Define a complete CI/CD Pipeline for your Salesforce project](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/)
- [Backup Metadatas and monitor any Salesforce org](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/)

[**Please see the full list of commands in Online documentation**](https://sfdx-hardis.cloudity.com)

**sfdx-hardis** commands are also available with UI in [**SFDX Hardis Visual Studio Code Extension**](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

[![VsCode SFDX Hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/extension-demo.gif)](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

_See Dreamforce presentation_

[![See Dreamforce presentation](https://img.youtube.com/vi/o0Mm9F07UFs/0.jpg)](https://www.youtube.com/watch?v=o0Mm9F07UFs)

## Installation

### With IDE

You can install [Visual Studio Code](https://code.visualstudio.com/) extension [VsCode SFDX Hardis](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

Once installed, click on ![Hardis Group button](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/hardis-button.jpg) in VsCode left bar, and follow the additional installation instructions

[![Installation tutorial](https://img.youtube.com/vi/LA8m-t7CjHA/0.jpg)](https://www.youtube.com/watch?v=LA8m-t7CjHA)

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
sf plugins install sfdmu
sf plugins install sfdx-git-delta
sf plugins install texei-sfdx-plugin
```

If you are using CI/CD scripts, use `echo y | sf plugins install ...` to bypass prompt.

### Docker

You can use sfdx-hardis docker images to run in CI

- Docker Hub

  - [**hardisgroupcom/sfdx-hardis:latest**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis) (with latest @salesforce/cli version)
  - [**hardisgroupcom/sfdx-hardis:latest-sfdx-recommended**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis) (with recommended @salesforce/cli version, in case the latest version of @salesforce/cli is buggy)

- GitHub Packages (ghcr.io)
  - [**ghcr.io/hardisgroupcom/sfdx-hardis:latest**](https://github.com/orgs/hardisgroupcom/packages) (with latest @salesforce/cli version)
  - [**ghcr.io/hardisgroupcom/sfdx-hardis:latest-sfdx-recommended**](https://github.com/orgs/hardisgroupcom/packages) (with recommended @salesforce/cli version, in case the latest version of @salesforce/cli is buggy)

_See [Dockerfile](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/Dockerfile)_

## Usage

```sh-session
sf hardis:<COMMAND> <OPTIONS>
```

## Articles

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

## Contributing

Anyone is welcome to contribute to this sfdx-hardis

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

## Dependencies

**sfdx-hardis** partially relies on the following SFDX Open-Source packages

- [Salesforce Data Move Utility](https://github.com/forcedotcom/SFDX-Data-Move-Utility)
- [SFDX Git Delta](https://github.com/scolladon/sfdx-git-delta)
- [Texei Sfdx Plugin](https://github.com/texei/texei-sfdx-plugin)

## Contributors

<a href="https://github.com/hardisgroupcom/sfdx-hardis/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hardisgroupcom/sfdx-hardis" />
</a>

## Commands

[**Read Online Documentation**](https://sfdx-hardis.cloudity.com)


<!-- commands -->
