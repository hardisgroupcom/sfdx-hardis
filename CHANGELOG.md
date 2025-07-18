# Changelog

## [beta] (master)

Note: Can be used with `sfdx plugins:install sfdx-hardis@beta` and docker image `hardisgroupcom/sfdx-hardis@beta`

## [5.44.1] 2025-07-16

- [hardis:org:diagnose:audittrail](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/audittrail/):Add new ignored items in audit trail

## [5.44.0] 2025-06-29

- [hardis:project:generate:bypass](https://sfdx-hardis.cloudity.com/hardis/project/generate/bypass/): Code rework + removed global flag + Added ability to apply the bypass to VRs and Triggers
- Refactored logic to ensure preprod branches are only added if they exist, preventing null pointer exceptions.
- Upgrade npm dependencies

## [5.43.5] 2025-06-27

- Filter WorkflowFlowAutomation from org-generated package.xml (workaround attempt for <https://github.com/forcedotcom/cli/issues/3324>)

## [5.43.4] 2025-06-26

- Fix use of org API version

## [5.43.3] 2025-06-26

- [hardis:project:audit:apiversion](https://sfdx-hardis.cloudity.com/hardis/project/audit/apiversion/): Add the newApiVersion parameter to specify the target version for the upgrade.

## [5.43.2] 2025-06-25

- Update default API version to 63.0, but if --skipauth is not used, get the apiVersion of default org
- [hardis:org:monitor:backup](https://sfdx-hardis.cloudity.com/hardis/org/monitor/backup/): Automate update of sfdx-project.json and package.xml at the beginning of the command

## [5.43.1] 2025-06-24

- Refactor part of the documentation + add pages about events and videos
- Upgrade dependency @cparra/apexdocs

## [5.43.0] 2025-06-22

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/) enhancements
  - Generate Apex Class relationship diagram on each apex doc page
  - Improve display of Object and Class diagrams when there are too many items

- Upgrade npm dependencies

## [5.42.0] 2025-06-18

- [hardis:project:deploy:smart](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/): CI/CD enhancements
  - Allow to activate special behaviors when words are written in Pull Request description
    - **NO_DELTA**: Even if delta deployments are activated, a deployment in mode **full** will be performed for this Pull Request
    - **PURGE_FLOW_VERSIONS**: After deployment, inactive and obsolete Flow Versions will be deleted (equivalent to command sf hardis:org:purge:flow)<br/>**Caution: This will also purge active Flow Interviews !**
    - **DESTRUCTIVE_CHANGES_AFTER_DEPLOYMENT**: If a file manifest/destructiveChanges.xml is found, it will be executed in a separate step, after the deployment of the main package
  - Use CommonPullRequestInfo strong type for better use of cross-platform PR functions
  - Manage cache to get Pull Request info to improve performances

## [5.41.0] 2025-06-15

- Factorize common prompt text into prompt variables, that can be overridable by user.
- Implement cache for prompt templates and variables to improve performances
- New command [hardis:doc:override-prompts](https://sfdx-hardis.cloudity.com/hardis/doc/override-prompts/): Create local override files for AI prompt templates that can be customized to match your organization's specific needs and terminology
- Add Github Copilot instructions

## [5.40.0] 2025-06-15

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Add Roles documentation
- Upgrade npm dependencies

## [5.39.1] 2025-06-05

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Define DO_NOT_OVERWRITE_INDEX_MD=true to avoid overwriting the index.md file in docs folder, useful if you want to keep your own index.md file.

## [5.39.0] 2025-06-05

- When in CI, by default a maximum time of 30 minutes can be used to call AI. This value can be overridden using `AI_MAX_TIMEOUT_MINUTES`.
- New documentation page with all environment variables used by sfdx-hardis

## [5.38.2] 2025-06-05

- [hardis:org:monitor:backup](https://sfdx-hardis.cloudity.com/hardis/org/monitor/backup/): Do not filter standard objects if they have at least one custom field defined.
- Upgrade tar-fs to fix CVE

## [5.38.1] 2025-06-02

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Fix crash when generating Assignment Rules doc

## [5.38.0] 2025-05-27

- New command [hardis:misc:servicenow-report](https://sfdx-hardis.cloudity.com/hardis/misc/servicenow-report/) to generate reports crossing data from a Salesforce object and related entries in ServiceNow
- Automatically open Excel report files when possible (disable with env var `NO_OPEN=true`)
- Defer the `sortCrossPlatform` operation for member lists until after all elements for a specific metadata type have been collected. Sorting is now performed only once per type improving the overall performance
- Upgrade npm dependencies

## [5.37.1] 2025-05-23

- Update PROMPT_DESCRIBE_PACKAGE
- Update common instructions about prompt reply language
- Make sure that projectName is compliant with the format of an environment variable

## [5.37.0] 2025-05-22

- Generate and publish multilingual documentation from sfdx-hardis monitoring
- Update command to install mkdocs-material & dependencies to match more python installation types
- Upgrade way to call wrangler to publish to Cloudflare

## [5.36.3] 2025-05-21

- Azure CI/CD workflows: use ubuntu-latest as default image
- Fix doc overwrite in case apex docs failed
- Sort by alphabetical order, ignoring uppercase / lowercase
- Update default prompts
- Fix & delete generated files that are not compliant with Windows file system

## [5.36.2] 2025-05-19

- Do not create package files with git forbidden characters

## [5.36.1] 2025-05-18

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Display installed package metadatas as tree view

## [5.36.0] 2025-05-18

- Allow to use another org to call Agentforce, by previously connecting to an org alias TECHNICAL_ORG (to do that, just define SFDX_AUTH_URL_TECHNICAL_ORG and [hardis:auth:login](https://sfdx-hardis.cloudity.com/hardis/auth/login/) will handle the rest)

## [5.35.0] 2025-05-18

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/) new features and fixes:
  - Add doc for installed packages, enhanced with LLM
  - Fix markdown returned by LLMs so it is compliant with mkdocs
  - Allow to define a property **truncateAfter** on prompts variables to avoid crashes in case value is too long
  - Authorizations doc:
    - Filter non accessible items from tree
    - Display special icons for ModifyAllData and ViewAllData items
    - Fix display of Dataspace scope
  - Allow to override text generated by LLM
  - Allow to override a full documentation page using `<!-- DO_NOT_OVERWRITE_DOC=FALSE -->`
- Upgrade dependencies

## [5.34.1] 2025-05-15

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Fix crash when there is no HTML or JS on a LWC

## [5.34.0] 2025-05-13

- [hardis:org:diagnose:audittrail](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/audittrail/): Add audit Custom Setting values updates
- Improve SOQL query functions by adding warning logs for record limits and removing redundant warning handling
- New command [hardis:misc:custom-label-translations](https://sfdx-hardis.cloudity.com/hardis/misc/custom-label-translations/): Extract selected custom labels, or of a given Lightning Web Component (LWC), from all language translation files. This command generates translation files ('\*.translation - meta.xml') for each language already retrieved in the current project, containing only the specified custom labels.

## [5.33.0] 2025-05-10

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Allow to use ollama, Anthropic and Gemini LLMs, through langchainJs
- sfdx-hardis prompt templates enhancements:
  - Add [prompt templates](https://sfdx-hardis.cloudity.com/salesforce-ai-prompts/#available-prompt-templates) in online documentation
  - Allow to locally [override prompt templates](https://sfdx-hardis.cloudity.com/salesforce-ai-prompts/#overriding-prompts) text in `config/prompt-templates/${templateName}.txt`
  - Rewrite old prompt templates
- Improve VsCode workspace configuration to avoid performance issues
- Upgrade npm dependencies

## [5.32.1] 2025-05-09

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Fix crash when assignment rule doesn't have a value

## [5.32.0] 2025-05-06

- [hardis:org:diagnose:audittrail](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/audittrail/): Flag more audit trail actions as not relevant
- CI/CD: Add FlowDefinition in default [package-no-overwrite.xml](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-config-overwrite/#package-no-overwritexml), as it is a deprecated metadata
- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Escalation Rules AI-enhanced documentation

## [5.31.0] 2025-05-05

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): New features
  - AutoResponse rules, by @mpyvo in <https://github.com/hardisgroupcom/sfdx-hardis/pull/1199>
  - Lightning Web Components, by @tahabasri in <https://github.com/hardisgroupcom/sfdx-hardis/pull/1197>

## [5.30.0] 2025-05-04

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Generate Assignment Rules documentation
- Doc: Mention security artifacts in documentation

## [5.29.1] 2025-05-02

- [hardis:org:diagnose:audittrail](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/audittrail/): Flag more audit trail actions as not relevant
- Generate SBOM (Software Bill Of Material) from CI/CD jobs
- Expose security scan results and SBOM as artifacts on release jobs

## [5.29.0] 2025-05-02

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Generate Approval Process documentation
- Bitbucket Integration: Update default pipeline to add `clone: depth: full`
- Security: Remove markdown-toc dependency as it is not maintained anymore and contains a CVE on old lodash version
- Add documentation page about how security is handled with sfdx-hardis
- Add trivy reports in Github Actions Workflows

## [5.28.1] 2025-04-25

- [hardis:org:diagnose:audittrail](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/audittrail/) enhancements
  - Flag more audit trail actions as not relevant
  - Display related actions next to username in summary
- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Reorganize documentation menus

## [5.28.0] 2025-04-23

- [hardis:lint:metadatastatus](https://sfdx-hardis.cloudity.com/hardis/lint/metadatastatus/): Detect more inactive elements that are technical debt to be cleaned
  - Approval Processes
  - Assignment Rules
  - Auto Response Rules
  - Escalation Rules
  - Forecasting Types
  - Record Types
  - Workflow Rules

## [5.27.0] 2025-04-18

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/) new features
  - Generate Permission sets and Permission Set Groups documentation
  - Display Profiles & Permission Sets attributes in a tree

## [5.26.1] 2025-04-15

- Also Display JIRA and Azure Boards issue status labels in notifications
- [hardis:org:monitor:backup](https://sfdx-hardis.cloudity.com/hardis/org/monitor/backup/) enhancements
  - Add **--start-chunk** to help solving rotten Metadata retrieve issues
  - When using **--full-apply-filters**, do not kee Custom Objects who do not have Custom Fields locally defined
  - Update package-skip-items template to add MilestoneType
  - Add troubleshooting documentation

## [5.26.0] 2025-04-11

- [hardis:org:monitor:backup](https://sfdx-hardis.cloudity.com/hardis/org/monitor/backup/): Allow wildcards in package-skip-items.xml (examples: `pi__*` , `*__dlm` , or `prefix*suffix` )

## [5.25.2] 2025-04-10

- Display JIRA and Azure Boards issue status labels in Pull Request comments

## [5.25.1] 2025-04-08

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Fix typo for Object description prompt

## [5.25.0] 2025-04-06

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Add profile documentation generated by AI
- Refactor document generation code
- GitHub Integration: Use ENV variables as fallback [in case the job runner is not GitHub Actions](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-github/#using-github-integration-without-github-actions), like Codefresh

## [5.24.3] 2025-04-04

- Fix visualization of [Azure DevOps](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-azure/#azure-pull-request-notes) images by linking attachments to a generic work item.

## [5.24.2] 2025-04-02

- Upgrade npm dependencies

## [5.24.1] 2025-03-24

- Upgrade @xmlnode/xmlnode and update related code so it works with newer version
- Upgrade NPM dependencies
- Update [Contributor Guide documentation about package management](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-work-on-task-install-packages/)

## [5.24.0] 2025-03-21

- Flow documentation: Take in account new **Transform Element**

## [5.23.0] 2025-03-19

- Lazy loading in hooks to improve performances when other CLI plugins commands are called
- [hardis:org:file:export](https://sfdx-hardis.cloudity.com/hardis/org/files/export/): Fix 100000 characters SOQL error limit
- Upgrade npm dependencies

## [5.22.0] 2025-03-13

- [hardis:org:file:export](https://sfdx-hardis.cloudity.com/hardis/org/files/export/): Now handles to export of Attachments in addition to ContentVersions :)
- [hardis:doc:flow2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/flow2markdown/): Call AI when generating the doc of a single flow
- [hardis:project:deploy:smart](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/) Fix: delta after merge is not working as expected

## [5.21.4] 2025-03-11

- Support edge-case when package.xml is empty but destructive changes are present. (see [Github issue](https://github.com/hardisgroupcom/sfdx-hardis/issues/1093))
- Upgrade dependencies

## [5.21.3] 2025-03-01

- [hardis:org:data:export](https://sfdx-hardis.cloudity.com/hardis/org/data/export/): Fix crash when a record has more than 1000 attached documents

## [5.21.2] 2025-03-01

- [hardis:org:diagnose:unused-connected-app](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unused-connected-apps/): Fix crash when a Connected App doesn't have a CreatedBy
- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Avoid crash when a lookup field does not contain referenceTo

## [5.21.1] 2025-02-27

- [hardis:org:test:apex](https://sfdx-hardis.cloudity.com/hardis/org/test/apex/) Take in account `--target-org` option
- [hardis:org:diagnose:audittrail](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/audittrail/) Fix **monitoringAllowedSectionsActions**

## [5.21.0] 2025-02-27

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Generate PDF files from markdown documentation, by @matheus-delazeri

## [5.20.0] 2025-02-22

- [hardis:work:new](https://sfdx-hardis.cloudity.com/hardis/work/new/)
  - Document properties **availableProjects** and **availableTargetBranches**
  - Allow to define **newTaskNameRegex** to enforce the naming of a new task
  - Allow to remove question about upgrading the dev sandbox is `sharedDevSandboxes: true` is set
- Fix issue with **monitoringAllowedSectionsActions** not taking in account when a section is defined as `[]` to ignore all of its member types.
- Upgrade npm dependencies

## [5.19.4] 2025-02-17

- Do not check for missing descriptions on Data Cloud & Managed package metadatas
- Doc: display where subflows are used in a new Dependencies paragraph
- mkdocs-to-cf: No need to authenticate to SF org

## [5.19.3] 2025-02-15

- Doc: Add Cloudflare setup instructions
- Doc: Reorganize Project documentation menus
- Update default workflows to handle Cloudflare variables

## [5.19.2] 2025-02-14

- [hardis:project:generate:bypass](https://sfdx-hardis.cloudity.com/hardis/project/generate/bypass/): Added necessary flags to be run from vscode sfdx-hardis extension + added skip-credits
  - Bypass generator: Create metadatas folders if not existing yet
- Change default CF policy
- Update doc to request activation of **ExperienceBundle Metadata API**

## [5.19.1] 2025-02-09

- Quickfix cf upload

## [5.19.0] 2025-02-09

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Add object model diagram in documentation
- New command [hardis:project:generate:bypass](https://sfdx-hardis.cloudity.com/hardis/project/generate/bypass/) : Generates bypass custom permissions and permission sets for specified sObjects and automations, by @Mehdi-Cloudity in <https://github.com/hardisgroupcom/sfdx-hardis/pull/1060>
- Adjusting the Grafana Configuration Variables in the Megalinter part of org-monitoring.yml, by @AhmedElAmory in <https://github.com/hardisgroupcom/sfdx-hardis/pull/1057>

## [5.18.1] 2025-02-04

- Fix typo in docUtils
- Stealth enhancements

## [5.18.0] 2025-02-03

- New command [hardis:doc:fieldusage](https://sfdx-hardis.cloudity.com/hardis/doc/fieldusage/) : generate a report with custom field's usage from metadata dependencies.

## [5.17.4] 2025-01-31

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Fixes pages menu
- Stealth feature

## [5.17.3] 2025-01-29

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Improve Apex docs markdown
- Upgrade apexdocs version
- Fix auth message when selecting default org

## [5.17.2] 2025-01-29

- [hardis:org:configure:files](https://sfdx-hardis.cloudity.com/hardis/org/configure/files/): Add examples when configuring file export format
- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Avoid the command to crash if apexdocs generation fails

## [5.17.1] 2025-01-27

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Add type of Lightning Pages in tables
- [hardis:org:monitor:backup](https://sfdx-hardis.cloudity.com/hardis/org/monitor/backup/): Fix issue when there is an empty metadata type

## [5.17.0] 2025-01-26

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/) enhancements:
  - Generate Apex classes documentation using `@cparra/apexdocs`, and describe them using AI if available
  - Generate Lightning Pages documentation and describe them using AI if available
  - Display error message in case of XML parsing error
  - Do not raise issues when managed items fields don't have descriptions
  - Do not raise inactive validation rule issue when the VR is from a managed package
  - Fix New JSON coverage formatter is selecting wrong JSON from sf project deploy command

## [5.16.4] 2025-01-22

- Doc: Exclude not relevant md from search
- Upgrade npm dependencies
- Add more logs to login command

## [5.16.3] 2025-01-22

- Do not post comments with Flows if there is no real differences
- Truncate the number of flows git diff displayed in Pull Request comments to 30 (override the number using MAX_FLOW_DIFF_TO_SHOW )
- Keep history link in main flow doc if available and history not recalculated
- Remove Flows History mkdocs menu if present from an old sfdx-hardis doc generation
- QuickFix AI Generated Summary text in PRs

## [5.16.2] 2025-01-21

- Strip XML to save prompts tokens
- Fix issue when parsing CustomObject metadata
- Install latest version of plugin @salesforce/plugin-deploy-retrieve in Dockerfile to avoid the bug of its current version
- Fix: Do not recalculate Flow History doc if flow has not been updated
- Skip Data Cloud objects from documentation (enforce using variable INCLUDE_DATA_CLOUD_DOC=true)

## [5.16.1] 2025-01-19

- AI Cache results enhancements
  - Normalize strings before creating fingerprint to handle multiple platforms
  - Delete unused cache files
- Fix variables mismatch when calling `generateFlowMarkdownFile`

## [5.16.0] 2025-01-19

- New AI Provider: Agentforce
- Create Objects AI-powered documentation
  - Summary
  - Relationships with other objects
  - Fields
  - Validation rules
  - Related flows
- Handle prompts multilingualism (ex: `PROMPTS_LANGUAGE=fr`)
- Handle prompts cache to save tokens
- Add `SFDX_DISABLE_FLOW_DIFF: false` in default CI/CD pipelines (must be set to true during CI/CD setup)
- Enhance branches & orgs CI/CD strategy mermaid diagram
- Improve performances by using `GLOB_IGNORE_PATTERNS` for all calls to glob

## [5.15.5] 2025-01-16

- Flow Visual Diff enhancements
  - Display full node fields table when it contains updated elements
  - Fix removed long links
  - Handle cases where Flow has been added or deleted
- Update [hardis:project:deploy:notify](https://sfdx-hardis.cloudity.com/hardis/project/deploy/notify/) documentation

## [5.15.4] 2025-01-15

- Allow to disable calls to AI prompts API using DISABLE_AI=true
- Implement AI cache to save calls to AI prompts API (can be disabled using IGNORE_AI_CACHE)

## [5.15.3] 2025-01-14

- [hardis:project:generate:flow-git-diff](https://sfdx-hardis.cloudity.com/hardis/project/generate/flow-git-diff/) New parameters --commit-before and --commit-after
- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Filter flows from managed packages
- Display number of AI prompts API calls at the end of a command

## [5.15.2] 2025-01-13

- Add AI security considerations in documentation
- Do not prompt for AI API TOKEN
- Do not crash in case of AI call failure

## [5.15.1] 2025-01-12

- Improve prompt templates

## [5.15.0] 2025-01-12

- Allow to call AI to describe flows in documentation
- Allow to call AI to describe differences between 2 flow versions in a pull request comment
- [Ai Provider](https://sfdx-hardis.cloudity.com/salesforce-ai-setup/) enhancements
  - Change default model from gpt-4o to gpt-4o-mini
  - Prompt templates factory, with capability to override default prompt with ENV variable
  - Translate prompts in french
- Add dotenv to allow to define secrets variables in a local `.env` file (never commit it !)
- Add more ways to call python depending on the installation

## [5.14.3] 2025-01-10

- [hardis:project:deploy:smart](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/) Fix crash when deployment is ok

## [5.14.2] 2025-01-10

- [hardis:project:deploy:smart](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/) Fix parsing error in case it is UNKNOWN_ERROR
- Fix error `str.replace is not a function`

## [5.14.1] 2025-01-09

- Generate a file **hardis-report/apex-coverage-results.json** with Apex code coverage details for the following commands:
  - [hardis:project:deploy:smart](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/) (only if `COVERAGE_FORMATTER_JSON=true` environment variable is defined)
  - [hardis:org:test:apex](https://sfdx-hardis.cloudity.com/hardis/org/test/apex/) (always)
  - [SF Cli deployment wrapper commands](https://sfdx-hardis.cloudity.com/salesforce-deployment-assistant-setup/#using-custom-cicd-pipeline)
- Do not display command output if execCommand has been called with `output: false`

## [5.14.0] 2025-01-09

- Add ability to replace ApiVersion on specific Metadata Types file using `sf hardis:project:audit:apiversion`
- Add parameters `fix` and `metadatatype` on `sf hardis:project:audit:apiversion`
- Fix build of formula markdown when generating a Flow Visual Documentation

## [5.13.3] 2025-01-08

- Update default JIRA Regex to catch tickets when there is an number in the project name

## [5.13.2] 2025-01-07

- [hardis:project:deploy:smart](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/): Fix parsing when deployment failure is related to Apex code coverage
- Flow doc fix: add description for constants, variables, text template & formulas
- Flow parsing: Fix error when there is only one formula

## [5.13.1] 2025-01-07

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/) Display a screen emoji in documentation flows table when they are not tied to an Object
- [hardis:project:deploy:smart](https://sfdx-hardis.cloudity.com/hardis/doc/project/deploy/smart/): Shorten log lines when there is a too big JSON, by removing info not relevant for display, like unchanged files or test classes results.

## [5.13.0] 2025-01-05

- [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/) Add branch & orgs strategy MermaidJS diagram in documentation

## [5.12.0] 2025-01-04

- New command [hardis:doc:mkdocs-to-salesforce](https://sfdx-hardis.cloudity.com/hardis/doc/mkdocs-to-salesforce/) to generate static HTML doc and host it in a Static Resource and a VisualForce page
- Remove hyperlinks from MermaidJs on Pull Request comments, to improve display on GitHub & Gitlab
- Upgrade base image to python:3.12.8-alpine3.20, so mkdocs can be installed and run if necessary
- Add links in package.xml Markdown documentation

## [5.11.0] 2025-01-03

- Visual flow management, using MermaidJs

  - [hardis:doc:project2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/): Add a markdown file for each Flow
    - If unable to run mermaid-cli, store markdown with mermaidJs diagram content anyway (can happen from Monitoring Backup Command)
    - When called from Monitoring ([hardis:org:monitor:backup](https://sfdx-hardis.cloudity.com/hardis/org/monitor/backup/)), generate Flow documentation only if it has been updated
  - [hardis:doc:flow2markdown](https://sfdx-hardis.cloudity.com/hardis/doc/flow2markdown/): Generate the markdown documentation of a single flow (available from VsCode extension)
  - [hardis:project:generate:flow-git-diff](https://sfdx-hardis.cloudity.com/hardis/project/generate/flow-git-diff/): Generate the visual git diff for a single flow (available from VsCode extension)
  - [hardis:project:deploy:smart](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/): Add visual git diff for flows updated by a Pull Request
  - Flow Visual Git diff also added to [standard SF Cli commands wrappers](https://sfdx-hardis.cloudity.com/salesforce-deployment-assistant-setup/#using-custom-cicd-pipeline)

- New command [hardis:project:deploy:notify](https://sfdx-hardis.cloudity.com/hardis/project/deploy/notify/) to send Pull Request comments (with Flow Visual Git Diff) and Slack / Teams notifications even if you are not using a sfdx-hardis command to check or process a deployment.

- Command updates

  - [hardis:project:deploy:smart](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/): Refactor deployment errors parsing: use JSON output instead of text output
  - [hardis:org:test:apex](https://sfdx-hardis.cloudity.com/hardis/org/test/apex/): Display the number of failed tests in messages and notifications
  - [hardis:org:monitor:backup](https://sfdx-hardis.cloudity.com/hardis/org/monitor/backup/):
    - New option **--exclude-namespaces** that can be used with **--full** option
    - New option **--full-apply-filters** that can be used with **--full** option to apply filters anyway

- Core enhancements & fixes

  - Obfuscate some data from text log files
  - Kill some exit handlers in case they are making the app crash after a throw SfError
  - Trigger notifications during the command execution, not after
  - Do not display warning in case no notification has been configured in case we are running locally
  - Fix Individual deployment tips markdown docs by adding quotes to YML properties
  - Fix init sfdx-hardis project commands and docs
  - Display warning message in case package.xml has wrong format
  - Allow to override package-no-overwrite from a branch .sfdx-hardis.yml config file
  - Using target_branch for Jira labels when isDeployBeforeMerge flag is true

- Doc
  - Update Microsoft Teams notifications integration User Guide
  - Add troubleshooting section in Email integration User Guide

## [5.10.1] 2024-12-12

- Fix sfdx-hardis docker image build by adding coreutils in dependencies

## [5.10.0] 2024-12-12

- Update Docker base image to alpine to 3.21

## [5.9.3] 2024-12-12

- [hardis:org:data:import](https://sfdx-hardis.cloudity.com/hardis/org/data/import/): Allow to run the command in production using, by either:
  - Define **sfdmuCanModify** in your .sfdx-hardis.yml config file. (Example: `sfdmuCanModify: prod-instance.my.salesforce.com`)
  - Define an environment variable SFDMU_CAN_MODIFY. (Example: `SFDMU_CAN_MODIFY=prod-instance.my.salesforce.com`)

## [5.9.2] 2024-12-10

- Fallback message in case sfdx-hardis is not able to parse newest SF CLI errors format.

## [5.9.1] 2024-12-09

- Fix issue that generates valid Pull Request comment whereas there is 1 error
- Add TS test case
- Upgrade NPM dependencies

## [5.9.0] 2024-12-02

- [hardis:org:monitor:backup](https://sfdx-hardis.cloudity.com/hardis/org/monitor/backup/): New mode **--full**, much slower than default filtered one, but that can retrieve ALL metadatas of an org

## [5.8.1] 2024-11-26

- Fix [hardis:org:diagnose:unused-apex-classes](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unused-apex-classes/): Use .cls file, not cls-meta.xml file to get creation date from git

## [5.8.0] 2024-11-25

- New monitoring command [hardis:org:diagnose:unused-connected-apps](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unused-connected-apps/) to detect Connected Apps that are not used anymore and might be disabled or deleted.

## [5.7.2] 2024-11-25

- Fix issue with auth just before running a command (ask to run again the same command meanwhile we find a way to avoid that using SF CLI architecture)

## [5.7.1] 2024-11-22

- In case a prompt is requested during CI and makes a command fail, display the content of the prompt

## [5.7.0] 2024-11-22

- New command **hardis:git:pull-requests:extract**: Extract Pull Requests from Git Server into CSV/XLS (Azure only for now)
- Fix bug when scratch org username is > 80 chars
- Make markdown-links-check not blocking by default in MegaLinter base config
- Make yamllint not blocking by default in MegaLinter base config

## [5.6.3] 2024-11-17

- MegaLinter config: disable APPLY_FIXES by default
- Upgrade npm dependencies

## [5.6.2] 2024-11-12

- hardis:org:diagnose:unused-apex-classes
  - Display class created by and created name MIN(date from org,date from git)
  - Replace errors by warnings, and add a message so users double-check before removing a class
  - Reorder console log
- Remove unused code from MetadataUtils class

## [5.6.1] 2024-11-11

- Fix hardis:org:user:activateinvalid interactive mode
- Update Dockerfile email address
- Upgrade default Grafana Dashboards to add Unused Apex Classes indicator
- Update hardis:org:diagnose:unused-apex-classes and hardis:doc:packagexml2markdown documentation

## [5.6.0] 2024-11-09

- New command hardis:org:diagnose:unused-apex-classes, to detect Apex classes (Batch,Queueable,Schedulable) that has not been called for more than 365 days, that might be deleted to improve apex tests performances
- hardis:doc:project2markdown: Update documentation
- Polish CI/CD home doc
- Refactor the build of [hardis:org:monitor:all](https://sfdx-hardis.cloudity.com/hardis/org/monitor/all/) documentation
- Fix issue with ToolingApi calls: handle paginated results instead of only the first 200 records.

## [5.5.0] 2024-11-03

- hardis:doc:packagexml2markdown: Generate markdown documentation from a package.xml file
- hardis:doc:project2markdown: Generate markdown documentation from any SFDX project (CI/CD, monitoring, projects not using sfdx-hardis...) in `docs` folder and add a link in README.md if existing.
- hardis:org:monitor:backup: Call hardis:doc:project2markdown after backup
- hardis:org:retrieve:packageconfig: Ignore standard Salesforce packages
- Update CI/CD home documentation

## [5.4.1] 2024-11-02

- hardis:org:multi-org-query enhancements
  - Improve documentation
  - Allow to use --query-template as option to use one of the predefined templates via command line
  - Handle errors if issues when the command is called via a CI/CD job
- Upgrade dependencies

## [5.4.0] 2024-11-02

- New command hardis:org:multi-org-query allowing to execute a SOQL Bulk Query in multiple orgs and aggregate the results in a single CSV / XLS report
- New command hardis:org:community:update to Activate / Deactivate communities from command line

## [5.3.0] 2024-10-24

- Update default Monitoring workflow for GitHub
- Refactor file download code
  - Display progress
  - Better error handling
- hardis:org:diagnose:legacyapi: Fix issue with big log files: Use stream to parse CSV and perform checks
- Update default API version toto 62.0 (Winter 25 release)

## [5.2.4] 2024-10-21

- Fix hardis:org:fix:listviewmine: Use chrome-launcher to find chrome executable to use with puppeteer-core
- Remove keyv dependency

## [5.2.3] 2024-10-19

- Change default `.mega-linter.yml` config
- Display number of package.xml items before or after retrieving them
- Doc: Update youtube preview images

## [5.2.2] 2024-10-14

- Fix doubling -d option in hardis:scratch:create

## [5.2.1] 2024-10-14

- 2 hardis commands: rename `-d` into something else when the short option was available twice on the same command

## [5.2.0] 2024-10-14

- Improve [BUILD & RUN documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-hotfixes/)
- 21 hardis commands: rename `-o` short into `-f` when possible, or other short letter, to avoid collision with `-o` (`--target-org`) option
- Fix GitHub Org Monitoring workflow (remove push event + fix command typo)

## [5.1.0] 2024-10-11

- hardis:project:deploy:smart: Fix to adapt stdout checks to output of `sf project deploy start` in case code coverage is ignored
- hardis:org:monitor:backup: Allow spaces in folders
- Remove pubsub from default .forceignore
- Change default deployment waiting time from 60mn to 120mn
- Display explicit warning message before ConnectedApp deployment so users don't forget to manually create the connected app with the certificate

## [5.0.10] 2024-10-03

- hardis:project:deploy:smart : Fix parsing of error strings
- hardis:project:deploy:smart : Fix markdown display on PR summary

## [5.0.9] 2024-10-03

- Fix link to tip doc from Pull Request / Merge Request comments
- Fixing small issues with creating scratch org and scratch org pool

## [5.0.8] 2024-10-01

- Monitoring config: Fix way to define how to upload connected app
- New deployment tip: Couldn't retrieve or load information on the field
- Fix parsing of errors when they are unknown
- Fix SEO info in deployment tips documentation

## [5.0.7] 2024-09-25

- hardis:org:monitoring:backup : fix issue when metadata type is unknown

## [5.0.6] 2024-09-25

- Allow to purge flows & flow interviews using `--no-prompt` option
- Fix duplicate `-f` short option by replacing `delete-flow-interviews` short by `-w`

## [5.0.5] 2024-09-24

- When git add / stash failure, display a message explaining to run `git config --system core.longpaths true` to solve the issue.
- Improve test classes errors collection during deployment check
- Display the number of elements deployed within a package.xml

## [5.0.4] 2024-09-24

- Fix errors collection during deployment check
- Display in deployment check summary when **useSmartDeploymentTests** has been activated
- Do not send coverage formatters options when test level is NoTestRun

## [5.0.3] 2024-09-23

- Add --ignore-conflicts to smartDeploy

## [5.0.2] 2024-09-23

- Always use `project deploy start --dry-run` for deployment validation, until command `project deploy validate` works with --ignore-warnings & NoTestRun

## [5.0.0] 2024-09-23

### Refactoring explanations

The future [deprecation of sfdx force:source:\*\* commands on 6 november](https://github.com/forcedotcom/cli/issues/2974) finally convinced us to switch everything from SFDX core to SF CLI core. (otherwise existing CI/CD pipelines would not work anymore from this date !)

Therefore, sfdx-hardis required a complete refactoring as described below, but this won't impact existing CI/CD and Monitoring pipelines.

We made many tests but risk zero do not exist, so if you see any bug, please report them ASAP and we'll solve them quickly :)

### Major changes

- Migrate plugin from SFDX plugin core to SF Cli Plugin core

  - [Convert commands code from SfdxCommand base to SfCommand base](https://github.com/salesforcecli/cli/wiki/Migrate-Plugins-Built-for-sfdx)
  - Migrate internal Bulk Api calls from Bulk API v1 to Bulk API v2
  - Upgrade all npm dependencies to their latest version (more secured)

- Change background calls to legacy sfdx commands to call their SF Cli replacements

  - `sfdx force:mdapi:convert` -> `sf project convert mdapi`
  - `sfdx force:mdapi:deploy` -> `sf project deploy start --metadata-dir`
  - `sfdx force:source:retrieve` -> `sf project retrieve start`
  - `sfdx force:source:deploy` -> `sf project deploy start`
  - `sfdx force:source:pull` -> `sf project retrieve start`
  - `sfdx force:source:push` -> `sf project deploy start`
  - `sfdx force:source:tracking:clear` -> `sf project delete tracking`
  - `sfdx force:source:manifest:create` -> `sf project generate manifest`
  - `sfdx sgd:source:delta` -> `sf sgd:source:delta`
  - `sfdx force:org:create` -> `sf org create sandbox` | `sf org create scratch`
  - `sfdx force:org:list` -> `sf org list`
  - `sfdx force:org:delete` -> `sf org delete scratch`
  - `sfdx config:get` -> `sf config get`
  - `sfdx config:set` -> `sf config set`
  - `sfdx auth:web:login` -> `sf org login web`
  - `sfdx auth:jwt:grant` -> `sf org login jwt`
  - `sfdx auth:sfdxurl:store` -> `sf org login sfdx-url`
  - `sfdx org:login:device` -> `sf org login device`
  - `sfdx force:data:record:get` -> `sf data get record`
  - `sfdx force:data:record:update` -> `sf data update record`
  - `sfdx force:data:soql:query` -> `sf data query`
  - `sfdx force:data:bulk:delete` -> `sf data delete bulk`
  - `sfdx alias:list` -> `sf alias list`
  - `sfdx alias:set` -> `sf alias set`
  - `sfdx force:apex:test:run` -> `sf apex run test`
  - `sfdx force:apex:execute` -> `sf apex run`
  - `sfdx force:package:create` -> `sf package create`
  - `sfdx force:package:version:create` -> `sf package version create`
  - `sfdx force:package:version:delete` -> `sf package version delete`
  - `sfdx force:package:version:list` -> `sf package version list`
  - `sfdx force:package:version:promote` -> `sf package version promote`
  - `sfdx force:package:installed:list` -> `sf package installed`
  - `sfdx force:package:install` -> `sf package install`
  - `sfdx force:user:password:generate` -> `sf org generate password`
  - `sfdx force:user:permset:assign` -> `sf org assign permset`
  - `sfdx hardis:_` -> `sf hardis:_`

- New wrappers commands for SF Cli deployment commands
  - `sf hardis project deploy validate` -> Wraps `sf project deploy validate`
  - `sf hardis project deploy quick` -> Wraps `sf project deploy quick`
  - `sf hardis project deploy start` -> Wraps `sf project deploy start`

### New Features / Enhancements

- **hardis:project:deploy:smart**
  - New feature **useSmartDeploymentTests**: Improve performances by not running test classes when delta deployment contain only non impacting metadatas, and target org is not production
  - Rename command **hardis:project:deploy:source:dx** into **hardis:project:deploy:smart** (previous command alias remains, no need to update your pipelines !)
- **commandsPreDeploy** and **commandsPostDeploy**
  - New option **context** for a command, defining when it is run and when it is not: **all** (default), **check-deployment-only** or **process-deployment-only**
  - New option **runOnlyOnceByOrg**: If set to `true`, the command will be run only one time per org. A record of SfdxHardisTrace\_\_c is stored to make that possible (it needs to be existing in target org)
- New commands
  - **hardis:project:deploy:simulate** to validate the deployment of a single metadata (used by VsCode extension)
  - **hardis:org:diagnose:releaseupdates** to check for org Release Updates from Monitoring or locally
  - **hardis:misc:purge-references** to partially automate the cleaning of related dependencies when you need to delete a field, or change its type (for example from master detail to lookup)
  - **hardis:project:clean:sensitive-metadatas** to mask sensitive metadatas from git repo (ex: Certificate content)
- **hardis:work:save** and **hardis:project:deploy:sources:dx**: Improve runtime performances thanks to internalization of sfdx-essentials commands
- **hardis:work:new**
  - Allow to add labels in property `availableTargetBranches`, using a comma. For examples, `- integration,Choose this branch if you are on the BUILD side of the project !`
  - Add current default org in the choices when prompting which org to use
- **hardis:project:new**
  - Initialize autoCleanTypes with **destructivechanges**, **flowPositions** and **minimizeProfiles**
  - Initialize package-no-overwrite.xml with Certificate metadata. (certificates must be uploaded manually)
- **hardis:org:files:export**: Improve display with spinner
- **hardis:org:purge:flow**: If FlowInterview records are preventing Flow Versions to be deleted, prompt user to delete Flow Interviews before trying again to delete Flow Versions
- **hardis:project:generate:gitdelta**: Add option to generate package.xml related to a single commit
- **hardis:org:data:delete**: Check for property "runnableInProduction" in export.json before running deletion in production org.
- **hardis:org:diagnose:audittrail**: Add new filtered actions
  - Customer Portal: createdcustomersuccessuser
- Authentication: do not use alias MY_ORG anymore + do not update local user config if no values to replace.
- When selecting an org, make sure it is still connected. If not, open browser so the user can authenticate again.
- Update sfdx-hardis Grafana Dashboards to import in your Grafana Cloud
  - SF Instance name
  - Next platform upgrade
  - Release Updates to check
  - Installed packages
  - Org licenses
- AI Deployment assistant
  - Add error `Change Matching Rule`
- Git Providers
  - On Pull Requests / Merge Requests comments, add hyperlinks to errors documentation URL

### Fixes

- Avoid error when removing obsolete flows (workaround using SF CLI if tooling api connection fails). Fixes [#662](https://github.com/hardisgroupcom/sfdx-hardis/issues/662)
- Improve Slack/Teams notifications display
- Display explicit error message in case a password is required to install a managed package.

### Documentation

- Reorganize README content
  - Add link to Dreamforce 24 session
- Deployment assistant: Improve documentation by adding examples of errors, and a standalone page for each tip
- Factorize the definition of DOC_ROOT_URL <https://sfdx-hardis.cloudity.com>

### Deprecations

- Deprecate wrapper commands matching sfdx commands that will be removed. All replaced by sf hardis deploy start

  - `sfdx hardis:source:push`
  - `sfdx hardis:source:deploy`
  - `sfdx hardis:mdapi:retrieve`
  - `sfdx hardis:mdapi:deploy`

- Deprecate `hardis:deploy:sources:metadata` as nobody uses metadata format anymore

### Removals

- Replace puppeteer by puppeteer-core: it means that if you use a command requiring puppeteer, please make sure to have a Chrome available in your environment (already integrated within the Docker image)

- Get rid of [sfdx-essentials](https://github.com/nvuillam/sfdx-essentials) plugin dependency by internalizing its used commands

  - `sf hardis:packagexml:append`
  - `sf hardis:packagexml:remove`
  - `sf hardis:project:clean:filter-xml-content`

- Remove npm dependencies (some of them not maintained anymore)

  - @adobe/node-fetch-retry
  - @amplitude/node
  - @keyv/redis
  - @oclif/command
  - @oclif/config
  - @oclif/errors
  - @salesforce/command
  - @salesforce/ts-types
  - find-package-json
  - node-fetch

- Remove not used keyValueStores to keep only Salesforce one

## [4.53.0] 2024-08-20

- Upgrade workflows to Node 20 (fixes <https://github.com/hardisgroupcom/sfdx-hardis/issues/668>)
- Simplify login prompts messages (fixes <https://github.com/hardisgroupcom/sfdx-hardis/issues/667>)
- Upgrade to MegaLinter v8 (own workflows + template workflows)
- Update monitoring commands documentation
- Upgrade npm dependencies
  - axios
  - inquirer
  - moment
  - open
  - ora
  - @supercharge/promise-pool
  - remove strip-ansi dependency to build local function

## [4.52.0] 2024-08-02

- **Minimum Node version is now 20**
- hardis:work:save : Improve performances when cleaning project files
- Update Pipelines to add NOTIF_EMAIL_ADDRESS where it was missing
- Remove MS_TEAMS_WEBHOOK_URL from all pipelines as MsTeamsProvider is deprecated (use EmailProvider instead)
- Remove some useless code in EmailProvider
- Replace glob-promise by glob package

## [4.51.0] 2024-08-01

- Deprecate Microsoft Teams Web Hooks notifications
  - Must be replaced by [Email Notifications](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-email/) using the Ms Teams Channel email.
- Handle bug when a branch .sfdx-hardis.yml config file is empty
- Upgrade default API version to 61
- Additional log when generating manifest package.xml from org
- Add error tip: Network issue (ECONNABORTED, ECONNRESET)

## [4.50.1] 2024-07-29

- Fix report file name of [hardis:org:monitor:limits](https://sfdx-hardis.cloudity.com/hardis/org/monitor/limits/)
- Fix crash when GitProvider has been wrongly configured, and display information message

## [4.50.0] 2024-07-29

- Add message in case of deployment check passing thanks to `testCoverageNotBlocking: true`
- [hardis:org:diagnose:legacyapi](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/legacyapi/) : Fix display error declared in bug [#652](https://github.com/hardisgroupcom/sfdx-hardis/issues/652)
- Run legacy api detection daily with monitoring, as logs remain only 24h

## [4.49.1] 2024-07-27

- Fix 4.49.0 (deployment error handler bug)

## [4.49.0] 2024-07-27

- New command **hardis:org:diagnose:instanceupgrade** to get information about Org, its Salesforce instance and its next Platform Upgrade date. Sends notifications to Grafana if activated.
- Refactor Monitoring checks documentation
- [hardis:project:deploy:sources:dx](https://sfdx-hardis.cloudity.com/hardis/project/deploy/sources/dx/): After a failed Quick Deploy, use run with NoTestRun to improve perfs as we had previously succeeded to simulate the deployment

## [4.48.1] 2024-07-26

- [hardis:project:deploy:sources:dx](https://sfdx-hardis.cloudity.com/hardis/project/deploy/sources/dx/): Fix issue with **testCoverageNotBlocking**

## [4.48.0] 2024-07-26

- [hardis:project:deploy:sources:dx](https://sfdx-hardis.cloudity.com/hardis/project/deploy/sources/dx/): Allow new mode for running test during deployments: **RunRepositoryTestsExceptSeeAllData** (⚠️ Use with caution !)

## [4.47.0] 2024-07-22

- Update emojis in prompts to make them more visible
- Replace `sfdx force:org:open` by `sf org open`

## [4.46.0] 2024-07-18

- Allow **hardis:project:deploy:source:dx** notifications to work if the deployment is performed before the Pull Request is merged (see [Exotic Use Case](https://github.com/hardisgroupcom/sfdx-hardis/issues/637#issuecomment-2230798904))
  - Activate such mode with variable **SFDX_HARDIS_DEPLOY_BEFORE_MERGE**
- Add link to [Conga Article](https://medium.com/@nicolasvuillamy/how-to-deploy-conga-composer-configuration-using-salesforce-cli-plugins-c2899641f36b)
- Add Conga article in README list of articles

## [4.45.0] 2024-07-14

- New command **hardis:org:files:import** to import files exported using **hardis:org:files:export**
- Template management for SFDMU & files import/export
- Update JSON schema to add `v60` in autoCleanTypes

## [4.44.3] 2024-07-12

- Set **GITLAB_API_REJECT_UNAUTHORIZED=false** to avoid SSH rejections from Gitlab API

## [4.44.2] 2024-07-09

- New config **skipCodeCoverage**, to use only in branch scoped config to not check for code coverage (Use with caution because won't work when deploying to production !)

## [4.44.1] 2024-07-08

- QuickFix testlevel default value

## [4.44.0] 2024-07-08

- New JSON schema properties, to use ONLY on branch scoped config and with caution !
  - `testLevel`, to override the test level, with `RunRepositoryTests` for example
  - `runtests`, to override the list of tests to run, with `^(?!FLI|MyPrefix).*` for example
  - `testCoverageNotBlocking` , to make code coverage not blocking on a branch
- Take in account `testCoverageNotBlocking` in deployment checks and PR summaries

## [4.43.0] 2024-07-06

- hardis:work:save : Update prompt messages
- Remove direct URL to target org in case of deployment failure
- AI Deployment Assistant: Fix identification of error messages
- Add deployment tip "Condition missing reference"

## [4.42.0] 2024-07-02

- hardis:project:deploy:sources:dx : If **testlevel=RunRepositoryTests**, option **runtests** can contain a regular expression to keep only class names matching it. If not set, it will run all test classes found in the repo
- Reduce size of README
- Update documentation about Authentication & Security
- Add missing variables in workflows

## [4.41.0] 2024-06-29

- [**AI Deployment Assistant**](https://sfdx-hardis.cloudity.com/salesforce-deployment-assistant-home/): Integrate with OpenAI ChatGPT to find solutions to deployment issues
- Monitoring: Default 120mn timeout in Azure Workflow
- Backup: Replace colon in package file name
- New command [**hardis:project:fix:profiletabs**](https://sfdx-hardis.cloudity.com/hardis/project/fix/profiletabs/) to add / hide tabs directly in XML when such info is not retrieved by Salesforce CLI

## [4.40.2] 2024-06-18

- hardis:org:diagnose:audittrail: Define new not suspect actions
  - Currency
    - updateddatedexchrate
  - Custom App Licenses
    - addeduserpackagelicense
    - granteduserpackagelicense
  - Manage Users
    - unfrozeuser
  - Mobile Administration
    - assigneduserstomobileconfig
- hardis:org:monitor:all: Define relevant items as weekly, not daily

## [4.40.1] 2024-06-17

- hardis:project:clean:minimizeprofiles: Allow to skip profiles refactoring using .sfdx-hardis.yml property **skipMinimizeProfiles** (can be useful for Experience Cloud profiles)

## [4.40.0] 2024-06-13

- Deployment tips: add missingDataCategoryGroup (no DataCategoryGroup named...)
- handle **commandsPreDeploy** and **commandPostDeploy** to run custom command before and after deployments
  - If the commands are not the same depending on the target org, you can define them into config/branches/.sfdx-hardis-BRANCHNAME.yml instead of root config/.sfdx-hardis.yml

Example:

```yaml
commandsPreDeploy:
  - id: knowledgeUnassign
    label: Remove KnowledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: knowledgeAssign
    label: Assign Knowledge user to the deployment user
    command: sf data update record --sobject User --where "Username='deploy.github@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json
commandsPostDeploy:
  - id: knowledgeUnassign
    label: Remove KnowledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: knowledgeAssign
    label: Assign Knowledge user to the deployment user
    command: sf data update record --sobject User --where "Username='admin.user@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json
```

## [4.39.0] 2024-06-13

- hardis:clean:references: new option **v60**
  - Remove v61 userPermissions that do not exist in v60

## [4.38.2] 2024-06-06

- Fix npm packages installation for GitHub monitoring to avoid random failures
- Add \_notifKey in Grafana notifications to be able to build unique alerts

## [4.38.1] 2024-06-04

- Add installed packages in monitoring backup logs

## [4.38.0] 2024-06-03

- New command **hardis:org:diagnose:licenses** to send used licenses to monitoring logs like Grafana
- **hardis:org:diagnose:audittrail**: Exclude some Add / Remove users from a Territory events from Suspect Audit Trail actions
- **hardis:org:diagnose:unusedusers**: Fix metric name for ActiveUsers

## [4.37.5] 2024-05-31

- **hardis:org:purge:flow**: Bulkify Flow deletion to improve performances

## [4.37.4] 2024-05-28

- Fix pipeline and instructions for Monitoring using GitHub Actions

## [4.37.3] 2024-05-28

- Revert to previous dashboards version to avoid issues with use of panel
- Add debug capabilities for advanced cases (call with DEBUG=sfdxhardis)

## [4.37.2] 2024-05-27

- Half-automate the retrieve of default Grafana Dashboards
- Fix ticketing collection on PR with GitHub integration
- Fix monitoring bitbucket pipeline so the git pull works

## [4.37.1] 2024-05-26

- Truncate logs sent to Grafana Loki in case they are too big, to avoid they are not taken in account
  - Default truncate size: 500
- Add **flowPositions** in .sfdx-hardis.yml JSON Schema
- Add Grafana Cloud setup tutorial

## [4.37.0] 2024-05-21

- New command **hardis:project:clean:flowpositions** to replace positions by 0 on AutoLayout Flows, in order to diminish conflicts
  - Can be automated at each **hardis:work:save** if `flowPositions` added in .sfdx-hardis.yml **autoCleanTypes** property

## [4.36.0] 2024-05-19

- Update **hardis:org:diagnose:unusedusers** so it can also extract active users on a time period, thanks to option --returnactiveusers
- Add ACTIVE_USERS in weekly monitoring jobs
- Add JIRA variables to GitHub Workflows

## [4.35.2] 2024-05-15

- Update monitoring default Gitlab, Azure & GitHub Workflows

## [4.35.1] 2024-05-14

- Fix unused users notification identifier

## [4.35.0] 2024-05-14

- New command **sfdx hardis:org:diagnose:unusedusers** to find users that don't use their license !

## [4.34.1] 2024-05-13

- Notifications org identifier: replace dot by \_\_ to avoid mess with Grafana label filters

## [4.34.0] 2024-05-12

- NotifProvider
  - Updates to also send metrics to Prometheus
  - NOTIFICATIONS_DISABLE is now not applicable to ApiProvider who always sends notifs

## [4.33.2] 2024-05-06

- hardis:org:test:apex : Always send coverageValue, coverageTarget and the list of failing classes to API logs

## [4.33.1] 2024-05-05

- Api logs enhancements:
  - Add severity and severityIcon in all log elements details
  - Add dateTime property (ISO format) in all API logs
- Remove deprecated way to call MsTeams notifications
- hardis:org:monitor:limits : Fix bug when some values are not returned

## [4.33.0] 2024-05-04

- New notifications provider: **ApiProvider (beta)**, that allows to send notifications via HTTP/JSON to remote endpoints, like Grafana Loki, but also any custom one
- New notification severity level: **log**, to send notifications via ApiProvider even when there is no detected issue
- Update all existing notifications to add detailed log lines and additional log data
- hardis:org:diagnose:audittrail: Fix lastndays not taken in account in some contexts
- Complete refactoring of hardis:org:test:apex (same behavior but much organized code)
- Notifications: Display success logs in blue
- New monitoring command: **sfdx hardis:org:monitor:limits** to alert in case org limits are over 50% or 75% usage
- Fix gitlab-ci-config.yml: More restrictive regex for deployment branches

## [4.32.2] 2024-05-01

- Fix GitHub Actions check deploy workflow

## [4.32.1] 2024-04-30

- hardis:work:new : Replace all non alphanumeric characters in new git branch name

## [4.32.0] 2024-04-24

- Enhance [BitBucket Integration](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integrations-bitbucket/), by @Alainbates in <https://github.com/hardisgroupcom/sfdx-hardis/pull/584>

  - Deployment status in Pull Request comments
  - Quick Deploy to enhance performance

- Remove useless close WebSocket issue display

## [4.31.2] 2024-04-10

- QuickFix Monitoring setup

## [4.31.1] 2024-04-10

- Fix json output (remove other console logs that are not supposed to be here)

## [4.31.0] 2024-04-10

- Add native Jenkins integration with Jenkinsfile for CI/CD Pipeline
- Update default pipelines to add JIRA variables
- Better handle of Jira API issues

## [4.30.0] 2024-04-02

- Fix default **package-no-overwrite.xml** (typos on NamesCredential & RemoteSiteSetting)
- Add links to FAQ in documentation
- Add two new PMD rules for quality **pmd-ruleset-high.xml** and **pmd-ruleset-medium.xml**

## [4.29.0] 2024-03-25

- Handle **manifest/preDestructiveChanges.xml** to delete items before deployments if necessary
- Update documentation about integrations
- Upgrade dependencies

## [4.28.4] 2024-03-11

- Allow to override default scratch org duration using .sfdx-hardis.yml property **scratchOrgDuration**

## [4.28.3] 2024-03-05

- Audit trail check: Ignore change phone number events

## [4.28.2] 2024-02-27

- Fix wrong upgrade version notification
- Update PMD bypassing rules doc

## [4.28.1] 2024-02-26

- Fix issue when using email notifications with multiple recipients

## [4.28.0] 2024-02-21

- Minimum Node.js version is now v18
- New notifications channel: **EmailProvider** (use variable **NOTIF_EMAIL_ADDRESS** that can contain a comma-separated list of e-mail addresses)
- Update existing call to notifications to add attached files when Email notif channel is active
- Audit trail suspect actions: add the number of occurences for each suspect action found
- Add more not suspect actions: dkimRotationPreparationSuccessful,createdReportJob,deletedReportJob,DeleteSandbox
- Get tickets info: also check in ticket ids in branch name
- Remove force config restDeploy=true
- Rename _Provided by sfdx-hardis_ into _Powered by sfdx-hardis_

## [4.27.1] 2024-02-10

- Skip post-deployment notifications if nothing was deployed in delta mode
- Simplify JIRA post deployment error output

## [4.27.0] 2024-02-09

- Skip legacy notifications if NotifProvider has been used
- Allow to send warning, error and critical notifications to secondary Slack or Teams channel, using variables SLACK_CHANNEL_ID_ERRORS_WARNINGS or MS_TEAMS_WEBHOOK_URL_ERRORS_WARNINGS

## [4.26.3] 2024-02-02

- Add bash to sfdx-hardis docker image

## [4.26.2] 2024-02-01

- Display warning message when failed to upload connected app
- Update documentation about how to work on a dev sandbox / scratch org

## [4.26.1] 2024-01-31

- Update [Contributor User Guide](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-work-on-task/)
- Empty predefined list of packages to install

## [4.26.0] 2024-01-27

- Detect JIRA tickets even if there is only their identifiers in commits / PR text (see [Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-jira/))
- Fix PR comment ticket URL when detail has not been found on server
- Monitoring: run non-critical commands only weekly by default (on saturdays)

## [4.25.1] 2024-01-18

- Fix Microsoft Teams notifications formatting

## [4.25.0] 2024-01-15

- Integration with Azure Boards (Work Items) ticketing system
  - Enrich MR/PR comments by adding work items references and links
  - Enrich notifications comments by adding work items references and links
  - Post a comment and a tag on Azure Work Items when they are deployed in a major org
- Enhance JIRA integration by posting labels once an issue is deployed in a major org

## [4.24.1] 2024-01-11

- Improve display of Microsoft Teams notifications

## [4.24.0] 2024-01-09

- Add generic ticketing provider, that can identify any ticket references using:
  - GENERIC_TICKETING_PROVIDER_REGEX (Example for EasyVista: `([R|I][0-9]+-[0-9]+)`)
  - GENERIC_TICKETING_PROVIDER_URL_BUILDER (Example for EasyVista: `https://instance.easyvista.com/index.php?ticket={REF}`)

## [4.23.3] 2023-12-28

- hardis:org:purge:flow: Ignore managed flows - Fixes [#532](https://github.com/hardisgroupcom/sfdx-hardis/issues/532)
- hardis:work:new prevent parenthesis in branch name - Fixes [#481](https://github.com/hardisgroupcom/sfdx-hardis/issues/481)

## [4.23.2] 2023-12-25

- Catch errors when a JIRA comment has not been posted
- Simplify package-no-overwrite.xml management logs

## [4.23.1] 2023-12-25

- Handle case when tickets have no content

## [4.23.0] 2023-12-25

- Use jira-client package instead of jira.js to be compliant not only with JIRA Cloud, but also with Jira on-premise
- Improve delta logs

## [4.22.0] 2023-12-24

- Add more info in pull requests comments
  - Commits summary
  - Jira tickets
  - Manual Actions
- Integration with JIRA
  - Collect tickets info JIRA server
  - Post comment on tickets once they are deployed

## [4.21.6] 2023-12-22

- New task: Ask confirmation before updating selected sandbox
- Deployment tips
  - Visibility is not allowed for type
- Audit trail, ignore more events
  - Holidays: holiday_insert
  - loginasgrantedtopartnerbt

## [4.21.5] 2023-12-14

- hardis:org:diagnose:audittrail
  - Display user name in logs & notifications
  - Add new excluded actions: changedemail, changedsenderemail, queueMembership, enableSIQUserNonEAC

## [4.21.4] 2023-12-12

- Fix the output column in the metadata status report to distinguish between inactive flows and validation rules identified in the source

## [4.21.3] 2023-12-08

- Add more variables in default azure-pipelines.yml monitoring
- Fix output file name of inactive metadatas audit

## [4.21.2] 2023-12-08

- Downgrade base docker image to alpine:3.18

## [4.21.1] 2023-12-08

- Update Azure Pipelines workflows to add more variables (+ error message giving this list of variables)
- Fix notifs from Azure when spaces in url
- Fix monitoring job on Azure
- Add link to troubleshooting page if backup fails
- Handle notification message when there is no apex in the project
- Do not write report log when there are no differences during monitoring backup step
- Do not try to post PR comments if not in check deploy job
- Check unused licenses: fix crash when no permission set group assignments
- Fix URL to Azure Pull Requests
- Fix display name of PR author on Azure

## [4.21.0] 2023-12-06

- **hardis:lint:access**: Add feature in access command to verify if an object permission exist twice or more in the same permission set
- **hardis:org:monitor:backup**: Allow to exclude more metadata types using env variable MONITORING_BACKUP_SKIP_METADATA_TYPES (example: \`MONITORING_BACKUP_SKIP_METADATA_TYPES=CustomLabel,StaticResource,Translation\`)
- When prompt for login, Suggest custom login URL as first choice by default
- CICD: Update default gitlab-ci-config.yml
- Configure Org CI Auth: Do not prevent to use main or master as production branch

## [4.20.1] 2023-12-04

- Handle errors while calling monitoring commands
- Increase jsforce Bulk API Timeout (60 seconds)
- Set default Bulk Query retries to 3 attempts

## [4.20.0] 2023-12-04

- Add feature in metadatastatus command to verify if a validation rule is inactive in the source
- **hardis:lint:metadatastatus**
  - Check inactive validation rules
  - Add js documentation
- Monitoring: Fix crash when a package name contains a slash

## [4.19.1] 2023-12-03

- Output CSV mirror XLS files reports in a xls folder for easier browsing
- **hardis:org:diagnose:unusedlicenses**
  - Add more Profile & Permission Set Licenses relationships
  - Handle special cases where license is not stored on the permission set, like Sales User !

## [4.19.0] 2023-12-02

- New command **sfdx hardis:org:diagnose:unusedlicenses** to detect unused Permission Set Licenses (that you pay for anyway !)

## [4.18.3] 2023-11-29

- Improve test cases notification
- Enhance monitoring documentation with more descriptions and screenshots

## [4.18.2] 2023-11-29

- **hardis:work:save** enhancements
  - Display more output during cleaning jobs
  - Keep **userPermissions** in Profiles when they are defined to `false`

## [4.18.1] 2023-11-29

- Improve backup notifications display

## [4.18.0] 2023-11-29

- **Delta deployments** is no more beta but **Generally available**
- **Org Monitoring** is no more beta but **Generally available**
- Generate CSV reports also in XSLX format for easier opening

## [4.17.1] 2023-11-28

- Generate CSV output for hardis:org:monitor:backup
- Refactor git detection of created/updated/deleted files

## [4.17.0] 2023-11-28

- hardis:org:backup: Monitor installed packages
- hardis:org:diagnose:audittrail: Add more ignored events
  - Email Administration: dkimRotationSuccessful
  - Manage Users: PermSetGroupAssign
  - Manage Users: PermSetGroupUnassign
- Complete factorization of notification related methods
- Do not remove applicationVisibilities and recordTypeVisibilities from Profiles if they are defined to false (allow to hide applications)

## [4.16.1] 2023-11-27

- Core: Factorize CSV generation

## [4.16.0] 2023-11-27

- Allow to run commands but disable notifications, using **NOTIFICATIONS_DISABLE** env var or **notificationsDisable** .sfdx-hardis.yml property.
- Update JSON schema to add `notificationsDisable` and `monitoringDisable` properties

## [4.15.1] 2023-11-26

- Improve notifs display with hardis:lint:access

## [4.15.0] 2023-11-24

- Allow to disable not monitoring checks using **monitoringDisable** config file property, or **MONITORING_DISABLE** env var
- Add new feature to identify custom fields without description
  - **hardis:lint:missingattributes** : New command to identify custom field without description
- Add new feature to identify custom metadata (flows) inactive in project
  - **hardis:lint:metadatastatus** : New command to identify custom metadata (Labels and custom permissions) not used in source code
- **Rework generate csv file** : generateReportPath and generateCsvFile
- Update monitoring and slack documentation
- Fix slack, teams & Azure notifications

## [4.14.0] 2023-11-23

- Add new feature to identify custom metadata (Labels and custom permissions) not used in source code
- **hardis:lint:unusedmetadata** : New command to identify custom metadata (Labels and custom permissions) not used in source code
- **Add two function getNotificationButtons and getBranchMarkdown in notifUtils.ts class to factorize code**
- Video explaining how to setup sfdx-hardis monitoring
- Improve notifications display of lists

## [4.13.4] 2023-11-22

- Upgrade ms-teams-webhook library so it works again !
- **hardis:org:diagnose:audittrail**: Add changedmanager to not suspect setup actions

## [4.13.2] 2023-11-21

- **hardis:lint:access**: Do not display empty metadata types in notification.
- **hardis:work:new**: Improve prompt messages when asked if you want to refresh your sandbox

## [4.13.1] 2023-11-21

- **hardis:lint:access**
  - Exclude custom settings, custom metadata and data cloud from fields access check
- **hardis:org:diagnose:audittrail**
  - Add changedUserEmailVerifiedStatusUnverified and useremailchangesent to not suspect setup actions
- Output info in case Ms Teams notification failed to be sent

## [4.13.0] 2023-11-19

- Monitoring
  - Display package.xml content in logs when backup failed
  - Update default **package-skip-items.xml**
  - Call **hardis:lint:access** by default
  - Handle empty sections
- **hardis:org:diagnose:audittrail** enhancements:
  - Add PerSetUnassign in not suspect monitored actions in Setup Audit Trail
  - Allow to append more allowed Setup Audit Trail sections & actions using `.sfdx-hardis.yml` property **monitoringAllowedSectionsActions**
- **hardis:lint:access** enhancements:
  - Exclude required fields and MasterDetails, that can not be defined on Permission Sets
  - Output report file
  - Send slack notification
  - Add it by default in the monitoring commands
- Doc
  - Update contributing infos (use `sf plugins link`)
- **hardis:files:export** : Make the command compliant with Email attachments

## [4.12.2] 2023-11-15

- Add user prompts for setup audit trail monitoring in interactive mode

## [4.12.1] 2023-11-15

- Allow to exclude more usernames from monitoring using .sfdx-hardis.yml property **monitoringExcludeUsernames**

## [4.12.0] 2023-11-14

- New command **sfdx hardis:org:diagnose:audittrail** to detect suspect actions in major orgs
  - Run by default in org monitoring
- Fix notifications bulletpoints
- Fix Gitlab provider token collections when in monitoring mode

## [4.11.0] 2023-11-14

- If QuickDeploy failed, by default do not use delta for a deployment after a merge between a minor and a major branch
- Allow to tweak delta deployments configuration (but it's really better to use default opinionated default config !)

## [4.10.3] 2023-11-12

- Allow to configure monitoring on deployment repositories (Fix [#477](https://github.com/hardisgroupcom/sfdx-hardis/issues/477))
- Forbid to configure CI authentication on main or master branch
- Do not send legacy API notifications when there are no issues (Fix [#478](https://github.com/hardisgroupcom/sfdx-hardis/issues/478))
- Upgrade dependencies

## [4.10.2] 2023-11-07

- If you want to force the use full deployment on a delta project Pull Request/ Merge Request, add **nodelta** in your latest commit title or text.
- Display FULL / DELTA / Quick Deploy info at the bottom of the logs.
- sfdx hardis:org:retrieve:packageconfig: Do not replace Ids when updating the .sfdx-hardis.yml list of packages using packages listed from an org

## [4.10.1] 2023-11-06

- Improve delta display in logs
- Display Quick Deploy icon in slack notifications
- Update Azure Pipelines default pipelines for delta deployments compliance
- Update [slack integration documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-slack/)
- Add [tutorials](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-auth/#major-orgs) for authentication configuration on CI/CD servers

## [4.10.O] 2023-11-04

- Allow to [deploy in delta during PR checks between minor and major branches](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-config-delta-deployment/)
  - To activate it, define `useDeltaDeployment: true` in `.sfdx-hardis.yml`, or set env variable **USE_DELTA_DEPLOYMENT** with value `true`
  - Make sure your GitHub, Gitlab, Azure or Bitbucket yaml workflows are up to date
- Overwrite management: [Rename packageDeployOnce.xml into package-no-overwrite.xml](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-config-overwrite/) (compatibility with packageDeployOnce.xml file name is kept)

## [4.9.2] 2023-10-31

- Improve GitHub monitoring Workflow
- Enhance monitoring documentation

## [4.9.1] 2023-10-31

- New deployment error tips:
  - Invalid custom summary formula definition
- Add artifacts config on bitbucket-pipelines.yml
- Add more comments in Monitoring workflows

## [4.9.0] 2023-10-30

- Refactor Monitoring configuration and execution (beta)
  - **If you already have a monitoring v1 repository, deprecate it and create a new one with the new monitoring setup and pipelines**
  - Send slack notifications
    - Latest updates detected in org
    - Failing apex tests, or insufficient code coverage
    - Deprecated API calls detected
  - Full setup documentation
    - GitHub Actions
    - Gitlab CI
    - Azure Pipelines
    - Bitbucket Pipelines
  - Totally rewritten command **sfdx hardis:org:configure:monitoring**
  - New command **sfdx hardis:org:monitor:backup**
  - New command **sfdx hardis:org:monitor:all**
- Simplify `sfdx hardis:project:configure:auth` (Configure Org CI Authentication)
- Disable auto-update for .gitignore & .forceignore
- Improve [documentation related to pull and commit](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-publish-task/#commit-your-updates)

## [4.8.1] 2023-10-28

- Catch "Cannot start the OAuth redirect server on port 1717" and give instructions to user to kill the process

## [4.8.0] 2023-10-25

- Allow to use Device login for Code Builder compatibility
- New option to clear cache if an authenticated org does not appear in the choices

## [4.7.0] 2023-10-24

- **hardis:org:files:export**: New configuration available to export files: **outputFileNameFormat**, with available values:
  - title (default)
  - title_id
  - id_title
  - id

## [4.6.6] 2023-10-20

- Fix crash when converting orgCoverage to string

## [4.6.5] 2023-10-17

- Do not use direct call to jsforce dependency to avoid crash ! ( related to <https://github.com/forcedotcom/cli/issues/2508#issuecomment-1760274510> )
- Update documentation
- Update comparative table in doc

## [4.6.4] 2023-09-28

- hardis:work:save : Fix issue when there is an empty commit because of pre-commit hooks

## [4.6.3] 2023-09-27

- Add installation video tutorial: <https://www.youtube.com/watch?v=LA8m-t7CjHA>

## [4.6.2] 2023-09-26

- Fix return code for wrapper commands force:source:deploy, force:source:push and force:mdapi:deploy
- Fix --skipauth not taken in account with @salesforce/cli
- Fixed PR coverage to use float over string

## [4.6.1] 2023-09-26

- Fix auth issue with force:source & force:mdapi wrapper sfdx-hardis commands

## [4.6.0] 2023-09-20

- [sfdx-hardis & Slack Integration](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-slack/)

  - Easy configuration
  - Deployment notifications to a common channel, and also to git branch dedicated channel

- Native [BitBucket](https://bitbucket.com/) CI/CD Pipeline for PR deployment checks and deployments to major orgs after merge

  - _PR comments are not implemented yet but BitBucket can already be used for production_

- **hardis:project:deploy:dx** enhancements:

  - Added new option --testlevel RunRepositoryTests which will dynamically detect all GIT repository test classes and runs the deployment with found tests. This will speed up the validation/deployment on cases where GIT repository module contains subset of all tests found in the org
  - Added --runtests support in order to pass certain APEX test classes when --testlevel RunSpecifiedTests is used

- Embed [Dreamforce 23 slides](https://reg.salesforce.com/flow/plus/df23/sessioncatalog/page/catalog/session/1684196389783001OqEl) in documentation

## [4.5.1] 2023-09-11

- GitHub Integration: Fix Quick Deploy on Pull Requests

## [4.5.0] 2023-09-11

- GitHub Integration: Implement automated comments & Quick Deploy on Pull Requests

## [4.4.0] 2023-09-10

- Make sfdx-hardis CI/CD Pipelines **natively compliant with GitHub Actions** , by @legetz
- Create sfdx project: Change defaut first major branch name to `integration` (it was previously `develop`)
- Update default API version to 58.0
- Fix bug when user email is input the first time

## [4.3.2] 2023-09-08

- Updates new task, commit & save task documentation & screenshots

## [4.3.1] 2023-09-07

- Improve message when deploying metadata to org from local sfdx-hardis
- Improve documentation to handle merge requests and display links at the end of hardis:work:save

## [4.3.0] 2023-09-05

- Back to normal since <https://github.com/forcedotcom/cli/issues/2445> is fixed

## [4.2.5] 2023-09-05

- Downgrade to sfdx-cli until <https://github.com/forcedotcom/cli/issues/2445> is solved.

## [4.2.4] 2023-09-05

- Downgrade @salesforce/plugin-deploy-retrieve to v1.17.6 as workaround for SF cli bug <https://github.com/forcedotcom/cli/issues/2445>

## [4.2.3] 2023-09-04

- Fix issues with Org monitoring when there are issues with Legacy API

## [4.2.2] 2023-09-01

- Fix upgrade warning message that should not appear when there is no upgrade to perform (detected by @mamasse19)

## [4.2.1] 2023-08-30

- Fix issue in sfdx commands wrapping following the use of @salesforce/cli
- Config auth: phrases in bold when needing to relaunch the same command after org selection

## [4.2.0] 2023-08-30

- Simplify UX of hardis:project:configure:auth
- Factorize prompting of email
- Expire sfdx-hardis connected app token after 3h
- Update documentation to add workaround in case there is a crash when retrieving all sources when initializing a DX project from an existing org
- Add output to explain how to not use QuickDeploy if not wanted
- Update Quick Deploy documentation

## [4.1.2] 2023-08-24

- When there is a crash in force:package:installed:list , do not crash but return empty array and display an error message

## [4.1.1] 2023-08-23

- Improve error message when Git Provider not available
- Update default azure-pipelines-deployment.yml to add mandatory variables for QuickDeploy

```yaml
SYSTEM_ACCESSTOKEN: $(System.AccessToken)
CI_SFDX_HARDIS_AZURE_TOKEN: $(System.AccessToken)
SYSTEM_COLLECTIONURI: $(System.CollectionUri)
BUILD_REPOSITORY_ID: $(Build.Repository.ID)
```

## [4.1.0] 2023-08-22

- Manage QuickDeploy when available (disable by defining env var `SFDX_HARDIS_QUICK_DEPLOY=false`)

## [4.0.1] 2023-08-18

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
