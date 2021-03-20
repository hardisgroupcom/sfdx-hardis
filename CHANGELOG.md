# Changelog

## [insiders] (master)

Note: Can be used with `sfdx plugins:install sfdx-hardis@beta` and docker image `hardisgroupcom/sfdx-hardis@beta`

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
- Automatic generation of .sfdx-hardis*.yml configuration files
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

