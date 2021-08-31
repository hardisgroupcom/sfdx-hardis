<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
[![Hardis Group Logo](docs/assets/images/hardis-banner.jpg)](https://www.hardis-group.com/en/services-solutions/services/integration/salesforce-consulting-and-integration)

# sfdx-hardis

[![Version](https://img.shields.io/npm/v/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
[![Downloads/week](https://img.shields.io/npm/dw/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
![Docker Pulls](https://img.shields.io/docker/pulls/hardisgroupcom/sfdx-hardis)
[![GitHub stars](https://img.shields.io/github/stars/hardisgroupcom/sfdx-hardis?maxAge=2592000)](https://GitHub.com/hardisgroupcom/sfdx-hardis/stargazers/)
[![GitHub contributors](https://img.shields.io/github/contributors/hardisgroupcom/sfdx-hardis.svg)](https://gitHub.com/hardisgroupcom/sfdx-hardis/graphs/contributors/)
[![Mega-Linter](https://github.com/hardisgroupcom/sfdx-hardis/workflows/Mega-Linter/badge.svg?branch=main)](https://github.com/hardisgroupcom/sfdx-hardis/actions?query=workflow%3AMega-Linter+branch%3Amain)
[![Secured with Trivy](https://img.shields.io/badge/Trivy-secured-green?logo=docker)](https://github.com/aquasecurity/trivy)
[![License](https://img.shields.io/npm/l/sfdx-hardis.svg)](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

Toolbox for Salesforce DX, by [Hardis-Group](https://www.hardis-group.com/en/services-solutions/services/integration/salesforce-consulting-and-integration)

[**Please See the list of commands in Online documentation**](https://hardisgroupcom.github.io/sfdx-hardis)

**sfdx-hardis** partially relies on the following SFDX Open-Source packages

- [Salesforce Data Move Utility](https://github.com/forcedotcom/SFDX-Data-Move-Utility)
- [SFDX Essentials](https://github.com/nvuillam/sfdx-essentials)
- [SFDX Git Delta](https://github.com/scolladon/sfdx-git-delta)
- [SfPowerkit](https://github.com/Accenture/sfpowerkit)
- [Texei Sfdx Plugin](https://github.com/texei/texei-sfdx-plugin)

**sfdx-hardis** commands are also available with UI in [**SFDX Hardis Visual Studio Code Extension**](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

## Installation

### SFDX Plugin

```sh-session
sfdx plugins:install sfdx-hardis
```

For advanced use, please also install dependencies

```sh-session
sfdx plugins:install sfdmu sfdx-git-delta sfdx-essentials sfpowerkit shane-sfdx-plugins texei-sfdx-plugin
```

### Docker

You can use docker image [**hardisgroupcom/sfdx-hardis**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis)

## Usage

```sh-session
sfdx hardis:<COMMAND> <OPTIONS>
```

## Use sfdx-hardis in CI

You can use sfdx-hardis within CI scripts

To do that, you need to configure authentication. This will create/update:

- .sfdx-hardis.yml configuration file (repo)
- Self signed certificate (repo)
- Connected App (uploaded to org via metadata api)
- SFDX_CLIENT_ID variable (manually set in a CI variable)

### Configure authentication

You need [openssl](https://www.openssl.org/) installed on your computer

Run the following command and follow instructions

```shell
sfdx hardis:project:configure:auth
```

Alternative for DevHub

```shell
sfdx hardis:project:configure:auth --devhub
```

### Authentication in CI

Call **sfdx hardis:login** at the root of the repository where you configured authentication

```shell
sfdx hardis:auth:login
sfdx hardis:org:purge:flow --no-prompt
```

Alternative for DevHub

```shell
sfdx hardis:auth:login --devhub
```

## Contributing

Anyone is welcome to contribute to this sfdx-hardis

- Fork this repo and clone it
- Run `yarn` to install dependencies
- Run `sfdx plugins:link` to link the local sfdx-hardis to SFDX CLI
- Run `tsc --watch`to transpile typescript
- Debug commands using `NODE_OPTIONS=--inspect-brk sfdx hardis:somecommand -someparameter somevalue`



## Commands

### hardis:auth

|Command|Title|
|:------|:----------|
|[**hardis:auth:login**](hardis/auth/login.md)|Login|

### hardis:config

|Command|Title|
|:------|:----------|
|[**hardis:config:get**](hardis/config/get.md)|Deploy metadata sources to org|

### hardis:doc

|Command|Title|
|:------|:----------|
|[**hardis:doc:plugin:generate**](hardis/doc/plugin/generate.md)|Generate SFDX Plugin Documentation|

### hardis:org

|Command|Title|
|:------|:----------|
|[**hardis:org:configure:data**](hardis/org/configure/data.md)|Configure Data project|
|[**hardis:org:configure:files**](hardis/org/configure/files.md)|Configure File export project|
|[**hardis:org:configure:monitoring**](hardis/org/configure/monitoring.md)|Configure org monitoring|
|[**hardis:org:connect**](hardis/org/connect.md)|Connect to an org|
|[**hardis:org:data:export**](hardis/org/data/export.md)|Export data|
|[**hardis:org:data:import**](hardis/org/data/import.md)|Import data|
|[**hardis:org:diagnose:legacyapi**](hardis/org/diagnose/legacyapi.md)|Check for legacy API use|
|[**hardis:org:files:export**](hardis/org/files/export.md)|Export files|
|[**hardis:org:purge:apexlog**](hardis/org/purge/apexlog.md)|Purge Apex Logs|
|[**hardis:org:purge:flow**](hardis/org/purge/flow.md)|Purge Flow versions|
|[**hardis:org:retrieve:packageconfig**](hardis/org/retrieve/packageconfig.md)|Retrieve package configuration from an org|
|[**hardis:org:retrieve:sources:dx**](hardis/org/retrieve/sources/dx.md)|Retrieve sfdx sources from org|
|[**hardis:org:retrieve:sources:dx2**](hardis/org/retrieve/sources/dx2.md)|Retrieve sfdx sources from org (2)|
|[**hardis:org:retrieve:sources:metadata**](hardis/org/retrieve/sources/metadata.md)|Retrieve sfdx sources from org|
|[**hardis:org:select**](hardis/org/select.md)|Select org|
|[**hardis:org:test:apex**](hardis/org/test/apex.md)|Run apex tests|
|[**hardis:org:user:freeze**](hardis/org/user/freeze.md)|Freeze user logins|
|[**hardis:org:user:unfreeze**](hardis/org/user/unfreeze.md)|Unfreeze users logins|

### hardis:package

|Command|Title|
|:------|:----------|
|[**hardis:package:create**](hardis/package/create.md)|Create a new package|
|[**hardis:package:install**](hardis/package/install.md)|Install packages in an org|
|[**hardis:package:version:create**](hardis/package/version/create.md)|Create a new version of a package|
|[**hardis:package:version:list**](hardis/package/version/list.md)|Create a new version of a package|
|[**hardis:package:version:promote**](hardis/package/version/promote.md)|Promote new versions of package(s)|

### hardis:project

|Command|Title|
|:------|:----------|
|[**hardis:project:audit:apiversion**](hardis/project/audit/apiversion.md)|Audit Metadatas API Version|
|[**hardis:project:audit:callincallout**](hardis/project/audit/callincallout.md)|Audit CallIns and CallOuts|
|[**hardis:project:audit:remotesites**](hardis/project/audit/remotesites.md)|Audit Remote Sites|
|[**hardis:project:clean:emptyitems**](hardis/project/clean/emptyitems.md)|Clean retrieved empty items in dx sources|
|[**hardis:project:clean:hiddenitems**](hardis/project/clean/hiddenitems.md)|Clean retrieved hidden items in dx sources|
|[**hardis:project:clean:manageditems**](hardis/project/clean/manageditems.md)|Clean retrieved managed items in dx sources|
|[**hardis:project:clean:orgmissingitems**](hardis/project/clean/orgmissingitems.md)|Clean SFDX items using target org definition|
|[**hardis:project:clean:references**](hardis/project/clean/references.md)|Clean references in dx sources|
|[**hardis:project:clean:retrievefolders**](hardis/project/clean/retrievefolders.md)|Retrieve dashboards, documents and report folders in DX sources|
|[**hardis:project:clean:standarditems**](hardis/project/clean/standarditems.md)|Clean retrieved standard items in dx sources|
|[**hardis:project:configure:auth**](hardis/project/configure/auth.md)|Configure authentication|
|[**hardis:project:convert:profilestopermsets**](hardis/project/convert/profilestopermsets.md)|Convert Profiles into Permission Sets|
|[**hardis:project:create**](hardis/project/create.md)|Login|
|[**hardis:project:deploy:sources:dx**](hardis/project/deploy/sources/dx.md)|Deploy sfdx sources to org|
|[**hardis:project:deploy:sources:metadata**](hardis/project/deploy/sources/metadata.md)|Deploy metadata sources to org|
|[**hardis:project:generate:gitdelta**](hardis/project/generate/gitdelta.md)|Generate Git Delta|
|[**hardis:project:lint**](hardis/project/lint.md)|Lint|

### hardis:scratch

|Command|Title|
|:------|:----------|
|[**hardis:scratch:create**](hardis/scratch/create.md)|Create and initialize scratch org|
|[**hardis:scratch:delete**](hardis/scratch/delete.md)|Delete scratch orgs(s)|
|[**hardis:scratch:pool:create**](hardis/scratch/pool/create.md)|Create and configure scratch org pool|
|[**hardis:scratch:pool:localauth**](hardis/scratch/pool/localauth.md)|Authenticate locally to scratch org pool|
|[**hardis:scratch:pool:refresh**](hardis/scratch/pool/refresh.md)|Refresh scratch org pool|
|[**hardis:scratch:pool:view**](hardis/scratch/pool/view.md)|View scratch org pool info|
|[**hardis:scratch:pull**](hardis/scratch/pull.md)|Scratch PULL|
|[**hardis:scratch:push**](hardis/scratch/push.md)|Scratch PUSH|

### hardis:work

|Command|Title|
|:------|:----------|
|[**hardis:work:new**](hardis/work/new.md)|New work task|
|[**hardis:work:refresh**](hardis/work/refresh.md)|Refresh work task|
|[**hardis:work:resetselection**](hardis/work/resetselection.md)|Select again|
|[**hardis:work:save**](hardis/work/save.md)|Save work task|
|[**hardis:work:ws**](hardis/work/ws.md)|WebSocket operations|
