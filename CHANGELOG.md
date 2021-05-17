# Changelog

## [insiders] (master)

Note: Can be used with `sfdx plugins:install sfdx-hardis@beta` and docker image `hardisgroupcom/sfdx-hardis@beta`

- New commands
  - **hardis:org:retrieve:packageconfig**: Retrieves .sfdx-hardis.yml property installedPackaged from an existing org
  - **hardis:project:clean:emptyitems**: Delete empty items from SFD project
  - **hardis:project:clean:hiddenitems**: Delete hidden items (from managed packages) from SFDX project

- Update default values for JWT connected app creation
- Manage `--targetusername` to be taken in account for all sfdx hardis commands
- More deployment tips
- hardis:project:clean:manageditems: New `--namespace` argument
- org:retrieve:source:dx : Do not erase .gitignore, .forceignore , README.md and project-scratch-def is already existing locally
- Remove shape temp folder to avoid a force:org:create bug

## [2.17.2] 2021-05-10

- Default init scratch org using push and not deploy
- QuickFix mergeRequest links local storage

## [2.17.0] 2021-05-10

- New command hardis:project:convert:profilestopermsets to convert all profiles into permission sets
- hardis:scratch:create : Fix permission set auto assignment when creating a scratch org (use property initPermissionSets in .sfdx-hardis.yml)

## [2.16.1] 2021-05-09

- hardis:work:save : Fix storage in config file of Merge Request info
- Update deploy tips

## [2.16.0] 2021-05-08

- hardis:project:clean:manageditems : Clean SFDX project from managed classes
- hardis:project:clean:retrievefolders: Clean/Complete SFDX project with missing folders (dashboard,email,reports)
- hardis:project:clean:standarditems : Clean SFDX project from objects with no custom within
- More deployment error tips
- New parameter websocket for all commands
- Indicating in logs when deployment is a simulation

## [2.15.1] 2021-05-02

- QuickFix hardis:work:save

## [2.15.0] 2021-04-30

- hardis:project:clean:references : New cleaning module **dashboards** removing reference to users in Dashboards sources

## [2.14.0] 2021-04-29

- Manage **manifest/packageDeployOnce.xml** : all its items that are already present in target org will not be deployed again

## [2.13.4] 2021-04-26

- New deploy tips
- Do not update local files when calling configure commands
- hardis:work:save : Fix branch update issue

## [2.13.3] 2021-04-23

- Remove PMD rule :
  - CyclomaticComplexity

## [2.13.2] 2021-04-22

- QuickFix hardis:package:version:promote --auto

## [2.13.0] 2021-04-21

- hardis:work:save
  - New parameter --nogit for expert developers who want to manage git operations themselves
  - New parameter --noclean for expert developers who want to manage clean operations themselves
- Update default Mega-Linter config

## [2.12.0] 2021-04-19

- New variable CI_DEPLOY_QUICK_ACTIONS_DUMMY
  - set to "true" in CI variables when there are QuickActions dependent of Flows that are later in publication plan
  - then set again to "false" and the deployment will pass :)
- hardis:project:clean:references : now deletes obsolete objects and objectTranslations
- hardis:work:save : More categories in interactive git add
- Improve authentication check performances
- New command hardis:config:get to return all config for project, branch or user
- New deployment errors tips

## [2.11.0] 2021-04-15

- Delete scratch org when its initialization has failed during CI
- Clean obsolete object fields and objectTranslations

## [2.10.4] 2021-04-15

- Provide password to user when creating new scratch org
- Update CI default config to allow to not delete scratch orgs (define `CI_DELETE_SCRATCH_ORG: "true"` in gitlab-ci-config.yml)
- New deploy tips: record type not found, picklist value not found

## [2.10.3] 2021-04-14

- Allow advanced user to bypass auth check (set `skipAuthCheck:true` in config/user/\*\*\*.sfdx-hardis.yml)
- Optimize check of `force:config:set restDeploy: false`
- hardis:package:version:create : Store package installation password in project config + fixes

## [2.10.2] 2021-04-14

- hardis:work:refresh : Make sure the user saved his work (commit) before merging another branch in current branch

## [2.10.1] 2021-04-11

- hardis:org:test:apex : Fix regex to new Apex Test results stdout format

## [2.10.0] 2021-04-11

- hardis:work:save : Automatic generation of split package.xml and deploymentPlan in .sfdx-hardis.yml
- hardis:work:save : Propose to export data when saving
- Remove duplicates from .gitignore and .forceignore
- Add chromium in dockerfile

## [2.9.4] 2021-04-09

- Fix refresh
- Update project cleaning references

## [2.9.3] 2021-04-08

- hardis:work:refresh : allow to refresh from another branch

## [2.9.2] 2021-04-08

- hardis:work:save : Fix issue when trying to stage & commit ignored files after project cleaning
- hardis:project:configure:auth Improve error message when unable to upload ConnectedApp on production environment
- Update default Apex PMD ruleset
- Use replace and not replaceAll for node14 compatibility

## [2.9.1] 2021-04-07

- Clean git reset before save
- Clean git stash before new task

## [2.9.0] 2021-04-06

- New command **hardis:project:create**
- Refactor project cleaning and allow to use external config files (destructiveChanges-like.xml or json)
- Fixes
  - hardis:work:save : Create destructiveChanges.xml if not existing
  - hardis:work:save : call forceSourcePull method to propose to update .forceignore if errors are found
  - hardis:project:configure:auth: call mdapi:deploy with RunLocalTests to manage production environments
  - authentication: auth only to devHub if --devhub sent
  - Disable spinner for restDeploy check

## [2.8.5] 2021-04-06

- QuickFix question icon

## [2.8.4] 2021-04-06

- Allow to skip pull before save
- New deployTip: code coverage items with 0%
- Fix DevHub auth when credential out of date
- Use latest sfdx-cli package
- Init git config only if we are not in CI

## [2.8.3] 2021-04-01

- Fix package creation
- When using VsCode UI via WebSocket, display selected values in console logs

## [2.8.2] 2021-04-01

- hardis:work:save : reset ongoing merge if existing
- Fix git reset call

## [2.8.0] 2021-03-31

- Define git user.name and user.email if not set
- Define VsCode as git merge/diff tool if none is defined
- Unstash changes (git reset) at the beginning of hardis:work:save
- Deploy destructive changes after real deployment
- **hardis:project:clean:references** now works also to remove references to content of manifest/destructiveChanges.xml
- **hardis:work:save**: Clean sfdx project while saving it
- Factorize temp directory creation

## [2.7.2] 2021-03-30

- Check user is sure to want to reuse an existing scratch org
- Fix **hardis:work:refresh**

## [2.7.1] 2021-03-29

- Fix auto-fix of .gitignore and .forceignore
- Propose to auto-update .force ignore when there is a pull issue

## [2.7.0] 2021-03-29

- Communicate with VsCode SFDX Hardis extension via WebSocket if server is found
- Send user input prompts to VsCode UI if WebSocket server found
- Send refreshStatus notifications when context is updated
- Arrange some messages for better display on UI

## [2.6.0] 2021-03-28

- New command **hardis:project:clean:references** to clean SFDX project from data.com license references
- **hardis:scratch:create**: Load sfdmu workspace `scripts/data/ScratchInit` if existing in , to initialize scratch org data

## [2.5.0] 2021-03-28

- New command **hardis:source:push**
- New command **hardis:source:pull**
- Various mini-fixes
- Move deploymentPlan.json within .sfdx-hardis.json
- Retry management for execCommand function. ex: `retry: {retryDelay: 30,retryStringConstraint: 'some string present in output', retryMaxAttempts: 5}`

## [2.4.0] 2021-03-27

- Add sfdmu & sfdx-git-delta in dependencies & Dockerfile
- Import data with sfdmu
- Manage data import steps in `deploymentPlan.json`
- New command **hardis:org:data:export**
- New command **hardis:org:data:import**

## [2.3.0] 2021-03-26

- hardis:work:save: Do not git add manifest files when they have not been updated
- Select type of org to connect: enhance label
- Multi-Select default to 9999 items displayed
- Display tips about deployment failures when they happen
- Create scratch org: When DeferSharingCalc in features, suspend and resume sharing calc during force:source:push
- Allow to define a file `manifest/deploymentPlan.json` to split the deployment into separate package.xml files

Example:

```json
{
  "packages": [
    {
      "label": "SharingRulesAccount",
      "packageXmlFile": "splits/packageXmlSharingRulesAccount.xml",
      "order": 10,
      "waitAfter": 60
    },
    {
      "label": "SharingRulesVisit__c",
      "packageXmlFile": "splits/packageXmlSharingRulesAccountVisit__c.xml",
      "order": 10
    }
  ]
}
```

## [2.2.1] 2021-03-23

- QuickFix 2.2.1
- Use RunLocalTests when deploying ConnectedApp metadata to production org

## [2.2.0] 2021-03-23

- Enhance security by encrypting SSH private key

## [2.1.7] 2021-03-22

- More categories for Interactive Git Add (Aura,LWC, Tech Config)
- Auto-update .forceignore
- Fix `hardis:org:test:apex`

## [2.1.6] 2021-03-20

- Fix org authentication check

## [2.1.5] 2021-03-19

- Unlimited list of items displayed during interactive git add
- Uniformize prompts to user

## [2.1.4] 2021-03-17

- Deploy with --ignorewarnings

## [2.1.3] 2021-03-17

- Fix hardis:retrieve:sources:dx when not in a DX project
- Fix deloyment of Connected App in production
- Display more options by page during interactive git add
- Sort files to git add by group and manage preselection

## [2.1.2] 2021-03-14

- Improve package installation
  - Allow to install a package not listed in sfdx-hardis
  - Allow to configure automatic installation during deployments, or not
  - Allow to configure automatic installation during scratch org initialisation, or not
- Reformat strings when no spaces are allowed in a user input

## [2.1.1] 2021-03-12

- Fix **hardis:scratch:create** when initDataRequests

## [2.1.0] 2021-03-10

- New command **hardis:data:tree:export**
- **scratch:create**: Import init data using .sfdx-hardis.yml `initDataRequests` property
- **scratch:create**: Assign to permission set (or PS groups) using .sfdx-hardis.yml `initPermissionSets` property

## [2.0.0] 2021-03-09

- New command **hardis:package:create** to create Managed and Unlocked packages
- Migrate from tslint to eslint
- Fix dependencies hell
- Fix **hardis:org:purge:flow** with new result format [(#49)](https://github.com/hardisgroupcom/sfdx-hardis/issues/49)

## [1.6.1] 2021-03-09

- Update sfdx-project.json when installing a package
- Refresh env & scratch org if same scratch org is reused
- Update default files for CI & monitoring projects
- Do not deploy packages from hardis:project:deploy:sources:dx when we are in --check mode !
- Better output display for hardis:org:test:apex

## [1.6.0] - 2021-03-08

- New package commands
  - **hardis:package:install**
  - **hardis:package:version:create**
  - **hardis:package:version:list**

## [1.5.1] - 2021-03-07

- Use shared Mega-Linter configuration

## [1.5.0] 2021-03-05

- New command **hardis:org:select**
- New command **hardis:work:resetselection**
- **hardis:work:save**: Upgrade package.xml and destructiveChanges.xml from git diff
- Improve console logging of git operations

## [1.4.1] 2021-03-03

- Update default gitlab-ci.yml
- rename commands:
  - **hardis:work:new**
  - **hardis:work:refresh**
  - **hardis:work:save**
- cosmetic enhancements

## [1.4.0] 2021-02-28

- New work commands to make easier non technical users to use Hardis CI
  - **hardis:work:task:new**
  - **hardis:work:task:save**
  - **hardis:work:task:refresh**

## [1.3.6] 2021-02-26

- Quick fix hardis:org:configure:monitoring + colors

## [1.3.5] 2021-02-26

- Workaround when --soapdeploy argument is not available

## [1.3.4] 2021-02-25

- Reuse msTeamsWebhookUrl during sfdx:org:configure:monitoring prompts
- Allow to override CONFIG_BRANCH to get forced .sfdx.hardis.BRANCH.yml

## [1.3.3] 2021-02-24

- Soap option for force:mdapi:deploy

## [1.3.2] 2021-02-24

- Guide user to assign rights to Connected App in **sfdx:org:configure:monitoring**

## [1.3.1] 2021-02-24

- Manage git clone & push for **sfdx:org:configure:monitoring**
- Manage upload of connected app metadata for **sfdx:org:configure:monitoring**

## [1.3.0] 2021-02-23

- #30: Remove use of sfdx-node
- New command **sfdx:project:deploy:sources:metadata**
- Generate .cache folder only when necessary
- New command **sfdx:org:configure:monitoring**

## [1.2.0] 2021-02-21

- #24: Change the way of listing installed packages
- #26: New command sfdx hardis:project:configure:deployments to configure Connected app
- #27: Check in manifest folder for package.xml
- Auto-generate **alpha** version of plugin package and associated docker image when publishing from branch **alpha**
- Manage cache storage for CI dependent jobs (cache, artifacts)
  - .cache/sfdx-hardis/.sfdx
  - .sfdx
  - config/user
- Improve org authentication
- New command **hardis:org:test**
  - Test org coverage and fail if < 75%
- Installed package management
  - Factorize method
  - Install packages during hardis:project:deploy:sources:dx
- Allow to reuse scratch org if previous creation failed. Force using --forcenew
- Improve auto-update of local project sfdx-hardis files
- Improve console logs
- Allow to store DevHubSfdxClientId in user sfdx-hardis.yml ( in /user folder)

## [1.1.3] 2021-02-17

- Fix cases when directory is not git

## [1.1.0] 2021-02-17

- New command **hardis:project:deploy:sources:dx** (alpha)
- New command **hardis:project:audit:apiversion**

## [1.0.1] 2021-02-15

- Fix auth:login to avoid DevHub auth when not necessary

## [1.0.0] 2021-02-15

- New command **hardis:scratch:create**
- Advanced project initialization using `--shape` argument for `sfdx hardis:org:retrieve:sources:dx`
- Automatic generation of .sfdx-hardis\*.yml configuration files
- Automatic update of project package.json to add sfdx-hardis utilities

## [0.5.10] 2021-02-12

- Allow purges to fail without making sfdx command fail

## [0.5.5] 2021-02-10

- Check if installed sfdx-hardis is the latest version, else display a message to advise the user to upgrade to latest

## [0.5.4] 2021-02-09

- Fixes:
  - `hardis:org:purge:flow`: Do not crash in case the Flow is not deletable

## [0.5.2] 2021-02-07

- Fixes:
  - `--no-prompt` argument is ignored

## [0.5.1] 2021-02-04

- Fixes:
  - Add more items to metadatas not convertible to sfdx sources
  - Issue when using --sandbox argument

## [0.5.0] 2021-02-03

- New command `hardis:project:audit:callincallout`: Audit sfdx project (or metadatas) sources to list all CallIns and CallOuts from Apex / Triggers code parsing
- New command `hardis:project:audit:remotesites`: Audit sfdx project (or metadatas) sources to list all remote site settings of an org

## [0.4.1] 2021-02-01

- Fix: Manage Hooks only from hardis namespace commands

## [0.4.0] 2021-02-01

- Send MS Teams notifications if set environment variable MS_TEAMS_WEBHOOK_URL or msTeamsWebhookUrl in .sfdx-hardis.yml

## [0.3.1] 2021-01-31

- Always regenerate full package.xml before retrieving metadatas

## [0.3.0] 2021-01-31

- Build and upload nvuillam/sfdx-hardis docker image when releasing a new version
- New command force:auth:login + manage login using JWT for CI

## [0.2.0] 2021-01-31

- New command **sfdx hardis:org:retrieve:sources:metadata** : Retrieve all metadata from an org

## [0.1.1] 2021-01-31

- New command **sfdx hardis:org:retrieve:sources:dx** : Create SFDX project from remote org

## [0.0.1] 2021-01-26

- New command **sfdx hardis:org:purge:flow** : Purge Obsolete flow versions to avoid the 50 max versions limit
