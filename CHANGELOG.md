# Changelog

## [beta] (master)

Note: Can be used with `sfdx plugins:install sfdx-hardis@beta` and docker image `hardisgroupcom/sfdx-hardis@beta`

**BREAKING CHANGE**: If you are not using sfdx-hardis docker images, you need to **manually update your CI/CD pipelines** scripts using sfdx-hardis (gitlab-ci.yml, azure-pipelines.yml...) to:

- **replace `sfdx-cli` by `@salesforce/cli`**
- **Add `sf plugins install @salesforce/plugin-packaging` just after `npm install @salesforce/cli --global`**

Other upgrades

- Upgrade CI/CD scripts and sfdx-hardis docker images from **sfdx-cli** to **@salesforce/cli** (sfdx commands remain called in background), and add `@salesforce/plugin-packaging` by default
- Now also release sfdx-hardis images on GitHub Packages (ghcr.io)
- Internal CI refactorization
  - Secure releases with GitHub Actions permissions & environments
  - Switch to [official docker build & push action](https://github.com/docker/build-push-action)
  - Upgrade MegaLinter
  - Upgrade npm dependencies

## [3.19.4] 2023-07-18

- Add confirmation before resetting a git branch from VsCode command "Reset selected list of items to merge" (from an original idea of @derroman)

## [3.19.3] 2023-07-10

- Allow to disable red colors for force:source:deploy output using env variable **SFDX_HARDIS_DEPLOY_ERR_COLORS=false**

## [3.19.2] 2023-07-06

- Add packaging in online doc menu

## [3.19.1] 2023-07-05

- Add Hotfix management (BUILD vs RUN) in CI/CD documentation
- Add Packaging & package version instructions in documentation

## [3.19.0] 2023-07-03

- Monitoring: Do not exclude custom fields on managed objects
  -ex: Remove `Ns__Object__c.Ns__Field__c`, but keep `Ns__Object__c.Field__c`

## [3.18.1] 2023-06-13

- QuickFix hardis:work:save when branch has not been created on the computer

## [3.18.0] 2023-06-07

- Clean entitlement items, by @yamioliva in <https://github.com/hardisgroupcom/sfdx-hardis/pull/381>

## [3.17.0] 2022-05-30

- New command **hardis:org:generate:packagexmlfull** to generate the full package.xml of a selected Salesforce org

## [3.16.1] 2022-05-29

- Also remove standard fields when running **hardis:project:clean:standarditems**
- New Deployment tips
  - Wrong api Version of a Metadata
  - Unknown user
- Upgrade to MegaLinter v7

## [3.16.0] 2022-05-24

- New ENV variables to override default wait on retrieve/deploy/test commands
  - SFDX_RETRIEVE_WAIT_MINUTES
  - SFDX_DEPLOY_WAIT_MINUTES
  - SFDX_TEST_WAIT_MINUTES
- Update default .forceignore content

## [3.15.0] 2022-05-11

- Allow to define property **availableProjects** so when user clicks on New task (hardis:work:new), he/she is asked to select a project, that will be used to build the new git branch name
- When creating new task, store the target branch so it is not prompted again when waiting to save/publish the task.

## [3.14.2] 2022-05-03

- More explicit text to ask user if he/she wants to update its selected sandbox while creating a new task
- Do not ask to change default target branch if there are multiple available branches

## [3.14.1] 2022-04-19

- Allow to override the default deployment wait time (60) using variable SFDX_DEPLOY_WAIT_MINUTES
- Update JSON schema to add customOrgColors

## [3.14.0] 2022-04-14

- Fix breaking change of sfdx-git-delta (many thanks @scolladon !)
- Deploy tips
  - Invalid report type
  - Missing report
  - Update missing email template message
- Add more space between error lines in PR/MR comments
- Upgrade xml2js dependency
- Update call to MegaLinter in Azure integrations

## [3.13.1] 2022-04-12

- Fix missing sfdx-git-delta in Docker image

## [3.13.0] 2022-04-06

- Change defaut package install mode to **AdminsOnly**
- When minimizing Profiles, do not remove the **personAccountDefault=true** elements
- Add new deploy tip: Error parsing file

## [3.12.3] 2022-04-04

- Do not add EmailTemplate and Flows as separate items in deploymentPlan, as metadata API now can handle their deployment with the rest of the sources
- Add new deployTip: Missing multi-currency field
- Update label when creating a new task using an existing sandbox

## [3.12.2] 2022-03-30

- New deployment error tips
  - SortOrder must be in sequential order from 1. (Duplicate Rules issue)
  - Invalid field:ACCOUNT.NAME in related list:RelatedContactAccountRelationList
- Add more matchers for duplicate detector

## [3.12.1] 2022-03-29

- Fix false positive error in deployment job when there is no related Pull/Merge request

## [3.12.0] 2022-03-23

- Integration with [Azure Pipelines Pull Request threads](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-azure/)
- **hardis:work:new**: Allow to select no org even of sandbox or scratch is forced on the project using config property **allowedOrgTypes**
- Doc: rename _User Guide_ into [Contributor Guide](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-use-home/)

## [3.11.1] 2022-03-20

- Better fix for root path issues (internal error)

## [3.11.0] 2022-03-20

- Fix root path issues (internal error)

## [3.10.2] 2022-03-16

- Fix sandbox check when calling hardis:source:push

## [3.10.1] 2022-03-15

- Quick fix Gitlab integration when there is no MR associated to a deployment

## [3.10.0] 2022-03-15

- Post a Gitlab Merge Request note when checking a deployment **(beta)**
  - Deployment errors with resolution tips
  - Failing test classes
  - Code coverage
- Do not remove then restore lookup filters when source:push on a source-tracked sandbox
- Catch and display errors when caused by internet connection issue

## [3.9.2] 2022-03-09

- Update deploy tips for error _Unknown user permission: SendExternalEmailAvailable_

## [3.9.1] 2022-03-08

- Improve logs for false positive after package installation failure
- Remove useless and scary log after a successful login :)
- Remove npm cache from Docker image

## [3.9.0] 2022-03-08

- New task with source tracked sandbox:
  - Do not allow to select a major org for dev or config
  - Open SF org if selected from the already connected list
  - Init packages only if defined in config
  - Enhance labels
- Save task: Notify that once the merge request is merged, you must create a new task that will create a new branch
- Improve login error messages
- Use latest version of [MegaLinter](https://megalinter.io)

## [3.8.0] 2022-03-03

- Manage deprecation of force:mdapi:legacy:deploy, replaced by force:mdapi:deploy
- Update default packageDeployOnce.xml when creating a new project (related to [Overwrite management](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-config-overwrite/))
- Update CI/CD documentation
  - Initialize orgs
- Update labels of prompts when creating a new sfdx-hardis project

## [3.7.1] 2022-02-27

- Use tooling API to retrieve ApexLogs for deletion, by @thvd in <https://github.com/hardisgroupcom/sfdx-hardis/pull/321>

## [3.7.0] 2022-02-27

- Add demo video about [configuring authentication between CI and Salesforce orgs](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-auth/)
- Update CI/CD documentation
- Update branding

## [3.6.0] 2022-02-23

- Add sfdx sources to monitoring for better readability
- Change example of email addresses for prompts
- Update CI/CD recommendations in documentation

## [3.5.0] 2022-02-22

- Update default overwrite config (`packageDeployOnce.xml`)
- Setup CI: Define default Azure pipelines YML files
- Fix notification logs for Azure Pipelines

## [3.4.0] 2022-02-21

- Move documentation to <https://sfdx-hardis.cloudity.com>

## [3.3.2] 2022-02-17

- Fix default monitoring for Azure pipelines
- Update CI documentation (Azure)

## [3.3.1] 2022-02-16

- Fix check of newer package installed

## [3.3.0] 2022-02-14

- Compliance of monitoring setup with **Azure Pipelines**
- **hardis:org:retrieve:source:metadata** enhancements
  - new option **--includemanaged**, disabled by default, to avoid having too many items to retrieve during monitoring job
  - allow to force monitoring additional tasks using env var **SFDX_HARDIS_MONITORING** set to "true"

## [3.2.0] 2022-02-10

- Fix issue when logging to a new org during command **hardis:source:retrieve**
- Implement check of code coverage when calling **sfdx hardis:project:deploy:sources:dx --check**
  - 75% minimum by default, overridable in property **apexTestsMinCoverageOrgWide** in .sfdx-hardis.yml, or using env var **APEX_TESTS_MIN_COVERAGE_ORG_WIDE**
- Add **--checkcoverage** option to wrapper command **hardis:source:deploy**
  - Example: `sfdx hardis:source:deploy -x manifest/package.xml --wait 60 --ignorewarnings --testlevel RunLocalTests --postdestructivechanges ./manifest/destructiveChanges.xml --targetusername nicolas.vuillamy@cloudity.com --checkonly --checkcoverage --verbose --coverageformatters json-summary`

## [3.1.0] 2022-02-07

- Reset local sfdx tracking when reusing a sandbox for a new task

## [3.0.0] 2022-02-07

- Breaking change: SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES is now "true" by default. If you want to apply the deploymentPlan in .sfdx-hardis, you need to define variable SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES="false"

## [2.100.0] 2022-02-07

- **hardis:work:new:**: When creating a new task and using a source-tracked sandbox, ask user to push sources, assign permission sets and load data to initialize it.
- Add explicit error message when scratch org creation is caused by a limit reach
- Update default API version to 56.0
- Improve labels when prompting to select an org
- Update CI/CD documentation

## [2.99.1] 2022-01-31

- Fix `hardis:project:clean:hiddenitems` when multiple files in the same folder match the same glob pattern
- Update documentation, fix typos and dead links

## [2.99.0] 2022-01-30

- Replace [prompts](https://www.npmjs.com/package/prompts) library by [inquirer](https://www.npmjs.com/package/inquirer), because prompts is buggy
- Dockerfile: Workaround for <https://github.com/forcedotcom/salesforcedx-apex/issues/213> (force:apex:test:run with code coverage crashing on some Gitlab runners with _Invalid time value_)
- Allow to override the proposed branch names when calling [hardis:work:new](https://sfdx-hardis.cloudity.com/hardis/work/new/), using property **branchPrefixChoices**
- hardis:project:clean:hiddenitems: Also clean LWC with hidden content
- Add yarn in dockerfile

## [2.98.1] 2022-01-23

- Fix [hardis:org:purge:flow](https://sfdx-hardis.cloudity.com/hardis/org/purge/flow/) when flow prompt selection is `all`

## [2.98.0] 2022-01-23

- Documentation: Add CI/CD user guide and release manager guide, available at <https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/>
- New .sfdx-hardis.yml config property **allowedOrgTypes**, allowing to define the type(s) or org that can be used for implementation: (sandbox and/or scratch)

## [2.97.3] 2022-11-30

- QuickFix System.debug removal

## [2.97.2] 2022-11-30

- QuickFix

## [2.97.1] 2022-11-30

- QuickFix hardis:lint:access

## [2.97.0] 2022-11-30

- New command hardis:lint:access to analyze of items in sources are not present within profiles and/or permission sets

## [2.96.1] 2022-11-17

- Fix error when assigning already existing PS
- Update default CI config

## [2.96.0] 2022-11-09

- Replace `sfdx force:package:install` with `sfdx force:package:beta:install`
- Do not cause deployment to fail when a deploying an older managed package version
  - Instead, deployment will assume the newer version meets the requirement
- hardis:scratch:create : Avoid error in case of already existing assignment of PermissionSet SfdxHardisDeferSharingRecalc
- Update Node.js minimum version to 16.x

## [2.95.2] 2022-10-19

- Replace use of sfpowerkit by default command `sfdx force:source:manifest:create`
- Manage cache for listing orgs
- Update hardis:package:version:create to allow to
  - install it later on an org
  - immediately delete it
- New command hardis:project:metadata:findduplicates to detect when git messed during an automated merging of conflicts
- Factorize check of sfdx project existence
- Fix default gitlab-ci default pipeline
- Replace supportsDevhubUsername by requiresDevhubUsername in command classes when necessary
- Add parameters `skipauth` and `websocket` on `sfdx hardis:project:metadata:duplicate`
- Add missing parameter `skipauth` on `sfdx hardis:package:install`

## [2.94.3] 2022-09-15

- Automate SSL certificate generation + force:source:deploy replaced by force:source:legacy:deploy

## [2.94.2] 2022-09-09

- [hardis:project:clean:minimizeprofiles](https://sfdx-hardis.cloudity.com/hardis/project/clean/minimizeprofiles/): Do not strip tabVisibilities from Profiles

## [2.94.1] 2022-09-01

- Lock sfpowerkit dependency to 4.2.13 to avoid error caused by deprecation of sfpowerkit:org:build:manifest

## [2.94.0] 2022-08-31

- Update documentation to initialize scratch org
- Update JSON schema to add `scratchOrgInitApexScripts`
- Fix execution of scripts defined in `scratchOrgInitApexScripts`

## [2.93.0] 2022-08-02

- Fix handling of new sfdx error format so we can again identify deployment tips
- New deployment tips:
  - Cannot update a field to a Summary from something else

## [2.92.0] 2022-07-29

- New command hardis:org:retrieve:source:analytics to retrieve all analytics (CRM Analytics/TCRM) sources
- New deployment tips (Wave analytics)
- Fix writePackageXml method when there is not an existing file

## [2.91.0] 2022-07-15

- Fix issue when force:source command wrappers arguments contain spaces [(#269)](https://github.com/hardisgroupcom/sfdx-hardis/issues/269))
- Upgrade [MegaLinter](https://oxsecurity.github.io/megalinter/latest/) to v6
- Upgrade yarn dependencies

## [2.90.0] 2022-06-24

- Events to open generated files when called from VsCode SFDX Hardis
- New deployTips

## [2.89.3] 2022-06-21

- Fix exported file extension ([#266](https://github.com/hardisgroupcom/sfdx-hardis/issues/266))

## [2.89.2] 2022-06-17

- Build full manifest using sfpowerkit excluding `ManagedContentTypeBundle` because it is not managed by retrieve

## [2.89.1] 2022-06-16

- Auto-update gitlab-ci.yml only if variable `AUTO_UPDATE_GITLAB_CI_YML` is set

## [2.89.0] 2022-06-12

- **hardis:package:mergexml**: New command to merge package.Xml files

## [2.88.0] 2022-06-11

- **hardis:project:clean:systemdebug**: New command to comment or remove all System.debug from apex and triggers

## [2.87.5] 2022-05-18

- toml2csv: Allow `hardcoded` values for concat
- Refactor internal CI to use 7.148.3 as recommended version

## [2.87.4] 2022-05-18

- Fix configure org CI
- Hide auth info from console logs
- Fix Bulk Update job not closed

## [2.87.3] 2022-05-12

- Auto-update `.gitlab-ci.yml` if a newest version exists

## [2.87.2] 2022-05-11

- Refactor report directory management

## [2.87.1] 2022-05-11

- Fix monitoring default pipeline

## [2.87.0] 2022-05-08

- New command **hardis:project:clean:xml** allowing to automate the manual cleaning in the XML files using glob pattern and xPath
- Reorganize work:save command code + add auto mode
- Call Save command from Retrofit command to update package.xml files and make sure sources have been cleaned

## [2.86.1] 2022-05-06

- hardis:work:new : Propose to reuse current scratch org when it is not in the local list
- hardis:work:save : Propose to push git branch on server when it is still untracked

## [2.86.0] 2022-05-03

- New wrapper command: sfdx hardis:source:retrieve
- Quickfix toml2csv

## [2.85.2] 2022-05-02

- Fix toml2csv error log
- Deployment tips
  - Allow deployment with pending Apex Jobs
  - Update Can not find folder

## [2.85.1] 2022-04-27

- Enhance sfdx hardis:org:retrieve:sources:retrofit command + JSON schema updates

## [2.85.0] 2022-04-27

- Enhance sfdx hardis:org:retrieve:sources:retrofit command
- Ad deployment tip: Invalid field in related list

## [2.84.0] 2022-04-27

- Update deployTips: improve unknown custom field message
- New command sfdx hardis:doc:extract:permsetgroups to generate permission set groups documentation

## [2.83.6] 2022-04-26

- Fix hardis:work:save who sometimes forgot to ask to push commits

## [2.83.5] 2022-04-24

- Update deployment tips

## [2.83.0] 2022-04-20

- New deployment tips:
  - Not valid sharing model
- Improve purge flows for manual users
- Improve badwords detector
- Open scratch org when reusing one
- Hide prompt result when it contains sensitive information

## [2.82.2] 2022-04-19

- New deployTip: Can not change type due to existing data
- Do not replace ListView Everything by Mine when we are just simulating deployment

## [2.82.1] 2022-04-16

- QuickFix platform compatibility for `sfdx hardis:org:fix:listviewmine`

## [2.82.0] 2022-04-16

- New command `sfdx hardis:org:fix:listviewmine` as a workaround to force:source:deploy not allowing ListView with scope **Mine**

## [2.81.0] 2022-04-15

- New property `autoRetrieveWhenPull` to always retrieve some sources when calling hardis:source:pull (useful when sfdx tracking forgets some updates)

## [2.80.0] 2022-04-15

- Simplify and document more hardis:work:new , hardis:work:pull and hardis:work:save
- Open org in browser when fetched from scratch org pool
- More [deploymentTips](https://sfdx-hardis.cloudity.com/deployTips/)
- Add `customPlugins` definition in json schema

## [2.79.0] 2022-04-10

- New property `extends` in `.sfdx-hardis.yml`, to allow local config file to extend from remote file
- Add `customCommands` definition in json schema

## [2.78.4] 2022-04-09

- Update documentation

## [2.78.3] 2022-04-08

- Add a retrofit command to retrieve changes made directly in an org

## [2.78.2] 2022-04-08

- Fix legacy API command display ([#225](https://github.com/hardisgroupcom/sfdx-hardis/issues/225))

## [2.78.1] 2022-04-07

- Fix CI & remove docker image with sfdx-cli@stable as it does not exists anymore

## [2.78.0] 2022-04-07

- New parameter --skipauth on all hardis commands, to allow the auth check when a default username is required (allows advanced users to improve performances)
- Set user email when fetching a scratch org from scratch org pool

## [2.77.2] 2022-04-07

- Fix bug when subtracting a package.xml from another

## [2.77.1] 2022-04-07

- Fix error in packageDeployOnce.xml document (sfdx hardis:project:deploy:sources:dx)

## [2.77.0] 2022-04-05

- Generate deployment tips documentation
- hardis:org:user:activateinvalid : new --profiles argument
- Update MsTeams WebHooks ENV variables
  - MS_TEAMS_WEBHOOK_URL_CRITICAL
  - MS_TEAMS_WEBHOOK_URL_SEVERE
  - MS_TEAMS_WEBHOOK_URL_WARNING
  - MS_TEAMS_WEBHOOK_URL_INFO
- Allow to install packages during deployment check using INSTALL_PACKAGES_DURING_CHECK_DEPLOY=true env variable
- Enhance prompt org labels

## [2.76.2] 2022-04-04

- Improve activate invalid users commands (allow to select by profile(s))

## [2.76.1] 2022-04-04

- Improve activate invalid users commands

## [2.76.0] 2022-04-03

- New command **sfdx hardis:org:user:activateinvalid** to activate invalid emails in sandbox
- Fix CI org authentication in case the default username is not the org that we want to configure
- Bypass error with force:source:legacy:pull / push
- hardis:work:save : Propose to manually commit files
- Fix hardis:org:select alias & user config
- Colorize command lines in logs
- Enhance new task with sandbox (not fully stable yet)
- New deployTips
  - Please choose a different name

## [2.75.0] 2022-03-28

- Property `availableTargetBranches` can be defined in `.sfdx-hardis.yml` to list the possible target branches for merge requests
- fix hardis:work:save to propose a git push when the current branch is ahead of origin branch
- New deployTips
  - XML item appears more than once

## [2.74.2] 2022-03-26

- Update legacy API detection labels

## [2.74.1] 2022-03-25

- Manage crash when retrieving metadatas from CI jobs

## [2.74.0] 2022-03-24

- Enhance hardis:work:save to request if the files has already been staged and committed
- Deploy manifest and destructive change in the same sfdx force:source:deploy call thanks to new argument postdestructivechanges
- More deployTips
- Improve MsTeams notifications management

## [2.73.0] 2022-03-21

- Improve tips about how to fix deployments directly within error messages
- Wrapper commands to display tips in error logs
  - force:source:deploy can be wrapped using hardis:source:deploy
  - force:source:push can be wrapped using hardis:source:push
  - force:mdapi:deploy can be wrapped using hardis:mdapi:deploy

## [2.72.0] 2022-03-21

- Include tips about how to fix deployments directly within error messages

## [2.71.2] 2022-03-17

- Update JSON schema for customCommands (used by VsCode SFDX Hardis)
- New property for scratch org pool config: maxScratchOrgsNumberToCreateOnce (max number of scratch orgs to create during one CI job)

## [2.71.0] 2022-03-15

- New command hardis:org:data:delete to manage [delete data workspaces](https://help.sfdmu.com/full-documentation/advanced-features/delete-from-source) of sfdmu
- New command hardis:scratch:pool:reset to delete all scratch orgs from a scratch orgs pool (like when a new project-scratch-def is delivered)

## [2.70.0] 2022-03-10

- hardis:org:apex:test : allow command to succeed when no tests are present in the project, useful for new environments initialization

## [2.69.0] 2022-03-02

- Scratch org pool: add history (fetch,auth) on ActiveScratchOrg devhub record

## [2.68.6] 2022-02-22

- remove `DEPLOY PROGRESS` noisy lines from logs

## [2.68.5] 2022-02-18

- Update mkdocs
- fix commit of files with spaces

## [2.68.4] 2022-02-18

- hardis:package:install
  - Add -k, --installationkey CLI param and prompts user for it if not supplied

## [2.68.3] 2022-02-18

- Fix hardis:package:version:promote --auto

## [2.68.2] 2022-02-15

- Fix minimize profiles command

## [2.68.1] 2022-02-02

- Allow property autoRemoveUserPermissions in .sfdx-hardis.yml to clean profiles
- toml2csv:
  - Add concatComposite option for column
  - Add recordType option for column

## [2.68.0] 2022-01-31

- Do not create log files in the current directory if it is empty
- More deployTips
- Clean MDAPI output logs from progression lines
- Add listViewMine in cleaning references
- toml2csv updates

## [2.67.1] 2022-01-20

- Enhance documentation for hardis:scratch:pool:create command
- Fixes and enhancements on toml2csv command

## [2.67.0] 2022-01-18

- hardis:misc:toml2csv enhancements (rename and copy files)
- fix minimizing of profiles
- new command hardis:project:clean:listview

## [2.66.2] 2022-01-13

- hardis:misc:toml2csv enhancements

## [2.66.1] 2022-01-11

- minimizeProfiles: do not remove userPermissions if profile is default Admin profile

## [2.66.0] 2022-01-07

- Check deployment with metadata project

## [2.65.0] 2022-01-05

- Fix contribution install by upgrading dependencies
- Use soqlQuery method everywhere
- Set devhub alias when available

## [2.64.1] 2021-12-29

- Update default apiVersion to 53.0
- Option to not remove empty types when subtracting package.xml

## [2.64.0] 2021-12-24

- New command hardis:clean:minimizeprofiles
- New deployTip `duplicate-value-platform-action-id-list`
- Apply packageDeployOnce.xml and packageDeployOnChange.xml in all contexts
- Package.xml mixing: fix wildcard `<members>*</members>` management
- List metadatas of target org: complete with what sfpowerkit commands does not return (ListView,CustomLabel)

## [2.63.0] 2021-12-21

- New event message refreshPlugins (used by VsCodeSFDX Hardis)
- Display Error message when unable to delete a temporary directory

## [2.62.0] 2021-12-14

- Fix **hardis:work:save** crash when rebuilding deploymentPlan
- Fix XML indentation (#51). Can also be overridden by using env variable `SFDX_XML_INDENT` (ex: `SFDX_INDENT='  '`)

## [2.61.0] 2021-12-02

- Use same XML indentation than Salesforce (#51) (requires also upgrade of sfdx-essentials, using `sfdx plugins:install sfdx-essentials`)

## [2.60.3] 2021-11-08

- Fix hardis:source:pull when there are errors

## [2.60.2] 2021-11-06

- Allow to input URL to use to login

## [2.60.1] 2021-11-05

- Fix hardis:scratch:pool:view when DevHub authentication is expired

## [2.60.0] 2021-11-03

- Deployment failure: Tuning of error message + display of direct link to Deployment Status page in console logs
- When not in CI, prompt for the org to use to simulate deployments

## [2.59.0] 2021-11-03

- (ALPHA,not really usable yet) Allow to use sandboxes for new task (create from production org, or clone from other sandbox)
- Fixes about scratch org initialization and JWT auth configuration

## [2.58.3] 2021-10-23

- hardis:org:files:export: Fix file paths in logs

## [2.58.2] 2021-10-18

- org:user:freeze : Prevent to freeze all profiles and current user profile

## [2.58.1] 2021-10-18

- org:retrieve:sources:metadata : Manage locally defined `remove-items-package.xml` (that can handle wildcard members)

## [2.58.0] 2021-10-16

- org:retrieve:sources:metadata : Run apex tests and legacy api check if we are in CI and in a repository named with `monitoring`
- Teams notifications for apex tests and legacy api failure

## [2.57.2] 2021-10-13

- hardis:org:files:export
  - Add file extension when missing
  - replace .snote by .txt
  - replace special characters in parent folder name and file name

## [2.57.1] 2021-10-12

- Retry when BULK API Query returns a timeout
- hardis:org:files:export
  - Use node-fetch-retry for direct downloads (retry up to 30 seconds by default)
  - New argument `--startchunknumber` to start files extraction from a chunk position

## [2.57.0] 2021-10-11

- Make **hardis:org:user:freeze** and **hardis:org:user:unfreeze** can now handle large volume of users, using Bulk API

## [2.56.0] 2021-10-10

- Update auto-generated documentation to add a commands.md + its link in the menu

## [2.55.3] 2021-10-05

- When not in CI, disable auto-update of .gitignore and .forceignore files because of a prompt library issue. To enable it, define AUTO_UPDATE env variable to "true"

## [2.55.2] 2021-10-03

- Fix link to <https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238>

## [2.55.1] 2021-10-01

- SFDX_HARDIS_DEBUG_ENV. If set to true, display env vars at startup

## [2.55.0] 2021-10-01

- Manage env var SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES. If "true", package.xmls are not split with deploymentPlan

## [2.54.0] 2021-09-27

- Allow to override force:org:create waiting time using SCRATCH_ORG_WAIT en variable (default: 15mn)
- hardis:org:select : new parameter `--scratch` to allow to list only scratch orgs related to current Dev Hub
- hardis:org:retrieve:sources:dx2 : New parameter `--template` to use default package.xml files (ex: `wave`)
- Scratch org pool: automatically delete too old ready-to-use scratch orgs
- Deploy Tips
  - Wave deployment error

## [2.53.1] 2021-09-14

- Update Object deployed when configuring scratch org pool (replace Html by LongTextArea)

## [2.53.0] 2021-09-14

- Additional docker images, to use when stable and latest sfdx-cli versions arr broken
  - hardisgroupcom/sfdx-hardis:latest-sfdx-recommended
  - hardisgroupcom/sfdx-hardis:beta-sfdx-recommended
  - hardisgroupcom/sfdx-hardis:alpha-sfdx-recommended

## [2.52.0] 2021-09-14

- New command **hardis:project:fix:v53flexipages** to fix v53.0 broken ascending compatibility
- New command **hardis:project:audit:duplicatefiles** to detect doubling files in wrong sfdx folders

## [2.51.6] 2021-09-10

- Take in account parameter `--ignore-whitespace` of sfdx-git-delta for packageOnChange.xml

## [2.51.5] 2021-09-10

- hardis:org:diagnose:legacyapi: Provide additional report with unique list of ips, hostnames (when available) , and number of calls
- Fix hardis:package:version:promote

## [2.51.4] 2021-09-03

- hardis:org:diagnose:legacyapi: Allow to override default output reportfile with `--outputfile` argument

## [2.51.3] 2021-09-02

- Improve authentication log + less cases when launching again the same command can be necessary
- if you define `forceRestDeploy: true` in config, `restDeploy: false` won't be set automatically anymore

## [2.51.2] 2021-08-31

- Quick fixes hardis:doc:plugin:generate
  - Fix crash when there are no license & changelog

## [2.51.1] 2021-08-31

- Quick fixes hardis:doc:plugin:generate
  - Handle when command.title or command.description is empty
  - Add `# Commands` to the README.md truncate markers
- Fix hardis:org:retrieve:sources:dx
  - Empty temp directories at the beginning of the command
  - Add ForecastingType in the list of ignored metadatas for conversion to sfdx sources

## [2.51.0] 2021-08-31

- Update hardis:doc:plugin:generate so main README part is displayed on doc index.md

## [2.50.0] 2021-08-30

- New commands to freeze users before deployment then unfreeze users after deployment
  - sfdx hardis:org:user:freeze
  - sfdx hardis:org:user:unfreeze

## [2.49.1] 2021-08-30

- QuickFix scratch org auth during CI

## [2.49.0] 2021-08-30

- Manage scratch org pools to enhance performances
  - Initialize configuration with hardis:scratch:pool:configure
  - Fetch a new scratch org from the pool when requesting creation of a new scratch org

## [2.48.1] 2021-08-27

- QuickFix hardis:org:files:export

## [2.48.0] 2021-08-27

- New command **hardis:org:files:export** to download all files (ContentVersion) attached to records (ex: Opportunity)
- Generate text log file in hardis-report/commands when sfdx-hardis is not run from CI
- hardis:org:diagnose:legacyapi : simpler logs

## [2.47.3] 2021-08-23

- hardis:org:diagnose:legacyapi: Add more summary and statistics

## [2.47.2] 2021-08-23

- Fix hardis:org:diagnose:legacyapi (display raw logs when CSV builder is crashing) , using papaparse instead of objects-to-csv package

## [2.47.1] 2021-08-19

- Use --permissivediff to call sfdx-git-delta if the argument is available
- Manage env vars SKIP_PACKAGE_DEPLOY_ON_CHANGE and SKIP_PACKAGE_DEPLOY_ONCE . If set to true, related packageDeployOnChange.xml and packageDeployOnce.xml are ignored
- Define locally method to remove package.xml from another, to improve performances

## [2.47.0] 2021-08-19

- New feature: use packageDeployOnChange.xml, to skip deployment of items that has not been updated since last update
- Create docker images with sfdx-cli@stable version
  - alpha-sfdx-stable
  - beta-sfdx-stable
  - latest-sfdx-stable

## [2.46.0] 2021-08-16

- Allow to run git delta command on local updates
- Update labels of hardis:data commands
- New technical command: hardis:work:ws , to call VsCode Extension refresh from CLI

## [2.45.0] 2021-08-15

- Refactor **hardis:org:diagnose:legacyapi** with jsforce to handle more log entries
- Do not display `git branch -v` in logs

## [2.44.0] 2021-08-14

- New command **hardis:org:diagnose:legacyapi** : Detect [use of deprecated API versions](https://help.salesforce.com/articleView?id=000351312&type=1&mode=1&language=en_US) in production org

## [2.43.1] 2021-07-23

- Update deployTips
- Update json schema

## [2.43.0] 2021-07-22

- Better split of elements during hardis:work:save
- Display elapsed time for long running commands

## [2.42.2] 2021-07-20

- Use relative path for sfdmu data import/export

## [2.42.1] 2021-07-19

- Fix data import & export commands when spaces in folder names

## [2.42.0] 2021-07-12

- New command sfdx hardis:project:lint
- Update .sfdx-hardis.yml configuration JsonSchema

## [2.41.2] 2021-07-12

- QuickFix case when title is not set (use first line of description)

## [2.41.1] 2021-07-12

- Quickfix default mkdocs.yml

## [2.41.0] 2021-07-12

- Add [JSON Schema](https://www.schemastore.org/json/) for `.sfdx-hardis.yml` configuration files
- Automatic SFDX Plugin documentation generation for any SFDX Plugin

## [2.40.0] 2021-07-08

- **hardis:scratch:create**: Initialize data using SFDMU, if defined in .sfdx-hardis.json `dataPackages` property with `importInScratchOrgs: true`
  - Example

```yaml
dataPackages:
  - dataPath: scripts/data/LightningSchedulerConfig
    importInScratchOrgs: true
```

- Propose to update or not default target git branch
- List target git branches if defined in .sfdx-hardis.json `availableTargetBranches` property
- **hardis:scratch:delete**: Propose only scratch orgs related to currently selected Dev Hub
- New command **hardis:org:configure:data** to initialize a SFDMU project, sfdx-hardis flavored
- Display data package label & description, from SFDMU folder config.json properties `sfdxHardisLabel` and `sfdxHardisDescription`
- **hardis:org:data:import** & **hardis:org:data:import**: Allow to select current org or another when running data import/export commands
- Display Dev Hub username when listing orgs for selection

## [2.31.1] 2021-07-02

- **hardis:scratch:delete** : Display instanceUrl & last usage of scratch orgs displayed before deletion

## [2.31.0] 2021-07-02

- New command **hardis:scratch:delete** to delete scratch orgs locally referenced.

## [2.30.1] 2021-06-30

- hardis:org:connect : Propose user to open org in browser if not in CI

## [2.30.0] 2021-06-30

- Update hardis:org:retrieve:packageconfig so it allows to select an org, and to update sfdx-hardis configuration

## [2.29.0] 2021-06-29

- New command hardis:org:retrieve:sources:dx2 to assist call to force:source:retrieve using a package.xml file
- Improve hardis:project:generate:gitdelta by allowing to select commits from their description
- Use magenta to display config file updates

## [2.28.0] 2021-06-23

- CI: Check Docker image security with [trivy](https://github.com/aquasecurity/trivy)
- Avoid git error when development branch is updated

## [2.27.1] 2021-06-21

- Fix CountryCode when updating scratch org user. Default FR - France, can be updated with config defaultCountry and defaultCountryCode in .sfdx-hardis.yml

## [2.27.0] 2021-06-20

- Clean Lookup filters before force:source:push, then restore them and push again
- Manage `gitRootFolderPrefix` config property, in case the root of git repository is at a parent level than sfdx project root
- Allow to override separate deployments using config property `separateDeploymentsConfig`
- Set git config core.quotepath to false to manage special characters in git files / folders
- Run sfdx git delta at the root of the git repository
- Rename DeferSharingCalc permission set into SfdxHardisDeferSharingCalc
- New Deployment tips
- Contributing documentation

## [2.26.4] 2021-06-18

- Do not write user config when current folder is empty

## [2.26.1] 2021-06-17

- Take in account testLevel from `.sfdx-hardis.yml` in deployments

## [2.26.0] 2021-06-16

- New command hardis:project:generate:gitdelta to generate the package.xml calculated between two commits
- New command hardis:org:connect to connect to an org without selecting it (can be used to refresh expired token)
- Propose choice to to skip .gitignore & .forceignore files auto-update
- Define triggerNotification on Command class to trigger MsTeams notifs
- Update org type selection message

## [2.25.3] 2021-06-14

- Fix bug when selecting an org from outside a SFDX project folder

## [2.25.2] 2021-06-14

- Refresh VsCode Sfdx Hardis UI when creating / loading a SFDX Project

## [2.25.1] 2021-06-13

- Check if folder is a git repo before updating git config

## [2.25.0] 2021-06-12

- New parameter **keepmetadatatypes** for hardis:org:retrieve:sources:dx
- Check dependencies
  - Improve performances
  - Check application dependencies (git,openssl)

## [2.24.0] 2021-06-10

- New command **hardis:org:purge:apexlog** to purge all Apex Logs of selected org

## [2.23.0] 2021-06-07

- Manage installation key for unlocked packages installation
- Deployment: manage --canmodify SFDMU argument (define sfdmuCanDeploy in sfdx-hardis branch config file)

## [2.22.0] 2021-06-03

- New command hardis:project:clean:orgmissingitems : Remove elements that are not existing in target org (only in ReportType for now)
- hardis:project:clean:references : Remove cleaned items from package.xml files
- Externalization of method to select an org (+ reorder of list of displayed orgs)

## [2.21.0] 2021-06-02

- hardis:project:clean:references: Improve performances for removing files
- hardis:scratch:create : Shorten scratch org auto-generated name
- Authenticate to an org: Request user to set alias if not provided
- Update default gitlab-ci.yml
- New method promptProfiles

## [2.20.3] 2021-05-26

- Set prompt UI timeout to 2h instead of 5mn

## [2.20.2] 2021-05-25

- Fix call to sfdmu (add --noprompt)

## [2.20.1] 2021-05-23

- Fix scratch org listing

## [2.20.0] 2021-05-21

- hardis:work:save : Prompt user to pull from scratch org or not before saving
- Do not update package.json anymore
- hardis:scratch:create : Fix reuse scratch org prompt

## [2.19.0] 2021-05-20

- Detect when auth token is expired
- More deploy tips
- Clean ProductRequest items

## [2.18.0] 2021-05-18

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

## [2.17.3] 2021-05-18

- Fix .gitignore automatic update constraint

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
