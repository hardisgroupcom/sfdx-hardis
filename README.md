[![Hardis Group Logo](docs/assets/images/hardis-banner.jpg)](https://www.hardis-group.com/en/services-solutions/services/integration/salesforce-consulting-and-integration)

# sfdx-hardis

[![Version](https://img.shields.io/npm/v/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
[![Mega-Linter](https://github.com/hardisgroupcom/sfdx-hardis/workflows/Mega-Linter/badge.svg?branch=main)](https://github.com/hardisgroupcom/sfdx-hardis/actions?query=workflow%3AMega-Linter+branch%3Amain)
[![Downloads/week](https://img.shields.io/npm/dw/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
[![License](https://img.shields.io/npm/l/sfdx-hardis.svg)](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

Toolbox for Salesforce DX, by [Hardis-Group](https://www.hardis-group.com/en/services-solutions/services/integration/salesforce-consulting-and-integration)

This toolbox contains commands than can be run locally or from CI.
For the moment, it can :

- BackUp / Monitoring tools
  - Retrieve all metadatas of an org
  - Retrieve all metadatas of an org and convert them into a Salesforce DX Project
- Audit tools
  - Extract all CallIns and CallOuts from a SFDX project (or metadata) folder. Sort by SOAP, REST, HTTP
  - Extract all remote sites connected to an org. Sort by HTTP / HTTPS and domain
- Help tools
  - Purge obsolete flows versions

<!-- toc -->
* [sfdx-hardis](#sfdx-hardis)
<!-- tocstop -->

## Installation

### SFDX Plugin

```sh-session
sfdx plugins:install sfdx-hardis
```

### Docker

You can use docker image **hardisgroupcom/sfdx-hardis**

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

## Commands
<!-- commands -->
* [`sfdx hardis:auth:login [-r <string>] [-h] [-s] [-d] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisauthlogin--r-string--h--s--d---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:configure:monitoring [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgconfiguremonitoring--d--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:data:export [-p <string>] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgdataexport--p-string--d--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:data:import [-p <string>] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgdataimport--p-string--d--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:purge:flow [-z] [-n <string>] [-s <string>] [-f] [-r <string>] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgpurgeflow--z--n-string--s-string--f--r-string--d--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:retrieve:sources:dx [-f <string>] [-t <string>] [-m <string>] [-o] [-r <string>] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgretrievesourcesdx--f-string--t-string--m-string--o--r-string--d--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:retrieve:sources:metadata [-f <string>] [-p <string>] [-r <string>] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgretrievesourcesmetadata--f-string--p-string--r-string--d--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:select [-h] [-d] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgselect--h--d---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:org:test:apex [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisorgtestapex--l-notestrunrunspecifiedtestsrunlocaltestsrunalltestsinorg--d--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:package:create [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardispackagecreate--d--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:package:install [-p] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardispackageinstall--p--d--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:package:version:create [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardispackageversioncreate--d--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:package:version:list [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardispackageversionlist--d--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:audit:apiversion [-m <number>] [-f] [-d] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectauditapiversion--m-number--f--d---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:audit:callincallout [-d] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectauditcallincallout--d---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:audit:remotesites [-d] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectauditremotesites--d---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:clean:references [-t <string>] [-c <string>] [-d] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectcleanreferences--t-string--c-string--d---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:configure:auth [-b] [-d] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectconfigureauth--b--d---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:create [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectcreate--d--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:deploy:sources:dx [-c] [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-p <string>] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectdeploysourcesdx--c--l-notestrunrunspecifiedtestsrunlocaltestsrunalltestsinorg--p-string--d--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:project:deploy:sources:metadata [-c] [-p <string>] [-f] [-k <string>] [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisprojectdeploysourcesmetadata--c--p-string--f--k-string--l-notestrunrunspecifiedtestsrunlocaltestsrunalltestsinorg--d--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:scratch:create [-n] [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisscratchcreate--n--d--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:scratch:pull [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisscratchpull--d--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:scratch:push [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisscratchpush--d--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:work:new [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisworknew--d--v-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:work:refresh [-n] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisworkrefresh--n--d--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:work:resetselection [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisworkresetselection--d--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)
* [`sfdx hardis:work:save [-n] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`](#sfdx-hardisworksave--n--d--u-string---apiversion-string---json---loglevel-tracedebuginfowarnerrorfataltracedebuginfowarnerrorfatal)

## `sfdx hardis:auth:login [-r <string>] [-h] [-s] [-d] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Login to salesforce org

```
USAGE
  $ sfdx hardis:auth:login [-r <string>] [-h] [-s] [-d] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -h, --devhub                                                                      Also connect associated DevHub
  -r, --instanceurl=instanceurl                                                     URL of org instance
  -s, --scratchorg                                                                  Scratch org
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

EXAMPLE
  $ sfdx hardis:auth:login
```

_See code: [lib/commands/hardis/auth/login.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/auth/login.js)_

## `sfdx hardis:org:configure:monitoring [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Configure monitoring of an org

```
USAGE
  $ sfdx hardis:org:configure:monitoring [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
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

EXAMPLE
  $ sfdx hardis:org:configure:monitoring
```

_See code: [lib/commands/hardis/org/configure/monitoring.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/org/configure/monitoring.js)_

## `sfdx hardis:org:data:export [-p <string>] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Export data from org using sfdmu

```
USAGE
  $ sfdx hardis:org:data:export [-p <string>] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

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

EXAMPLE
  $ sfdx hardis:org:data:export
```

_See code: [lib/commands/hardis/org/data/export.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/org/data/export.js)_

## `sfdx hardis:org:data:import [-p <string>] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Import data in org using sfdmu

```
USAGE
  $ sfdx hardis:org:data:import [-p <string>] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

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

EXAMPLE
  $ sfdx hardis:org:data:import
```

_See code: [lib/commands/hardis/org/data/import.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/org/data/import.js)_

## `sfdx hardis:org:purge:flow [-z] [-n <string>] [-s <string>] [-f] [-r <string>] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Purge Obsolete flow versions to avoid the 50 max versions limit. Filters on Status and Name

```
USAGE
  $ sfdx hardis:org:purge:flow [-z] [-n <string>] [-s <string>] [-f] [-r <string>] [-d] [-u <string>] [--apiversion 
  <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

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

_See code: [lib/commands/hardis/org/purge/flow.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/org/purge/flow.js)_

## `sfdx hardis:org:retrieve:sources:dx [-f <string>] [-t <string>] [-m <string>] [-o] [-r <string>] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Retrieve Salesforce DX project from org

```
USAGE
  $ sfdx hardis:org:retrieve:sources:dx [-f <string>] [-t <string>] [-m <string>] [-o] [-r <string>] [-d] [-u <string>] 
  [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -f, --folder=folder                                                               [default: .] Folder

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

EXAMPLE
  $ sfdx hardis:org:retrieve:sources:dx
```

_See code: [lib/commands/hardis/org/retrieve/sources/dx.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/org/retrieve/sources/dx.js)_

## `sfdx hardis:org:retrieve:sources:metadata [-f <string>] [-p <string>] [-r <string>] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Retrieve Salesforce DX project from org

```
USAGE
  $ sfdx hardis:org:retrieve:sources:metadata [-f <string>] [-p <string>] [-r <string>] [-d] [-u <string>] [--apiversion 
  <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

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

EXAMPLE
  $ sfdx hardis:org:retrieve:sources:metadata
```

_See code: [lib/commands/hardis/org/retrieve/sources/metadata.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/org/retrieve/sources/metadata.js)_

## `sfdx hardis:org:select [-h] [-d] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Interactive org selection for user

```
USAGE
  $ sfdx hardis:org:select [-h] [-d] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -h, --devhub                                                                      Also connect associated DevHub
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

EXAMPLE
  $ sfdx hardis:org:select
```

_See code: [lib/commands/hardis/org/select.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/org/select.js)_

## `sfdx hardis:org:test:apex [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Run apex test cases on org

```
USAGE
  $ sfdx hardis:org:test:apex [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-d] [-u <string>] 
  [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

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

EXAMPLE
  $ sfdx hardis:org:test:apex
```

_See code: [lib/commands/hardis/org/test/apex.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/org/test/apex.js)_

## `sfdx hardis:package:create [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Create a new package

```
USAGE
  $ sfdx hardis:package:create [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel 
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

EXAMPLE
  $ sfdx hardis:package:create
```

_See code: [lib/commands/hardis/package/create.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/package/create.js)_

## `sfdx hardis:package:install [-p] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Install a package

```
USAGE
  $ sfdx hardis:package:install [-p] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

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

EXAMPLE
  $ sfdx hardis:package:install
```

_See code: [lib/commands/hardis/package/install.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/package/install.js)_

## `sfdx hardis:package:version:create [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Create a new version of an unlocked package

```
USAGE
  $ sfdx hardis:package:version:create [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel 
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

EXAMPLE
  $ sfdx hardis:package:version:create
```

_See code: [lib/commands/hardis/package/version/create.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/package/version/create.js)_

## `sfdx hardis:package:version:list [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

List versions of unlocked package

```
USAGE
  $ sfdx hardis:package:version:list [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel 
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

EXAMPLE
  $ sfdx hardis:package:version:list
```

_See code: [lib/commands/hardis/package/version/list.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/package/version/list.js)_

## `sfdx hardis:project:audit:apiversion [-m <number>] [-f] [-d] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Audit API version

```
USAGE
  $ sfdx hardis:project:audit:apiversion [-m <number>] [-f] [-d] [--json] [--loglevel 
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

EXAMPLE
  $ sfdx hardis:project:audit:apiversion
```

_See code: [lib/commands/hardis/project/audit/apiversion.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/project/audit/apiversion.js)_

## `sfdx hardis:project:audit:callincallout [-d] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Generate list of callIn and callouts from sfdx project

```
USAGE
  $ sfdx hardis:project:audit:callincallout [-d] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

EXAMPLE
  $ sfdx hardis:project:audit:callouts
```

_See code: [lib/commands/hardis/project/audit/callincallout.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/project/audit/callincallout.js)_

## `sfdx hardis:project:audit:remotesites [-d] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Generate list of remote sites

```
USAGE
  $ sfdx hardis:project:audit:remotesites [-d] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

EXAMPLE
  $ sfdx hardis:project:audit:remotesites
```

_See code: [lib/commands/hardis/project/audit/remotesites.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/project/audit/remotesites.js)_

## `sfdx hardis:project:clean:references [-t <string>] [-c <string>] [-d] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Remove unwanted references within sfdx project sources

```
USAGE
  $ sfdx hardis:project:clean:references [-t <string>] [-c <string>] [-d] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -c, --config=config                                                               Path to a JSON config file or a
                                                                                    destructiveChanges.xml file

  -d, --debug                                                                       Activate debug mode (more logs)

  -t, --type=all|datadotcom|destructivechanges|localfields                          Cleaning type

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

EXAMPLES
  $ sfdx hardis:project:clean:references
  $ sfdx hardis:project:clean:references --type all
  $ sfdx hardis:project:clean:references --config ./cleaning/myconfig.json
  $ sfdx hardis:project:clean:references --config ./somefolder/myDestructivePackage.xml
```

_See code: [lib/commands/hardis/project/clean/references.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/project/clean/references.js)_

## `sfdx hardis:project:configure:auth [-b] [-d] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Configure authentication from git branch to target org

```
USAGE
  $ sfdx hardis:project:configure:auth [-b] [-d] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -b, --devhub                                                                      Configure project DevHub
  -d, --debug                                                                       Activate debug mode (more logs)
  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

EXAMPLE
  $ sfdx hardis:project:configure:auth
```

_See code: [lib/commands/hardis/project/configure/auth.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/project/configure/auth.js)_

## `sfdx hardis:project:create [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Create a new SFDX Project

```
USAGE
  $ sfdx hardis:project:create [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel 
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

EXAMPLE
  $ sfdx hardis:project:create
```

_See code: [lib/commands/hardis/project/create.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/project/create.js)_

## `sfdx hardis:project:deploy:sources:dx [-c] [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-p <string>] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Deploy SFDX project sources to org

```
USAGE
  $ sfdx hardis:project:deploy:sources:dx [-c] [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-p 
  <string>] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
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

EXAMPLE
  $ sfdx hardis:project:deploy:sources:dx
```

_See code: [lib/commands/hardis/project/deploy/sources/dx.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/project/deploy/sources/dx.js)_

## `sfdx hardis:project:deploy:sources:metadata [-c] [-p <string>] [-f] [-k <string>] [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Deploy metadatas to source org

```
USAGE
  $ sfdx hardis:project:deploy:sources:metadata [-c] [-p <string>] [-f] [-k <string>] [-l 
  NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg] [-d] [-u <string>] [--apiversion <string>] [--json] 
  [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

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

EXAMPLE
  $ sfdx hardis:project:deploy:sources:metadata
```

_See code: [lib/commands/hardis/project/deploy/sources/metadata.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/project/deploy/sources/metadata.js)_

## `sfdx hardis:scratch:create [-n] [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Create and initialize a scratch org so it is ready to use

```
USAGE
  $ sfdx hardis:scratch:create [-n] [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)

  -n, --forcenew                                                                    If an existing scratch org exists,
                                                                                    do not reuse it but create a new one

  -v, --targetdevhubusername=targetdevhubusername                                   username or alias for the dev hub
                                                                                    org; overrides default dev hub org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

EXAMPLE
  $ sfdx hardis:scratch:create
```

_See code: [lib/commands/hardis/scratch/create.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/scratch/create.js)_

## `sfdx hardis:scratch:pull [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Pull scratch org updates from scratch org to local git branch

```
USAGE
  $ sfdx hardis:scratch:pull [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
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

EXAMPLE
  $ sfdx hardis:scratch:pull
```

_See code: [lib/commands/hardis/scratch/pull.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/scratch/pull.js)_

## `sfdx hardis:scratch:push [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Push local updates in git branch to scratch org

```
USAGE
  $ sfdx hardis:scratch:push [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
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

EXAMPLE
  $ sfdx hardis:scratch:push
```

_See code: [lib/commands/hardis/scratch/push.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/scratch/push.js)_

## `sfdx hardis:work:new [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

New work task

```
USAGE
  $ sfdx hardis:work:new [-d] [-v <string>] [--apiversion <string>] [--json] [--loglevel 
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

EXAMPLE
  $ sfdx hardis:work:task:new
```

_See code: [lib/commands/hardis/work/new.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/work/new.js)_

## `sfdx hardis:work:refresh [-n] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Make my local branch and my scratch org up to date with the most recent sources

```
USAGE
  $ sfdx hardis:work:refresh [-n] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
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

EXAMPLE
  $ sfdx hardis:work:refresh
```

_See code: [lib/commands/hardis/work/refresh.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/work/refresh.js)_

## `sfdx hardis:work:resetselection [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

Process again the selection of the items that you want to publish to upper level

```
USAGE
  $ sfdx hardis:work:resetselection [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
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

EXAMPLE
  $ sfdx hardis:work:resetsave
```

_See code: [lib/commands/hardis/work/resetselection.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/work/resetselection.js)_

## `sfdx hardis:work:save [-n] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]`

When a work task is completed, guide user to create a merge request

```
USAGE
  $ sfdx hardis:work:save [-n] [-d] [-u <string>] [--apiversion <string>] [--json] [--loglevel 
  trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL]

OPTIONS
  -d, --debug                                                                       Activate debug mode (more logs)
  -n, --nopull                                                                      No scratch pull before save

  -u, --targetusername=targetusername                                               username or alias for the target
                                                                                    org; overrides default target org

  --apiversion=apiversion                                                           override the api version used for
                                                                                    api requests made by this command

  --json                                                                            format output as json

  --loglevel=(trace|debug|info|warn|error|fatal|TRACE|DEBUG|INFO|WARN|ERROR|FATAL)  [default: warn] logging level for
                                                                                    this command invocation

EXAMPLE
  $ sfdx hardis:work:task:save
```

_See code: [lib/commands/hardis/work/save.js](https://github.com/hardisgroupcom/sfdx-hardis/blob/v2.9.4/lib/commands/hardis/work/save.js)_
<!-- commandsstop -->
