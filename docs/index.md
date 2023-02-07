<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
[![Cloudity Banner](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/cloudity-banner-1.jpg)](https://www.hardis-group.com/en/services-solutions/services/integration/salesforce-consulting-and-integration)

# sfdx-hardis

[![Version](https://img.shields.io/npm/v/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
[![Downloads/week](https://img.shields.io/npm/dw/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
[![Downloads/total](https://img.shields.io/npm/dt/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
![Docker Pulls](https://img.shields.io/docker/pulls/hardisgroupcom/sfdx-hardis)
[![GitHub stars](https://img.shields.io/github/stars/hardisgroupcom/sfdx-hardis?maxAge=2592000)](https://GitHub.com/hardisgroupcom/sfdx-hardis/stargazers/)
[![GitHub contributors](https://img.shields.io/github/contributors/hardisgroupcom/sfdx-hardis.svg)](https://gitHub.com/hardisgroupcom/sfdx-hardis/graphs/contributors/)
[![Mega-Linter](https://github.com/hardisgroupcom/sfdx-hardis/workflows/Mega-Linter/badge.svg?branch=main)](https://github.com/hardisgroupcom/sfdx-hardis/actions?query=workflow%3AMega-Linter+branch%3Amain)
[![Secured with Trivy](https://img.shields.io/badge/Trivy-secured-green?logo=docker)](https://github.com/aquasecurity/trivy)
[![License](https://img.shields.io/npm/l/sfdx-hardis.svg)](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

Toolbox for Salesforce DX, by [Cloudity](https://cloudity.com/)

It will allow you to:

- Do with simple commands what could be done manually in minutes/hours
- [Define a complete CI/CD Pipeline for your Salesforce project](https://hardisgroupcom.github.io/sfdx-hardis/salesforce-ci-cd-home/)


[**Please see the full list of commands in Online documentation**](https://hardisgroupcom.github.io/sfdx-hardis)

**sfdx-hardis** commands are also available with UI in [**SFDX Hardis Visual Studio Code Extension**](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)



## Installation

### SFDX Plugin

#### Pre-requisites

- Install Node.js ([recommended version](https://nodejs.org/en/))
- Install Salesforce DX by running `npm install sfdx-cli --global` command line

#### Plugin installation

```sh-session
sfdx plugins:install sfdx-hardis
```

For advanced use, please also install dependencies

```sh-session
sfdx plugins:install sfdmu sfdx-git-delta sfdx-essentials texei-sfdx-plugin
```

### With IDE

You can install [Visual Studio Code](https://code.visualstudio.com/) extension [VsCode SFDX Hardis](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

Once installed, click on ![Hardis Group button](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/hardis-button.jpg) in VsCode left bar, and follow the additional installation instructions

[![VsCode SFDX Hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/extension-icon.png)](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

### Docker

You can use sfdx-hardis docker images to run in CI

- [**hardisgroupcom/sfdx-hardis:latest**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis) (with latest sfdx-cli version)
- [**hardisgroupcom/sfdx-hardis:latest-sfdx-recommended**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis) (with recommended sfdx-cli version, in case the latest version of sfdx-cli is buggy)

_See [Dockerfile](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/Dockerfile)_

## Usage

```sh-session
sfdx hardis:<COMMAND> <OPTIONS>
```

## Articles

Here are some articles with examples of use of [sfdx-hardis](https://hardisgroupcom.github.io/sfdx-hardis/)

- English

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
- Install Salesforce DX by running `npm install sfdx-cli --global` command line
- Fork this repo and clone it (or just clone if you are an internal contributor)
- At the root of the repository:
  - Run `yarn` to install dependencies
  - Run `sfdx plugins:link` to link the local sfdx-hardis to SFDX CLI
  - Run `tsc --watch` to transpile typescript into js everytime you update a TS file
- Debug commands using `NODE_OPTIONS=--inspect-brk sfdx hardis:somecommand -someparameter somevalue`

## Dependencies

**sfdx-hardis** partially relies on the following SFDX Open-Source packages

- [Salesforce Data Move Utility](https://github.com/forcedotcom/SFDX-Data-Move-Utility)
- [SFDX Essentials](https://github.com/nvuillam/sfdx-essentials)
- [SFDX Git Delta](https://github.com/scolladon/sfdx-git-delta)
- [Texei Sfdx Plugin](https://github.com/texei/texei-sfdx-plugin)



## Commands

### hardis:auth

| Command                                       | Title |
|:----------------------------------------------|:------|
| [**hardis:auth:login**](hardis/auth/login.md) | Login |

### hardis:cache

| Command                                         | Title                   |
|:------------------------------------------------|:------------------------|
| [**hardis:cache:clear**](hardis/cache/clear.md) | Clear sfdx-hardis cache |

### hardis:config

| Command                                       | Title                          |
|:----------------------------------------------|:-------------------------------|
| [**hardis:config:get**](hardis/config/get.md) | Deploy metadata sources to org |

### hardis:doc

| Command                                                                     | Title                              |
|:----------------------------------------------------------------------------|:-----------------------------------|
| [**hardis:doc:extract:permsetgroups**](hardis/doc/extract/permsetgroups.md) | Generate project documentation     |
| [**hardis:doc:plugin:generate**](hardis/doc/plugin/generate.md)             | Generate SFDX Plugin Documentation |

### hardis:lint

| Command                                         | Title                   |
|:------------------------------------------------|:------------------------|
| [**hardis:lint:access**](hardis/lint/access.md) | check permission access |

### hardis:mdapi

| Command                                           | Title                                                                                          |
|:--------------------------------------------------|:-----------------------------------------------------------------------------------------------|
| [**hardis:mdapi:deploy**](hardis/mdapi/deploy.md) | sfdx-hardis wrapper for sfdx force:mdapi:deploy that displays tips to solve deployment errors. |

### hardis:misc

| Command                                             | Title       |
|:----------------------------------------------------|:------------|
| [**hardis:misc:toml2csv**](hardis/misc/toml2csv.md) | TOML to CSV |

### hardis:org

| Command                                                                               | Title                                            |
|:--------------------------------------------------------------------------------------|:-------------------------------------------------|
| [**hardis:org:configure:data**](hardis/org/configure/data.md)                         | Configure Data project                           |
| [**hardis:org:configure:files**](hardis/org/configure/files.md)                       | Configure File export project                    |
| [**hardis:org:configure:monitoring**](hardis/org/configure/monitoring.md)             | Configure org monitoring                         |
| [**hardis:org:connect**](hardis/org/connect.md)                                       | Connect to an org                                |
| [**hardis:org:create**](hardis/org/create.md)                                         | Create sandbox org                               |
| [**hardis:org:data:delete**](hardis/org/data/delete.md)                               | Delete data                                      |
| [**hardis:org:data:export**](hardis/org/data/export.md)                               | Export data                                      |
| [**hardis:org:data:import**](hardis/org/data/import.md)                               | Import data                                      |
| [**hardis:org:diagnose:legacyapi**](hardis/org/diagnose/legacyapi.md)                 | Check for legacy API use                         |
| [**hardis:org:files:export**](hardis/org/files/export.md)                             | Export files                                     |
| [**hardis:org:fix:listviewmine**](hardis/org/fix/listviewmine.md)                     | Fix listviews with                               |
| [**hardis:org:purge:apexlog**](hardis/org/purge/apexlog.md)                           | Purge Apex Logs                                  |
| [**hardis:org:purge:flow**](hardis/org/purge/flow.md)                                 | Purge Flow versions                              |
| [**hardis:org:retrieve:packageconfig**](hardis/org/retrieve/packageconfig.md)         | Retrieve package configuration from an org       |
| [**hardis:org:retrieve:sources:analytics**](hardis/org/retrieve/sources/analytics.md) | Retrieve CRM Analytics configuration from an org |
| [**hardis:org:retrieve:sources:dx**](hardis/org/retrieve/sources/dx.md)               | Retrieve sfdx sources from org                   |
| [**hardis:org:retrieve:sources:dx2**](hardis/org/retrieve/sources/dx2.md)             | Retrieve sfdx sources from org (2)               |
| [**hardis:org:retrieve:sources:metadata**](hardis/org/retrieve/sources/metadata.md)   | Retrieve sfdx sources from org                   |
| [**hardis:org:retrieve:sources:retrofit**](hardis/org/retrieve/sources/retrofit.md)   | Retrofit changes from an org                     |
| [**hardis:org:select**](hardis/org/select.md)                                         | Select org                                       |
| [**hardis:org:test:apex**](hardis/org/test/apex.md)                                   | Run apex tests                                   |
| [**hardis:org:user:activateinvalid**](hardis/org/user/activateinvalid.md)             | Reactivate sandbox invalid users                 |
| [**hardis:org:user:freeze**](hardis/org/user/freeze.md)                               | Freeze user logins                               |
| [**hardis:org:user:unfreeze**](hardis/org/user/unfreeze.md)                           | Unfreeze user logins                             |

### hardis:package

| Command                                                                 | Title                              |
|:------------------------------------------------------------------------|:-----------------------------------|
| [**hardis:package:create**](hardis/package/create.md)                   | Create a new package               |
| [**hardis:package:install**](hardis/package/install.md)                 | Install packages in an org         |
| [**hardis:package:mergexml**](hardis/package/mergexml.md)               | Merge package.xml files            |
| [**hardis:package:version:create**](hardis/package/version/create.md)   | Create a new version of a package  |
| [**hardis:package:version:list**](hardis/package/version/list.md)       | Create a new version of a package  |
| [**hardis:package:version:promote**](hardis/package/version/promote.md) | Promote new versions of package(s) |

### hardis:project

| Command                                                                                       | Title                                                           |
|:----------------------------------------------------------------------------------------------|:----------------------------------------------------------------|
| [**hardis:project:audit:apiversion**](hardis/project/audit/apiversion.md)                     | Audit Metadatas API Version                                     |
| [**hardis:project:audit:callincallout**](hardis/project/audit/callincallout.md)               | Audit CallIns and CallOuts                                      |
| [**hardis:project:audit:duplicatefiles**](hardis/project/audit/duplicatefiles.md)             | Find duplicate sfdx files                                       |
| [**hardis:project:audit:remotesites**](hardis/project/audit/remotesites.md)                   | Audit Remote Sites                                              |
| [**hardis:project:clean:emptyitems**](hardis/project/clean/emptyitems.md)                     | Clean retrieved empty items in dx sources                       |
| [**hardis:project:clean:hiddenitems**](hardis/project/clean/hiddenitems.md)                   | Clean retrieved hidden items in dx sources                      |
| [**hardis:project:clean:listviews**](hardis/project/clean/listviews.md)                       | Replace Mine by Everything in ListViews                         |
| [**hardis:project:clean:manageditems**](hardis/project/clean/manageditems.md)                 | Clean retrieved managed items in dx sources                     |
| [**hardis:project:clean:minimizeprofiles**](hardis/project/clean/minimizeprofiles.md)         | Clean profiles of Permission Set attributes                     |
| [**hardis:project:clean:orgmissingitems**](hardis/project/clean/orgmissingitems.md)           | Clean SFDX items using target org definition                    |
| [**hardis:project:clean:references**](hardis/project/clean/references.md)                     | Clean references in dx sources                                  |
| [**hardis:project:clean:retrievefolders**](hardis/project/clean/retrievefolders.md)           | Retrieve dashboards, documents and report folders in DX sources |
| [**hardis:project:clean:standarditems**](hardis/project/clean/standarditems.md)               | Clean retrieved standard items in dx sources                    |
| [**hardis:project:clean:systemdebug**](hardis/project/clean/systemdebug.md)                   | Clean System debug                                              |
| [**hardis:project:clean:xml**](hardis/project/clean/xml.md)                                   | Clean retrieved empty items in dx sources                       |
| [**hardis:project:configure:auth**](hardis/project/configure/auth.md)                         | Configure authentication                                        |
| [**hardis:project:convert:profilestopermsets**](hardis/project/convert/profilestopermsets.md) | Convert Profiles into Permission Sets                           |
| [**hardis:project:create**](hardis/project/create.md)                                         | Login                                                           |
| [**hardis:project:deploy:sources:dx**](hardis/project/deploy/sources/dx.md)                   | Deploy sfdx sources to org                                      |
| [**hardis:project:deploy:sources:metadata**](hardis/project/deploy/sources/metadata.md)       | Deploy metadata sources to org                                  |
| [**hardis:project:fix:v53flexipages**](hardis/project/fix/v53flexipages.md)                   | Fix flexipages for v53                                          |
| [**hardis:project:generate:gitdelta**](hardis/project/generate/gitdelta.md)                   | Generate Git Delta                                              |
| [**hardis:project:lint**](hardis/project/lint.md)                                             | Lint                                                            |
| [**hardis:project:metadata:findduplicates**](hardis/project/metadata/findduplicates.md)       | XML duplicate values finder                                     |

### hardis:scratch

| Command                                                               | Title                                    |
|:----------------------------------------------------------------------|:-----------------------------------------|
| [**hardis:scratch:create**](hardis/scratch/create.md)                 | Create and initialize scratch org        |
| [**hardis:scratch:delete**](hardis/scratch/delete.md)                 | Delete scratch orgs(s)                   |
| [**hardis:scratch:pool:create**](hardis/scratch/pool/create.md)       | Create and configure scratch org pool    |
| [**hardis:scratch:pool:localauth**](hardis/scratch/pool/localauth.md) | Authenticate locally to scratch org pool |
| [**hardis:scratch:pool:refresh**](hardis/scratch/pool/refresh.md)     | Refresh scratch org pool                 |
| [**hardis:scratch:pool:reset**](hardis/scratch/pool/reset.md)         | Reset scratch org pool                   |
| [**hardis:scratch:pool:view**](hardis/scratch/pool/view.md)           | View scratch org pool info               |
| [**hardis:scratch:pull**](hardis/scratch/pull.md)                     | Scratch PULL                             |
| [**hardis:scratch:push**](hardis/scratch/push.md)                     | Scratch PUSH                             |

### hardis:source

| Command                                                 | Title                                                                                           |
|:--------------------------------------------------------|:------------------------------------------------------------------------------------------------|
| [**hardis:source:deploy**](hardis/source/deploy.md)     | sfdx-hardis wrapper for sfdx force:source:deploy that displays tips to solve deployment errors. |
| [**hardis:source:push**](hardis/source/push.md)         | sfdx-hardis wrapper for sfdx force:source:push that displays tips to solve deployment errors.   |
| [**hardis:source:retrieve**](hardis/source/retrieve.md) | sfdx-hardis wrapper for sfdx force:source:retrieve                                              |

### hardis:work

| Command                                                         | Title                |
|:----------------------------------------------------------------|:---------------------|
| [**hardis:work:new**](hardis/work/new.md)                       | New work task        |
| [**hardis:work:refresh**](hardis/work/refresh.md)               | Refresh work task    |
| [**hardis:work:resetselection**](hardis/work/resetselection.md) | Select again         |
| [**hardis:work:save**](hardis/work/save.md)                     | Save work task       |
| [**hardis:work:ws**](hardis/work/ws.md)                         | WebSocket operations |
