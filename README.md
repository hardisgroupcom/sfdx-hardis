[![Hardis Group Logo](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/hardis-banner.jpg)](https://www.hardis-group.com/en/services-solutions/services/integration/salesforce-consulting-and-integration)

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

#### Pre-requisites

- Install Node.js ([recommended version](https://nodejs.org/en/))
- Install Salesforce DX by running `npm install sfdx-cli --global` command line

#### Plugin installation

```sh-session
sfdx plugins:install sfdx-hardis
```

For advanced use, please also install dependencies

```sh-session
sfdx plugins:install sfdmu sfdx-git-delta sfdx-essentials sfpowerkit shane-sfdx-plugins texei-sfdx-plugin
```

### With IDE

You can install [Visual Studio Code](https://code.visualstudio.com/) extension [VsCode SFDX Hardis](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

Once installed, click on ![Hardis Group button](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/hardis-button.jpg) in VsCode left bar, and follow the additional installation instructions

[![VsCode SFDX Hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/extension-icon.png)](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

### Docker

You can use sfdx-hardis docker images to run in CI

- [**hardisgroupcom/sfdx-hardis:latest**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis) (with latest sfdx-cli version)
- [**hardisgroupcom/sfdx-hardis:latest-sfdx-stable**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis) (with stable sfdx-cli version)

_See [Dockerfile](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/Dockerfile)_

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

<!-- commands -->
* [`sfdx hardis:auth:login [-r <string>] [-h] [-s] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisauthlogin--r-string--h--s--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:config:get [-l <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisconfigget--l-string--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:doc:plugin:generate [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisdocplugingenerate--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:configure:data [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgconfiguredata--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:configure:files [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgconfigurefiles--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:configure:monitoring [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgconfiguremonitoring--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:connect [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgconnect--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:data:export [-p <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgdataexport--p-string--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:data:import [-p <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgdataimport--p-string--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:diagnose:legacyapi [-m <string>] [-e <string>] [-l <number>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgdiagnoselegacyapi--m-string--e-string--l-number--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:files:export [-p <string>] [-c <number>] [-t <number>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgfilesexport--p-string--c-number--t-number--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:purge:apexlog [-z] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgpurgeapexlog--z--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:purge:flow [-z] [-n <string>] [-s <string>] [-f] [-r <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgpurgeflow--z--n-string--s-string--f--r-string--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:retrieve:packageconfig [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgretrievepackageconfig--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:retrieve:sources:dx [-f <string>] [-t <string>] [-k <string>] [-m <string>] [-o] [-r <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgretrievesourcesdx--f-string--t-string--k-string--m-string--o--r-string--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:retrieve:sources:dx2 [-x <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgretrievesourcesdx2--x-string--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:retrieve:sources:metadata [-f <string>] [-p <string>] [-r <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgretrievesourcesmetadata--f-string--p-string--r-string--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:select [-h] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgselect--h--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:test:apex [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgtestapex--l-notestrunrunspecifiedtestsrunlocaltestsrunalltestsinorg--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:user:freeze [-n <string>] [-e <string>] [-m <number>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorguserfreeze--n-string--e-string--m-number--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:user:unfreeze [-n <string>] [-e <string>] [-m <number>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorguserunfreeze--n-string--e-string--m-number--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:package:create [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardispackagecreate--d---websocket-string--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:package:install [-p] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardispackageinstall--p--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:package:version:create [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardispackageversioncreate--d---websocket-string--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:package:version:list [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardispackageversionlist--d---websocket-string--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:package:version:promote [-d] [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardispackageversionpromote--d--d---websocket-string--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:audit:apiversion [-m <number>] [-f] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectauditapiversion--m-number--f--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:audit:callincallout [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectauditcallincallout--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:audit:remotesites [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectauditremotesites--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:clean:emptyitems [-f <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectcleanemptyitems--f-string--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:clean:hiddenitems [-f <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectcleanhiddenitems--f-string--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:clean:manageditems [-n <string>] [-f <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectcleanmanageditems--n-string--f-string--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:clean:orgmissingitems [-f <string>] [-p <string>] [-t <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectcleanorgmissingitems--f-string--p-string--t-string--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:clean:references [-t <string>] [-c <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectcleanreferences--t-string--c-string--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:clean:retrievefolders [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectcleanretrievefolders--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:clean:standarditems [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectcleanstandarditems--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:configure:auth [-b] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectconfigureauth--b--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:convert:profilestopermsets [-e <array>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectconvertprofilestopermsets--e-array--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:create [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectcreate--d---websocket-string--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:deploy:sources:dx [-c] [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-p <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectdeploysourcesdx--c--l-notestrunrunspecifiedtestsrunlocaltestsrunalltestsinorg--p-string--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:deploy:sources:metadata [-c] [-p <string>] [-f] [-k <string>] [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectdeploysourcesmetadata--c--p-string--f--k-string--l-notestrunrunspecifiedtestsrunlocaltestsrunalltestsinorg--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:generate:gitdelta [--branch <string>] [--fromcommit <string>] [--tocommit <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectgenerategitdelta---branch-string---fromcommit-string---tocommit-string--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:lint [-f] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectlint--f--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:scratch:create [-n] [-d] [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisscratchcreate--n--d--d---websocket-string--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:scratch:delete [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisscratchdelete--d---websocket-string--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:scratch:pool:create [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisscratchpoolcreate--d---websocket-string--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:scratch:pool:localauth [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisscratchpoollocalauth--d---websocket-string--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:scratch:pool:refresh [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisscratchpoolrefresh--d---websocket-string--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:scratch:pool:view [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisscratchpoolview--d---websocket-string--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:scratch:pull [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisscratchpull--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:scratch:push [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisscratchpush--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:work:new [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisworknew--d---websocket-string--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:work:refresh [-n] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisworkrefresh--n--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:work:resetselection [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisworkresetselection--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:work:save [-n] [-g] [-c] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisworksave--n--g--c--d---websocket-string--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:work:ws [-e <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisworkws--e-string--d---websocket-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)

## `sfdx hardis:auth:login [-r <string>] [-h] [-s] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Login to salesforce org

```
USAGE
  $ sfdx hardis:auth:login [-r <string>] [-h] [-s] [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -h, --devhub                                                                      Also connect associated DevHub
  -r, --instanceurl=instanceurl                                                     URL of org instance
  -s, --scratchorg                                                                  Scratch org
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:auth:login
```

_See code: [lib/commands/hardis/auth/login.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/auth/login.js)_

## `sfdx hardis:config:get [-l <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Returns sfdx-hardis project config for a given level

```
USAGE
  $ sfdx hardis:config:get [-l <string>] [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -l, --level=project|branch|user                                                   [default: project] project,branch or
                                                                                    user

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:deploy:sources:metadata
```

_See code: [lib/commands/hardis/config/get.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/config/get.js)_

## `sfdx hardis:doc:plugin:generate [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Generate Markdown documentation ready for HTML conversion with mkdocs

```
USAGE
  $ sfdx hardis:doc:plugin:generate [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

DESCRIPTION
  After the first run, you need to update manually:

  - mkdocs.yml
  - .github/workflows/build-deploy-docs.yml
  - docs/javascripts/gtag.js , if you want Google Analytics tracking

  Then, activate Github pages, with "gh_pages" as target branch

  At each merge into master/main branch, the GitHub Action build-deploy-docs will rebuild documentation and publish it 
  in GitHub pages

EXAMPLE
  $ sfdx hardis:doc:plugin:generate
```

_See code: [lib/commands/hardis/doc/plugin/generate.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/doc/plugin/generate.js)_

## `sfdx hardis:org:configure:data [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Configure Data Export/Import with a SFDMU Project

```
USAGE
  $ sfdx hardis:org:configure:data [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:org:configure:data
```

_See code: [lib/commands/hardis/org/configure/data.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/configure/data.js)_

## `sfdx hardis:org:configure:files [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Configure export of file attachments from a Salesforce org

```
USAGE
  $ sfdx hardis:org:configure:files [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:org:configure:files
```

_See code: [lib/commands/hardis/org/configure/files.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/configure/files.js)_

## `sfdx hardis:org:configure:monitoring [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Configure monitoring of an org

```
USAGE
  $ sfdx hardis:org:configure:monitoring [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:org:configure:monitoring
```

_See code: [lib/commands/hardis/org/configure/monitoring.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/configure/monitoring.js)_

## `sfdx hardis:org:connect [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Connect to an org without setting it as default username

```
USAGE
  $ sfdx hardis:org:connect [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:org:connect
```

_See code: [lib/commands/hardis/org/connect.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/connect.js)_

## `sfdx hardis:org:data:export [-p <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Export data from org using sfdmu

```
USAGE
  $ sfdx hardis:org:data:export [-p <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -p, --path=path                                                                   Path to the sfdmu workspace folder

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:org:data:export
```

_See code: [lib/commands/hardis/org/data/export.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/data/export.js)_

## `sfdx hardis:org:data:import [-p <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Import data in org using sfdmu

```
USAGE
  $ sfdx hardis:org:data:import [-p <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -p, --path=path                                                                   Path to the sfdmu workspace folder

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:org:data:import
```

_See code: [lib/commands/hardis/org/data/import.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/data/import.js)_

## `sfdx hardis:org:diagnose:legacyapi [-m <string>] [-e <string>] [-l <number>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Checks if an org uses a deprecated API version

```
USAGE
  $ sfdx hardis:org:diagnose:legacyapi [-m <string>] [-e <string>] [-l <number>] [-d] [--websocket <string>] [-u 
  <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -e, --eventtype=eventtype                                                         [default: ApiTotalUsage] Type of
                                                                                    EventLogFile event to analyze

  -l, --limit=limit                                                                 [default: 999] Number of latest
                                                                                    EventLogFile events to analyze

  -m, --mode=mode                                                                   [default: jsforce] Detection mode:
                                                                                    jsforce or apex

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

DESCRIPTION
  - Salesforce will remove access to old API versions in the following releases
  - An external application (ESB, ETL, Web Portal, Mobile application...) using a deprecated API version will receive 
  errors as response, and this will probably break integrations business processes
  - More info in [Salesforce Help](https://help.salesforce.com/s/articleView?id=000351312&language=en_US&mode=1&type=1) 
  and in this [Salesforce blog post](https://t.co/uc2cobzmVi?amp=1)

  | API versions | Salesforce deprecation release |
  |:------------:|:------------------------------:|
  | 7.0 to 20.0  |           Summer 21            |
  | 21.0 to 30.0 |           Summer 22            |

  - Run the command `sfdx hardis:org:diagnose:legacyapi`

  ![Legacy API result](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/legacy-api-result.png)

  - If you see deprecated API calls, open the detailed CSV file and identify the sources of deprecated API calls
  - You need to update your ecosystem external applications so they call a more recent version of APIS (52.0)

EXAMPLE
  $ sfdx hardis:org:diagnose:legacyapi
```

_See code: [lib/commands/hardis/org/diagnose/legacyapi.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/diagnose/legacyapi.js)_

## `sfdx hardis:org:files:export [-p <string>] [-c <number>] [-t <number>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Export files from an org according to a configuration

```
USAGE
  $ sfdx hardis:org:files:export [-p <string>] [-c <number>] [-t <number>] [-d] [--websocket <string>] [-u <string>] 
  [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -c, --chunksize=chunksize                                                         [default: 1000] Number of records to
                                                                                    add in a chunk before it is
                                                                                    processed

  -d, --debug                                                                       Activate debug mode (more logs)

  -p, --path=path                                                                   Path to the file export project

  -t, --polltimeout=polltimeout                                                     [default: 300000] Timeout in MS for
                                                                                    Bulk API calls

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:org:files:export
```

_See code: [lib/commands/hardis/org/files/export.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/files/export.js)_

## `sfdx hardis:org:purge:apexlog [-z] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Purge apex logs in selected org

```
USAGE
  $ sfdx hardis:org:purge:apexlog [-z] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  -z, --[no-]prompt                                                                 Prompt for confirmation (true by
                                                                                    default, use --no-prompt to skip)

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLES
  $ sfdx hardis:org:purge:apexlog
  $ sfdx hardis:org:purge:apexlog --targetusername nicolas.vuillamy@gmail.com
```

_See code: [lib/commands/hardis/org/purge/apexlog.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/purge/apexlog.js)_

## `sfdx hardis:org:purge:flow [-z] [-n <string>] [-s <string>] [-f] [-r <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Purge Obsolete flow versions to avoid the 50 max versions limit. Filters on Status and Name

```
USAGE
  $ sfdx hardis:org:purge:flow [-z] [-n <string>] [-s <string>] [-f] [-r <string>] [-d] [--websocket <string>] [-u 
  <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -f, --[no-]allowpurgefailure                                                      Allows purges to fail without
                                                                                    exiting with 1. Use
                                                                                    --no-allowpurgefailure to disable

  -n, --name=name                                                                   Filter according to Name criteria

  -r, --instanceurl=instanceurl                                                     [default:
                                                                                    https://login.saleforce.com] URL of
                                                                                    org instance

  -s, --status=status                                                               [default: Obsolete] Filter according
                                                                                    to Status criteria

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  -z, --[no-]prompt                                                                 Prompt for confirmation (true by
                                                                                    default, use --no-prompt to skip)

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLES
  $ sfdx hardis:org:purge:flow --targetusername nicolas.vuillamy@gmail.com
     Found 1 records:
     ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
     30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
     Are you sure you want to delete this list of records (y/n)?: y
     Successfully deleted record: 30109000000kX7uAAE.
     Deleted the following list of records:
     ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
     30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
  
  $ sfdx hardis:org:purge:flow --targetusername nicolas.vuillamy@gmail.com --status "Obsolete,Draft,InvalidDraft --name 
  TestFlow"
     Found 4 records:
     ID                 MASTERLABEL VERSIONNUMBER DESCRIPTION  STATUS
     30109000000kX7uAAE TestFlow    2             test flowwww Obsolete
     30109000000kX8EAAU TestFlow    6             test flowwww InvalidDraft
     30109000000kX8AAAU TestFlow    5             test flowwww InvalidDraft
     30109000000kX89AAE TestFlow    4             test flowwww Draft
     Are you sure you want to delete this list of records (y/n)?: n
     No record deleted
```

_See code: [lib/commands/hardis/org/purge/flow.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/purge/flow.js)_

## `sfdx hardis:org:retrieve:packageconfig [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Retrieve package configuration from an org

```
USAGE
  $ sfdx hardis:org:retrieve:packageconfig [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:org:retrieve:packageconfig
```

_See code: [lib/commands/hardis/org/retrieve/packageconfig.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/retrieve/packageconfig.js)_

## `sfdx hardis:org:retrieve:sources:dx [-f <string>] [-t <string>] [-k <string>] [-m <string>] [-o] [-r <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Retrieve Salesforce DX project from org

```
USAGE
  $ sfdx hardis:org:retrieve:sources:dx [-f <string>] [-t <string>] [-k <string>] [-m <string>] [-o] [-r <string>] [-d] 
  [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -f, --folder=folder                                                               [default: .] Folder

  -k, --keepmetadatatypes=keepmetadatatypes                                         Comma separated list of metadatas
                                                                                    types that will be the only ones to
                                                                                    be retrieved

  -m, --filteredmetadatas=filteredmetadatas                                         Comma separated list of Metadatas
                                                                                    keys to remove from PackageXml file

  -o, --shape                                                                       Updates project-scratch-def.json
                                                                                    from org shape

  -r, --instanceurl=instanceurl                                                     URL of org instance

  -t, --tempfolder=tempfolder                                                       [default: ./tmp] Temporary folder

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:org:retrieve:sources:dx
```

_See code: [lib/commands/hardis/org/retrieve/sources/dx.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/retrieve/sources/dx.js)_

## `sfdx hardis:org:retrieve:sources:dx2 [-x <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Retrieve Salesforce DX project from org

```
USAGE
  $ sfdx hardis:org:retrieve:sources:dx2 [-x <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] 
  [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  -x, --packagexml=packagexml                                                       Path to package.xml file

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:org:retrieve:sources:dx2
```

_See code: [lib/commands/hardis/org/retrieve/sources/dx2.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/retrieve/sources/dx2.js)_

## `sfdx hardis:org:retrieve:sources:metadata [-f <string>] [-p <string>] [-r <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Retrieve Salesforce DX project from org

```
USAGE
  $ sfdx hardis:org:retrieve:sources:metadata [-f <string>] [-p <string>] [-r <string>] [-d] [--websocket <string>] [-u 
  <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -f, --folder=folder                                                               [default: .] Folder
  -p, --packagexml=packagexml                                                       Path to package.xml manifest file
  -r, --instanceurl=instanceurl                                                     URL of org instance

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:org:retrieve:sources:metadata
```

_See code: [lib/commands/hardis/org/retrieve/sources/metadata.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/retrieve/sources/metadata.js)_

## `sfdx hardis:org:select [-h] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Interactive org selection for user

```
USAGE
  $ sfdx hardis:org:select [-h] [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -h, --devhub                                                                      Also connect associated DevHub
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:org:select
```

_See code: [lib/commands/hardis/org/select.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/select.js)_

## `sfdx hardis:org:test:apex [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Run apex test cases on org

```
USAGE
  $ sfdx hardis:org:test:apex [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-d] [--websocket 
  <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -l, --testlevel=(NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg)      [default: RunLocalTests] Level of
                                                                                    tests to apply to validate
                                                                                    deployment

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:org:test:apex
```

_See code: [lib/commands/hardis/org/test/apex.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/test/apex.js)_

## `sfdx hardis:org:user:freeze [-n <string>] [-e <string>] [-m <number>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

freeze mass users in org before a maintenance or go live

```
USAGE
  $ sfdx hardis:org:user:freeze [-n <string>] [-e <string>] [-m <number>] [-d] [--websocket <string>] [-u <string>] 
  [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -e, --except=except                                                               [default: System
                                                                                    Administrator,Administrateur
                                                                                    système] Allow to take all item
                                                                                    except these criteria

  -m, --maxuserdisplay=maxuserdisplay                                               [default: 100] Maximum users to
                                                                                    display in logs

  -n, --name=name                                                                   Filter according to Name criteria

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLES
  $ sfdx hardis:org:user:freeze
  $ sfdx hardis:org:user:freeze --targetusername myuser@myorg.com
  $ sfdx hardis:org:user:freeze --except 'System Administrator,Some Other Profile'
```

_See code: [lib/commands/hardis/org/user/freeze.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/user/freeze.js)_

## `sfdx hardis:org:user:unfreeze [-n <string>] [-e <string>] [-m <number>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Unfreeze mass users in org after a maintenance or go live

```
USAGE
  $ sfdx hardis:org:user:unfreeze [-n <string>] [-e <string>] [-m <number>] [-d] [--websocket <string>] [-u <string>] 
  [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -e, --except=except                                                               [default: System
                                                                                    Administrator,Administrateur
                                                                                    système] Allow to take all item
                                                                                    except these criteria

  -m, --maxuserdisplay=maxuserdisplay                                               [default: 100] Maximum users to
                                                                                    display in logs

  -n, --name=name                                                                   Filter according to Name criteria

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLES
  $ sfdx hardis:org:user:unfreeze
  $ sfdx hardis:org:user:unfreeze --targetusername myuser@myorg.com
  $ sfdx hardis:org:user:unfreeze --except 'System Administrator,Some Other Profile'
```

_See code: [lib/commands/hardis/org/user/unfreeze.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/org/user/unfreeze.js)_

## `sfdx hardis:package:create [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Create a new package

```
USAGE
  $ sfdx hardis:package:create [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -v, --targetdevhubusername=targetdevhubusername                                   username or alias for the dev hub
                                                                                    org; overrides default dev hub org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:package:create
```

_See code: [lib/commands/hardis/package/create.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/package/create.js)_

## `sfdx hardis:package:install [-p] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Install a package

```
USAGE
  $ sfdx hardis:package:install [-p] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -p, --package                                                                     Package Version Id to install
                                                                                    (04t...)

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:package:install
```

_See code: [lib/commands/hardis/package/install.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/package/install.js)_

## `sfdx hardis:package:version:create [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Create a new version of an unlocked package

```
USAGE
  $ sfdx hardis:package:version:create [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -v, --targetdevhubusername=targetdevhubusername                                   username or alias for the dev hub
                                                                                    org; overrides default dev hub org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:package:version:create
```

_See code: [lib/commands/hardis/package/version/create.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/package/version/create.js)_

## `sfdx hardis:package:version:list [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

List versions of unlocked package

```
USAGE
  $ sfdx hardis:package:version:list [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -v, --targetdevhubusername=targetdevhubusername                                   username or alias for the dev hub
                                                                                    org; overrides default dev hub org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:package:version:list
```

_See code: [lib/commands/hardis/package/version/list.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/package/version/list.js)_

## `sfdx hardis:package:version:promote [-d] [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Promote package(s) version(s): convert it from beta to released

```
USAGE
  $ sfdx hardis:package:version:promote [-d] [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --auto                                                                        Auto-detect which versions of which
                                                                                    packages need to be promoted

  -d, --debug                                                                       Activate debug mode (more logs)

  -v, --targetdevhubusername=targetdevhubusername                                   username or alias for the dev hub
                                                                                    org; overrides default dev hub org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLES
  $ sfdx hardis:package:version:promote
  $ sfdx hardis:package:version:promote --auto
```

_See code: [lib/commands/hardis/package/version/promote.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/package/version/promote.js)_

## `sfdx hardis:project:audit:apiversion [-m <number>] [-f] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Audit API version

```
USAGE
  $ sfdx hardis:project:audit:apiversion [-m <number>] [-f] [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -f, --failiferror                                                                 Fails (exit code 1) if an error is
                                                                                    found

  -m, --minimumapiversion=minimumapiversion                                         [default: 20] Minimum allowed API
                                                                                    version

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:audit:apiversion
```

_See code: [lib/commands/hardis/project/audit/apiversion.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/audit/apiversion.js)_

## `sfdx hardis:project:audit:callincallout [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Generate list of callIn and callouts from sfdx project

```
USAGE
  $ sfdx hardis:project:audit:callincallout [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:audit:callouts
```

_See code: [lib/commands/hardis/project/audit/callincallout.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/audit/callincallout.js)_

## `sfdx hardis:project:audit:remotesites [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Generate list of remote sites

```
USAGE
  $ sfdx hardis:project:audit:remotesites [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:audit:remotesites
```

_See code: [lib/commands/hardis/project/audit/remotesites.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/audit/remotesites.js)_

## `sfdx hardis:project:clean:emptyitems [-f <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Remove unwanted empty items within sfdx project sources

```
USAGE
  $ sfdx hardis:project:clean:emptyitems [-f <string>] [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -f, --folder=folder                                                               [default: force-app] Root folder
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:clean:emptyitems
```

_See code: [lib/commands/hardis/project/clean/emptyitems.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/clean/emptyitems.js)_

## `sfdx hardis:project:clean:hiddenitems [-f <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Remove unwanted hidden items within sfdx project sources

```
USAGE
  $ sfdx hardis:project:clean:hiddenitems [-f <string>] [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -f, --folder=folder                                                               [default: force-app] Root folder
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:clean:hiddenitems
```

_See code: [lib/commands/hardis/project/clean/hiddenitems.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/clean/hiddenitems.js)_

## `sfdx hardis:project:clean:manageditems [-n <string>] [-f <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Remove unwanted managed items within sfdx project sources

```
USAGE
  $ sfdx hardis:project:clean:manageditems [-n <string>] [-f <string>] [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -f, --folder=folder                                                               [default: force-app] Root folder
  -n, --namespace=namespace                                                         Namespace to remove
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:clean:manageditems --namespace crta
```

_See code: [lib/commands/hardis/project/clean/manageditems.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/clean/manageditems.js)_

## `sfdx hardis:project:clean:orgmissingitems [-f <string>] [-p <string>] [-t <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Clean SFDX sources from items present neither in target org nor local package.xml

```
USAGE
  $ sfdx hardis:project:clean:orgmissingitems [-f <string>] [-p <string>] [-t <string>] [-d] [--websocket <string>] 
  [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug
      Activate debug mode (more logs)

  -f, --folder=folder
      [default: force-app] Root folder

  -p, --packagexmlfull=packagexmlfull
      Path to packagexml used for cleaning.
      Must contain also standard CustomObject and CustomField elements.
      If not provided, it will be generated from a remote org

  -t, --packagexmltargetorg=packagexmltargetorg
      Target org username or alias to build package.xml (sfdx must be authenticated).
      If not provided, will be prompted to the user.

  --json
      format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)
      [default: warn] logging level for this command invocation

  --websocket=websocket
      Websocket host:port for VsCode SFDX Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:clean:orgmissingitems
```

_See code: [lib/commands/hardis/project/clean/orgmissingitems.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/clean/orgmissingitems.js)_

## `sfdx hardis:project:clean:references [-t <string>] [-c <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Remove unwanted references within sfdx project sources

```
USAGE
  $ sfdx hardis:project:clean:references [-t <string>] [-c <string>] [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -c, --config=config                                                                                 Path to a JSON
                                                                                                      config file or a
                                                                                                      destructiveChanges
                                                                                                      .xml file

  -d, --debug                                                                                         Activate debug
                                                                                                      mode (more logs)

  -t, --type=all|caseentitlement|dashboards|datadotcom|destructivechanges|localfields|productrequest  Cleaning type

  --json                                                                                              format output as
                                                                                                      json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)                    [default: warn]
                                                                                                      logging level for
                                                                                                      this command
                                                                                                      invocation

  --websocket=websocket                                                                               Websocket
                                                                                                      host:port for
                                                                                                      VsCode SFDX Hardis
                                                                                                      UI integration

EXAMPLES
  $ sfdx hardis:project:clean:references
  $ sfdx hardis:project:clean:references --type all
  $ sfdx hardis:project:clean:references --config ./cleaning/myconfig.json
  $ sfdx hardis:project:clean:references --config ./somefolder/myDestructivePackage.xml
```

_See code: [lib/commands/hardis/project/clean/references.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/clean/references.js)_

## `sfdx hardis:project:clean:retrievefolders [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Retrieve dashboards, documents and report folders in DX sources. Use -u ORGALIAS

```
USAGE
  $ sfdx hardis:project:clean:retrievefolders [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:clean:retrievefolders
```

_See code: [lib/commands/hardis/project/clean/retrievefolders.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/clean/retrievefolders.js)_

## `sfdx hardis:project:clean:standarditems [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Remove unwanted standard items within sfdx project sources

```
USAGE
  $ sfdx hardis:project:clean:standarditems [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:clean:standarditems
```

_See code: [lib/commands/hardis/project/clean/standarditems.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/clean/standarditems.js)_

## `sfdx hardis:project:configure:auth [-b] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Configure authentication from git branch to target org

```
USAGE
  $ sfdx hardis:project:configure:auth [-b] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -b, --devhub                                                                      Configure project DevHub
  -d, --debug                                                                       Activate debug mode (more logs)

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:configure:auth
```

_See code: [lib/commands/hardis/project/configure/auth.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/configure/auth.js)_

## `sfdx hardis:project:convert:profilestopermsets [-e <array>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Creates permission sets from existing profiles, with id PS_PROFILENAME

```
USAGE
  $ sfdx hardis:project:convert:profilestopermsets [-e <array>] [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -e, --except=except                                                               [default: ] List of filters
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:convert:profilestopermsets
```

_See code: [lib/commands/hardis/project/convert/profilestopermsets.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/convert/profilestopermsets.js)_

## `sfdx hardis:project:create [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Create a new SFDX Project

```
USAGE
  $ sfdx hardis:project:create [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -v, --targetdevhubusername=targetdevhubusername                                   username or alias for the dev hub
                                                                                    org; overrides default dev hub org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:create
```

_See code: [lib/commands/hardis/project/create.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/create.js)_

## `sfdx hardis:project:deploy:sources:dx [-c] [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-p <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Deploy SFDX project sources to org

```
USAGE
  $ sfdx hardis:project:deploy:sources:dx [-c] [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-p 
  <string>] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -c, --check                                                                       Only checks the deployment, there is
                                                                                    no impact on target org

  -d, --debug                                                                       Activate debug mode (more logs)

  -l, --testlevel=(NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg)      [default: RunLocalTests] Level of
                                                                                    tests to apply to validate
                                                                                    deployment

  -p, --packagexml=packagexml                                                       Path to package.xml containing what
                                                                                    you want to deploy in target org

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:deploy:sources:dx
```

_See code: [lib/commands/hardis/project/deploy/sources/dx.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/deploy/sources/dx.js)_

## `sfdx hardis:project:deploy:sources:metadata [-c] [-p <string>] [-f] [-k <string>] [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Deploy metadatas to source org

```
USAGE
  $ sfdx hardis:project:deploy:sources:metadata [-c] [-p <string>] [-f] [-k <string>] [-l 
  NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-d] [--websocket <string>] [-u <string>] [--apiversion 
  <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -c, --check                                                                       Only checks the deployment, there is
                                                                                    no impact on target org

  -d, --debug                                                                       Activate debug mode (more logs)

  -f, --filter                                                                      Filter metadatas before deploying

  -k, --destructivepackagexml=destructivepackagexml                                 Path to destructiveChanges.xml file
                                                                                    to deploy

  -l, --testlevel=(NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg)      [default: RunLocalTests] Level of
                                                                                    tests to apply to validate
                                                                                    deployment

  -p, --packagexml=packagexml                                                       Path to package.xml file to deploy

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:deploy:sources:metadata
```

_See code: [lib/commands/hardis/project/deploy/sources/metadata.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/deploy/sources/metadata.js)_

## `sfdx hardis:project:generate:gitdelta [--branch <string>] [--fromcommit <string>] [--tocommit <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Generate package.xml git delta between 2 commits

```
USAGE
  $ sfdx hardis:project:generate:gitdelta [--branch <string>] [--fromcommit <string>] [--tocommit <string>] [-d] 
  [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  --branch=branch                                                                   Git branch to use to generate delta
  --fromcommit=fromcommit                                                           Hash of commit to start from
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --tocommit=tocommit                                                               Hash of commit to stop at

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:project:generate:gitdelta
```

_See code: [lib/commands/hardis/project/generate/gitdelta.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/generate/gitdelta.js)_

## `sfdx hardis:project:lint [-f] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Apply syntactic analysis (linters) on the repository sources, using Mega-Linter

```
USAGE
  $ sfdx hardis:project:lint [-f] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -f, --fix                                                                         Apply linters fixes

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLES
  $ sfdx hardis:project:lint
  $ sfdx hardis:project:lint --fix
```

_See code: [lib/commands/hardis/project/lint.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/project/lint.js)_

## `sfdx hardis:scratch:create [-n] [-d] [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Create and initialize a scratch org so it is ready to use

```
USAGE
  $ sfdx hardis:scratch:create [-n] [-d] [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -d, --pool                                                                        Creates the scratch org for a
                                                                                    scratch org pool

  -n, --forcenew                                                                    If an existing scratch org exists,
                                                                                    do not reuse it but create a new one

  -v, --targetdevhubusername=targetdevhubusername                                   username or alias for the dev hub
                                                                                    org; overrides default dev hub org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:scratch:create
```

_See code: [lib/commands/hardis/scratch/create.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/scratch/create.js)_

## `sfdx hardis:scratch:delete [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Deletes a scratch org

```
USAGE
  $ sfdx hardis:scratch:delete [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -v, --targetdevhubusername=targetdevhubusername                                   username or alias for the dev hub
                                                                                    org; overrides default dev hub org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:scratch:delete
```

_See code: [lib/commands/hardis/scratch/delete.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/scratch/delete.js)_

## `sfdx hardis:scratch:pool:create [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Select a data storage service and configure information to build a scratch org pool

```
USAGE
  $ sfdx hardis:scratch:pool:create [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -v, --targetdevhubusername=targetdevhubusername                                   username or alias for the dev hub
                                                                                    org; overrides default dev hub org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:scratch:pool:configure
```

_See code: [lib/commands/hardis/scratch/pool/create.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/scratch/pool/create.js)_

## `sfdx hardis:scratch:pool:localauth [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Calls the related storage service to request api keys and secrets that allows a local user to fetch a scratch org from scratch org pool

```
USAGE
  $ sfdx hardis:scratch:pool:localauth [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -v, --targetdevhubusername=targetdevhubusername                                   username or alias for the dev hub
                                                                                    org; overrides default dev hub org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:scratch:pool:localauth
```

_See code: [lib/commands/hardis/scratch/pool/localauth.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/scratch/pool/localauth.js)_

## `sfdx hardis:scratch:pool:refresh [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Create enough scratch orgs to fill the pool

```
USAGE
  $ sfdx hardis:scratch:pool:refresh [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -v, --targetdevhubusername=targetdevhubusername                                   username or alias for the dev hub
                                                                                    org; overrides default dev hub org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:scratch:pool:refresh
```

_See code: [lib/commands/hardis/scratch/pool/refresh.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/scratch/pool/refresh.js)_

## `sfdx hardis:scratch:pool:view [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Displays all stored content of project scratch org pool if defined

```
USAGE
  $ sfdx hardis:scratch:pool:view [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -v, --targetdevhubusername=targetdevhubusername                                   username or alias for the dev hub
                                                                                    org; overrides default dev hub org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:scratch:pool:view
```

_See code: [lib/commands/hardis/scratch/pool/view.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/scratch/pool/view.js)_

## `sfdx hardis:scratch:pull [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Pull scratch org updates from scratch org to local git branch

```
USAGE
  $ sfdx hardis:scratch:pull [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:scratch:pull
```

_See code: [lib/commands/hardis/scratch/pull.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/scratch/pull.js)_

## `sfdx hardis:scratch:push [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Push local updates in git branch to scratch org

```
USAGE
  $ sfdx hardis:scratch:push [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:scratch:push
```

_See code: [lib/commands/hardis/scratch/push.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/scratch/push.js)_

## `sfdx hardis:work:new [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

New work task

```
USAGE
  $ sfdx hardis:work:new [-d] [--websocket <string>] [-v <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -v, --targetdevhubusername=targetdevhubusername                                   username or alias for the dev hub
                                                                                    org; overrides default dev hub org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:work:task:new
```

_See code: [lib/commands/hardis/work/new.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/work/new.js)_

## `sfdx hardis:work:refresh [-n] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Make my local branch and my scratch org up to date with the most recent sources

```
USAGE
  $ sfdx hardis:work:refresh [-n] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -n, --nopull                                                                      No scratch pull before save (careful
                                                                                    if you use that!)

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:work:refresh
```

_See code: [lib/commands/hardis/work/refresh.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/work/refresh.js)_

## `sfdx hardis:work:resetselection [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Process again the selection of the items that you want to publish to upper level

```
USAGE
  $ sfdx hardis:work:resetselection [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:work:resetsave
```

_See code: [lib/commands/hardis/work/resetselection.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/work/resetselection.js)_

## `sfdx hardis:work:save [-n] [-g] [-c] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

When a work task is completed, guide user to create a merge request

```
USAGE
  $ sfdx hardis:work:save [-n] [-g] [-c] [-d] [--websocket <string>] [-u <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -c, --noclean                                                                     No cleaning of local sources
  -d, --debug                                                                       Activate debug mode (more logs)
  -g, --nogit                                                                       No automated git operations
  -n, --nopull                                                                      No scratch pull before save

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLES
  $ sfdx hardis:work:task:save
  $ sfdx hardis:work:task:save --nopull --nogit --noclean
```

_See code: [lib/commands/hardis/work/save.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/work/save.js)_

## `sfdx hardis:work:ws [-e <string>] [-d] [--websocket <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Technical calls to WebSocket functions

```
USAGE
  $ sfdx hardis:work:ws [-e <string>] [-d] [--websocket <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -e, --event=event                                                                 WebSocket event
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

  --websocket=websocket                                                             Websocket host:port for VsCode SFDX
                                                                                    Hardis UI integration

EXAMPLE
  $ sfdx hardis:work:ws --event refreshStatus
```

_See code: [lib/commands/hardis/work/ws.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.51.2/lib/commands/hardis/work/ws.js)_
<!-- commandsstop -->
