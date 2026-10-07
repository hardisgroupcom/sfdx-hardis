<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:deploy:smart

## Description

Smart deploy of SFDX sources to target org, with many useful options.

In case of errors, [tips to fix them](https://sfdx-hardis.cloudity.com/deployTips/) will be included within the error messages.

> See the [whole sfdx-hardis smart deployment workflow explained in detail](https://sfdx-hardis.cloudity.com/salesforce-devops-smart-deployment/)

### Quick Deploy

In case Pull Request comments are configured on the project, Quick Deploy will try to be used (equivalent to button Quick Deploy)

If you do not want to use QuickDeploy, define variable `SFDX_HARDIS_QUICK_DEPLOY=false`

- [GitHub Pull Requests comments config](https://sfdx-hardis.cloudity.com/salesforce-devops-setup-integration-github/)
- [Gitlab Merge requests notes config](https://sfdx-hardis.cloudity.com/salesforce-devops-setup-integration-gitlab/)
- [Azure Pull Requests comments config](https://sfdx-hardis.cloudity.com/salesforce-devops-setup-integration-azure/)

### Metadata REST API

Deployments use the Metadata REST API by default, which is faster and accepts larger packages than the SOAP Metadata API used by default by the Salesforce CLI. To deploy with SOAP instead, define property `useRestDeploy: false` in `config/.sfdx-hardis.yml`, or set env variable `SFDX_HARDIS_USE_REST_DEPLOY=false`. When neither is set, a `SF_ORG_METADATA_REST_DEPLOY` env variable already defined is kept.

This is the equivalent of `sf config set org-metadata-rest-deploy=true|false`, applied only to the deployments started by this command: your sf configuration is left untouched.

### Delta deployments

To activate delta deployments, define property `useDeltaDeployment: true` in `config/.sfdx-hardis.yml`.

This will activate delta deployments only between minor and major branches (major to major remains full deployment mode)

If you want to force the delta deployment into major orgs (ex: preprod to prod), this is not recommended but you can use env variable ALWAYS_ENABLE_DELTA_DEPLOYMENT=true

### Smart Deployments Tests

Not all metadata updates can break test classes, use Smart Deployment Tests to skip running test classes if ALL the following conditions are met:

- Delta deployment is activated and applicable to the source and target branches
- Delta deployed metadatas are all matching the list of **NOT_IMPACTING_METADATA_TYPES** (see below)
- Target org is not a production org

Activate Smart Deployment tests with:

- env variable `USE_SMART_DEPLOYMENT_TESTS=true`
- .sfdx-hardis.yml config property `useSmartDeploymentTests: true`

Defaut list for **NOT_IMPACTING_METADATA_TYPES** (can be overridden with comma-separated list on env var NOT_IMPACTING_METADATA_TYPES)

- ActionLinkGroupTemplate
- AnalyticSnapshot
- AppMenu
- Audience
- AuraDefinitionBundle
- Bot
- BotVersion
- BrandingSet
- ContentAsset
- CustomApplication
- CustomApplicationComponent
- CustomLabel
- CustomFeedFilter
- CustomHelpMenuSection
- CustomObjectTranslation
- CustomPageWebLink
- CustomSite
- CustomTab
- CustomValueSetTranslation
- Dashboard
- DashboardFolder
- Document
- EmailTemplate
- ExperienceBundle
- FlexiPage
- GlobalValueSetTranslation
- HomePageComponent
- HomePageLayout
- Layout
- Letterhead
- LightningExperienceTheme
- LightningComponentBundle
- LightningMessageChannel
- ListView
- NavigationMenu
- PathAssistant
- QuickAction
- ReportType
- Report
- ReportFolder
- SiteDotCom
- StandardValueSetTranslation
- StaticResource
- Translations
- WebLink

Note: if you want to disable Smart test classes for a PR, add **nosmart** in the text of the latest commit.

### Custom Apex Test Classes (optional)

You can force Smart Deploy to run a specific list of Apex Test Classes. This is **not recommended** because best practice is to run all local tests. Enable it only if you have a specific need.

- `enableDeploymentApexTestClasses` (boolean, default: false): Activate the custom list.
- `deploymentApexTestClasses` (array of strings): The Apex Test Classes to run. Used only when the flag above is true.

Example configuration in `config/.sfdx-hardis.yml` (can also be scoped to branches in `config/branches/.sfdx-hardis-BRANCHNAME.yml` or in Pull Request description):

```yaml
enableDeploymentApexTestClasses: true
deploymentApexTestClasses:
  - MyTestClass1
  - MyTestClass2
```

### Dynamic deployment items / Overwrite management

If necessary,you can define the following files:

- `manifest/package-no-overwrite.xml`: Every element defined in this file will be deployed only if it is not existing yet in the target org (can be useful with ListView for example, if the client wants to update them directly in production org). The target org content is listed only when an item of the deployment package matches one of its members.
  - Supports `<members>*</members>` (all members of a type), exact names, and glob-style patterns such as `<members>*__dlm</members>` or `<members>Prod_*</members>`.
  - Can be overridden for a branch using .sfdx-hardis.yml property **packageNoOverwritePath** or environment variable PACKAGE_NO_OVERWRITE_PATH (for example, define: `packageNoOverwritePath: manifest/package-no-overwrite-main.xml` in config file `config/.sfdx-hardis.main.yml`)
- `manifest/packageXmlOnChange.xml`: Every element defined in this file will not be deployed if it already has a similar definition in target org (can be useful for SharingRules for example)

When components of the deployment package are protected by `package-no-overwrite.xml`, the Pull Request comment has a folded **Protected by package-no-overwrite.xml** section counting the components already in the target org that are not overwritten, and the ones created this once, with a table per metadata type.

See [Overwrite management documentation](https://sfdx-hardis.cloudity.com/salesforce-devops-config-overwrite/)

### Pull Request comments

The validation and deployment Pull Request comments all read the same way:

- A **verdict** naming the target org: *Ready to merge into integration*, *Cannot merge into integration: 2 deployment errors*, *Deployed to integration, but an action failed after the deployment*... A green validation also says how to merge: **Squash and merge** for a User Story branch, a **merge commit** (never squash) for a major, promotion or retrofit branch.
- A short table of **checks**: Metadata (deployed or not, and what changed), Apex tests (coverage, failures, or why none ran), Deployment actions (counts per status), Quick Deploy and Flows.
- What **needs you**: deployment errors with their tips, failed actions with the end of their output, and the manual actions to perform, as checkboxes.
- The **details**, folded: every deployment action of the job, the components per metadata type, the protected components, the Apex test classes, the tickets and the carried Pull Requests.

![Validation Pull Request comment: verdict, checks and the manual action to do before the deployment](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-pr-comment-validation.png)

When a post-deployment action fails, the deployment comment says the metadata is in the org, and shows the end of the output of the failed action:

![Deployment Pull Request comment: deployed, but a post-deployment action failed](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-pr-comment-deployment-failed-action.png)

Each changed Flow gets a comment of its own, with the changed properties first, then its diagram:

![Visual git diff comment of a Flow](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-pr-comment-flow-diff.png)

Each comment stays under 50,000 characters (30,000 on Bitbucket). Above that, long outputs and lists are shortened, then the biggest folded sections are left out, and the comment says so. A Flow whose only change is its status (activated or deactivated) gets no visual diff comment: the Flows line of the validation comment names it.

### Deployment components report

The Metadata line of the checks counts the components the deployment creates, updates, deletes or fails to deploy, and a folded table splits them per metadata type.

![Validation Pull Request comment with the components per metadata type and the protected metadata](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-deployment-components-pr-comment.png)

The full list is written to `hardis-report/deployment-components.csv` and `hardis-report/xls/deployment-components.xlsx`, kept as job artifacts: one row per component with its type, name, status (Failed, Created, Updated, Deleted, Not overwritten, Unchanged) and the package-no-overwrite file protecting it. When a deploy result does not list its components (some Quick Deploy results), the counts per type and the report are left out rather than shown incomplete.

### Packages installation

You can define a list of package to install during deployments using property `installedPackages`

- If `INSTALL_PACKAGES_DURING_CHECK_DEPLOY` is defined as `true` (or `installPackagesDuringCheckDeploy: true` in `.sfdx-hardis.yml`), packages will be installed even if the command is called with `--check` mode
- You can automatically update this property by listing all packages installed on an org using command `sf hardis:org:retrieve:packageconfig`

Example:

```yaml
installedPackages:
  - Id: 0A35r0000009EtECAU
    SubscriberPackageId: 033i0000000LVMYAA4
    SubscriberPackageName: Marketing Cloud
    SubscriberPackageNamespace: et4ae5
    SubscriberPackageVersionId: 04t6S000000l11iQAA
    SubscriberPackageVersionName: Marketing Cloud
    SubscriberPackageVersionNumber: 236.0.0.2
    installOnScratchOrgs: true                  // true or false depending you want to install this package when creating a new scratch org
    installDuringDeployments: true              // set as true to install package during a deployment using sf hardis:project:deploy:smart
    installationkey: xxxxxxxxxxxxxxxxxxxx       // if the package has a password, write it in this property
    - Id: 0A35r0000009F9CCAU
    SubscriberPackageId: 033b0000000Pf2AAAS
    SubscriberPackageName: Declarative Lookup Rollup Summaries Tool
    SubscriberPackageNamespace: dlrs
    SubscriberPackageVersionId: 04t5p000001BmLvAAK
    SubscriberPackageVersionName: Release
    SubscriberPackageVersionNumber: 2.15.0.9
    installOnScratchOrgs: true
    installDuringDeployments: true
```

### Deployment pre or post commands

You can define command lines to run before or after a deployment, with parameters:

- **id**: Unique Id for the command
- **label**: Human readable label for the command
- **allowFailure**: If defined to "true", a failure of this action does not make the deployment job fail
- **context**: Defines the context where the command will be run. Can be **all** (default), **check-deployment-only** or **process-deployment-only**
- **runOnlyOnceByOrg**: If set to true (default), the action runs only once per target org - subsequent deployments skip it. State is tracked in the "Deployment Actions" PR comment.

Post-deployment actions are never run when the metadata deployment failed: they are reported as `not run` and are proposed again during the next successful deployment.

Deployment actions and selected Apex test classes are scoped to the Pull Request that has just been merged when it comes from a feature branch. A merge from a major branch (ex: integration -> uat) or from a retrofit branch (ex: retrofit/from-main -> integration) keeps those of every Pull Request merged into the source major branch since its last promotion, and a merge into the production branch keeps those of every Pull Request carried by the go-live merge. Pull Requests merged upstream (ex: a hotfix in main) are included as soon as their commits arrive in the window.

If the deployment job of a feature branch fails, its actions are not picked up by the next merged Pull Request: re-run the failed deployment job, or move the actions to a new Pull Request.

With `enablePromotionBranches: true`, a merge from a [promotion branch (Beta)](https://sfdx-hardis.cloudity.com/salesforce-devops-promotion-branches/) (named `promotion/<source>/<target>/<YYYY-MM-DD>-<HHMM>`, ex: `promotion/uat/preprod/2026-09-06-1430`, assembled by cherry-picking approved User Stories) keeps the deployment actions, Apex test classes and custom behaviors (NO_DELTA, PURGE_FLOW_VERSIONS...) of the Pull Requests declared in its description with `promotionPullRequests: [482, 487]`.

After every action runs, its result (✅ success, ❌ failed, 👋 manual) is recorded in a dedicated **"Deployment Actions"** PR comment - ordered by org (integration → uat → preprod → prod) - regardless of `runOnlyOnceByOrg`.

When several Pull Requests of the same deployment carry an identical action (same type, phase, user and parameters), it runs once and the other Pull Requests record it as done: see [Identical actions run once](https://sfdx-hardis.cloudity.com/salesforce-devops-work-on-user-story-deployment-actions/#identical-actions-run-once).

If the commands are not the same depending on the target org, you can define them into **config/branches/.sfdx-hardis-BRANCHNAME.yml** instead of root **config/.sfdx-hardis.yml**

You can also keep a single definition and restrict it with `includeTargetBranches` or `excludeTargetBranches` (use `dev-sandboxes` for developer sandboxes).

Example:

```yaml
commandsPreDeploy:
  - id: 32e7e3d7-eeeb-4162-ae9e-a4013e8439e1
    label: Remove KnowledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: bf114a50-8f40-4ac2-bf2b-910139292f76
    label: Assign Knowledge user to the deployment user
    command: sf data update record --sobject User --where "Username='deploy.github@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json

commandsPostDeploy:
  - id: ddd0d387-0b84-4ce5-8b0a-a9a370d2ece3
    label: Remove KnowledgeUser right to the user who has it
    command: sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  - id: 25891b5b-6053-4f91-9416-037e3e3f6e46
    label: Assign Knowledge user to desired username
    command: sf data update record --sobject User --where "Username='admin-yser@myclient.com'" --values "UserPermissionsKnowledgeUser='true'" --json
  - id: a807b752-71dd-4345-a115-413ccd3dbbcc
    label: And to run only if deployment is success
    command: sf sfdmu:run ...
    context: process-deployment-only
    runOnlyOnceByOrg: true
```

### Flow deletion in destructive changes

Deleting a Flow through a metadata deployment is possible, but only if the org is already in the right state before the deployment runs:

- every version has to be named individually (`MyFlow-1`, `MyFlow-2`, ...), as a bare `<members>MyFlow</members>` fails with "insufficient access rights",
- the Flow has to be inactive already. Deactivating it in the same deployment does not help, since Salesforce tries to deactivate the flow that was deleted during a real deploy (`NoDataFoundException` / `UNKNOWN_EXCEPTION`), so it takes a manual deactivation or an earlier deployment,
- a `--check` deployment never commits a deactivation, so a deletion that depends on one can not be validated.

Smart Deploy removes that manual step by taking Flow deletion **out of the deployment**. Any `Flow` member found in `manifest/destructiveChanges.xml`, `manifest/preDestructiveChanges.xml`, the `packageXmlToDelete` config or the delta-generated destructive changes is removed from the manifest sent to the org, and deleted through the Tooling API instead. Stripping is identical during validation and during the real deployment, so the constructive package stays quick-deploy eligible.

A `--check` simulation changes nothing in the org. A read-only preflight reports, for each Flow: the active version that will be deactivated, the versions that will be deleted, and how many Flow Interviews block the deletion. The check **fails** if Flow Interviews block a deletion and you have not authorized deleting them.

On a real deployment, each Flow goes through:

1. Existence check. A Flow that is already gone is reported as `FLOW_DELETE_NOOP`, not an error (same for a Flow with no deletable version, for example one from a managed package).
2. Deactivation through the Tooling API (`FlowDefinition.activeVersionNumber = 0`), which stops new Flow Interviews from starting.
3. Flow Interview gate. If interviews remain and `FLOW_DELETE_INTERVIEWS` is not set, the Flow is reported as `FLOW_DELETE_BLOCKED`. The Flow stays deactivated, so retrying the pipeline once those interviews resolve completes the deletion.
4. Flow Interview deletion, only when `FLOW_DELETE_INTERVIEWS` authorizes it.
5. Version deletion through the Tooling API, oldest version first, then a check that no version is left.

A Flow that another Flow still references (a subflow element, a Process Builder action) can not be deleted while that Flow exists. When the referencing Flow is deleted in the same run, the blocked Flows are tried again after the others, as long as each pass deletes something.

When deleting Flow Interviews is authorized, step 5 retries: an interview that was still running when the Flow got deactivated can pause mid-sequence and block a version. Both bounds can be tuned, as an env variable or as a `.sfdx-hardis.yml` property (the env variable wins). A value that is not an integer, or is below the minimum, is ignored with a warning and the default applies.

| Env variable               | `.sfdx-hardis.yml` property | Default | Minimum | Purpose                                                                                                                                                                                    |
|:---------------------------|:----------------------------|:-------:|:-------:|:-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FLOW_DELETE_MAX_ATTEMPTS   | flowDeleteMaxAttempts       |    3    |    1    | Number of version deletion attempts per Flow. `1` disables the retry. Only used when `FLOW_DELETE_INTERVIEWS` authorizes deleting interviews: without that authorization a block is final. |
| FLOW_DELETE_RETRY_DELAY_MS | flowDeleteRetryDelayMs      |  10000  |    0    | Delay in milliseconds between two attempts, to give a paused interview time to be deleted.                                                                                                 |

Any failure that is not an interview block (a referencing Flow that stays in the org, insufficient access, network error mid-run...) is reported as `FLOW_DELETE_ERROR`. After a network error the org can be further along than the report shows: every step is re-runnable, so retry and trust the new report.

A Flow that can not be deleted only stops the job **before** the deployment (`preDestructiveChanges.xml`). **After** the deployment, the metadata is already in the org, so a Flow left behind, whatever the reason, does not fail the job: it stays deactivated when its deactivation succeeded, the Pull Request comment shows a ⚠️ Flow deletion section, and the deployment notification is sent as a warning that lists it. Running the same deployment again retries it, but a later delta deployment does not include it anymore: solve what blocks it, then run the job again or delete the Flow manually.

Notes:

- A bare member (`MyFlow`) deletes all versions of the Flow. A versioned member (`MyFlow-3`) deletes that version only, and deactivates the Flow only if that version is the active one. A wildcard (`*`) is refused.
- Flows are processed independently: one blocked Flow does not prevent the others from being deleted.
- The deactivation is committed immediately and is not rolled back if a later step fails, so a Flow can be left deactivated but not deleted. Every step is re-runnable, so a pipeline retry converges.
- Flows listed in `preDestructiveChanges.xml` are deleted **before** the constructive deployment, the others after it. Both happen outside the deployment transaction: a deployment that fails after a Flow was deleted does not bring that Flow back, where a `preDestructiveChanges.xml` handled inside the deployment used to be rolled back.

### Pull Requests Custom Behaviors

If some words are found **in the Pull Request description**, special behaviors will be applied

| Word                                 | Behavior                                                                                                                                                                                                                                                                             |
|:-------------------------------------|:-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| NO_DELTA                             | Even if delta deployments are activated, a deployment in mode **full** will be performed for this Pull Request                                                                                                                                                                       |
| PURGE_FLOW_VERSIONS                  | After deployment, inactive and obsolete Flow Versions will be deleted (equivalent to command sf hardis:org:purge:flow)<br/>**Caution: This will also purge active Flow Interviews !**                                                                                                |
| DESTRUCTIVE_CHANGES_AFTER_DEPLOYMENT | If a file manifest/destructiveChanges.xml is found, it will be executed in a separate step, after the deployment of the main package                                                                                                                                                 |
| FLOW_DELETE_INTERVIEWS               | Authorizes deleting the Flow Interviews that block the deletion of a Flow listed in destructive changes. The directive must be on its own line (or in a checked Markdown checkbox).<br/>**Caution: deleting Flow Interviews is irreversible and destroys in-flight process state !** |

You can also override some `.sfdx-hardis.yml` properties directly in the Pull Request description using YAML blocks. Supported keys: `deploymentApexTestClasses`, `commandsPreDeploy`, `commandsPostDeploy`.

Example (in PR description):

```yaml
deploymentApexTestClasses:
  - MyTestClass1
  - MyTestClass2
```

> For example, define `PURGE_FLOW_VERSIONS` and `DESTRUCTIVE_CHANGES_AFTER_DEPLOYMENT` in your Pull Request comments if you want to delete fields that are used in an active flow.

Note: it is also possible to define these behaviors as ENV variables:

- For all deployments (example: `PURGE_FLOW_VERSIONS=true`)
- For a specific branch, by appending the target branch name (example: `PURGE_FLOW_VERSIONS_UAT=true`)

`FLOW_DELETE_INTERVIEWS` can also be set as a `.sfdx-hardis.yml` property (`flowDeleteInterviews: true`).

### Deployment plan (deprecated)

> **This feature is deactivated by default (enable with `enableDeprecatedDeploymentPlan` in project configuration). Use preCommands and postCommands instead.** 

If you need to deploy in multiple steps, you can define a property `deploymentPlan` in `.sfdx-hardis.yml`.

- If a file `manifest/package.xml` is found, it will be placed with order 0 in the deployment plan

- If a file `manifest/destructiveChanges.xml` is found, it will be executed as --postdestructivechanges

- If env var `SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES` is defined as `false` , split of package.xml will be applied

Example:

```yaml
deploymentPlan:
  packages:
    - label: Deploy Flow-Workflow
      packageXmlFile: manifest/splits/packageXmlFlowWorkflow.xml
      order: 6
    - label: Deploy SharingRules - Case
      packageXmlFile: manifest/splits/packageXmlSharingRulesCase.xml
      order: 30
      waitAfter: 30
```

### Automated fixes post deployments

#### List view with scope Mine

If you defined a property **listViewsToSetToMine** in your .sfdx-hardis.yml, related ListViews will be set to Mine ( see command <https://sfdx-hardis.cloudity.com/hardis/org/fix/listviewmine/> )

Example:

```yaml
listViewsToSetToMine:
  - "Operation__c:MyCurrentOperations"
  - "Operation__c:MyFinalizedOperations"
  - "Opportunity:Default_Opportunity_Pipeline"
  - "Opportunity:MyCurrentSubscriptions"
  - "Opportunity:MySubscriptions"
  - "Account:MyActivePartners"
```

Troubleshooting: if you need to fix ListViews with mine from an alpine-linux based docker image, use this workaround in your dockerfile:

```dockerfile
# Do not use puppeteer embedded chromium
RUN apk add --update --no-cache chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true"
ENV CHROMIUM_PATH="/usr/bin/chromium-browser"
ENV PUPPETEER_EXECUTABLE_PATH="$\{CHROMIUM_PATH}" // remove \ before {
```

If you need to increase the deployment waiting time (sf project deploy start --wait arg), you can define env variable SFDX_DEPLOY_WAIT_MINUTES (default: 120)

If you need notifications to be sent using the current Pull Request and not the one just merged ([see use case](https://github.com/hardisgroupcom/sfdx-hardis/issues/637#issuecomment-2230798904)), define env variable SFDX_HARDIS_DEPLOY_BEFORE_MERGE=true

If you want to disable the calculation and display of Flow Visual Git Diff in Pull Request comments, define variable **SFDX_DISABLE_FLOW_DIFF=true**

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:deploy:smart --agent --check --source-branch feature/my-feature --target-branch integration --target-org deploy@myclient.com.integration
```

> **Important**: `--target-org` must be the **target deployment org** (e.g. the integration sandbox), not the developer's current working org. The Salesforce CLI must be authenticated to that org before running this command.

In agent mode:

- The interactive org selection prompt is skipped.
- Deployment is forced into **simulation/check mode** - `--check` is implicit, but should be passed explicitly to make the intent clear. No changes are applied to the org.
- Use `--source-branch` to specify the source git branch (overrides local git branch detection via `FORCE_SOURCE_BRANCH`).
- Use `--target-branch` to specify the target git branch. This sets `FORCE_TARGET_BRANCH` for delta/PR scope and also sets `CONFIG_BRANCH` so the target branch config file (`config/branches/.sfdx-hardis-BRANCHNAME.yml`) is loaded - providing the correct `targetUsername` for that org automatically.
- If a deployment action requires a `customUsername` and authentication for that user fails, the action is **skipped** (not failed) so the simulation can continue.

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.github.io) course runs this command, click by click, on an org of your own, in these labs:

- [Lab 1.6 - Open a Pull Request, pass the deployment check, merge](https://sfdx-hardis-training.github.io/en/level-1-contributor-basics/1-6-pull-request-deployment-check-and-merge/)
- [Lab 2.2 - Fix a deployment error caused by a missing dependency](https://sfdx-hardis-training.github.io/en/level-2-contributor-advanced/2-2-fix-a-missing-dependency-deployment-error/)
- [Lab 2.3 - Fix broken records with an Apex deployment action](https://sfdx-hardis-training.github.io/en/level-2-contributor-advanced/2-3-fix-broken-records-with-an-apex-deployment-action/)
- [Lab 2.5 - Pass the code quality gate and Apex test coverage](https://sfdx-hardis-training.github.io/en/level-2-contributor-advanced/2-5-pass-code-quality-and-apex-test-coverage/)
- [Lab 3.2 - Review and merge a contributor Pull Request](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-2-review-a-contributor-pull-request/)
- [Lab 3.3 - Read the deployment log, and what .forceignore hides from it](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-3-deploy-to-integration-and-read-the-log/)
- [Lab 3.4 - Three Pull Requests collide: choose the merge order](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-4-merge-colliding-pull-requests/)
- [Lab 3.5 - Promote to UAT and write the release notes](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-5-promote-to-uat-and-write-release-notes/)
- [Lab 3.6 - Release to production and read your DORA metrics](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-6-release-to-production-and-read-dora-metrics/)
- [Lab 3.7 - Production is broken: hotfix and retrofit](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-7-hotfix-and-retrofit/)
- [Lab 3.10 - Promote a subset with promotion branches (Beta)](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-10-promote-a-subset-with-promotion-branches/)
- [Lab 3.11 - Capstone: run a weekly release cycle](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-11-capstone-run-a-weekly-release-cycle/)

<!-- training-links:end -->


## Parameters

| Name              |  Type   | Description                                                                                                                                                                                                                            | Default | Required |                                                                          Options                                                                          |
|:------------------|:-------:|:---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:---------------------------------------------------------------------------------------------------------------------------------------------------------:|
| agent             | boolean | Run in non-interactive mode for agents and automation                                                                                                                                                                                  |         |          |                                                                                                                                                           |
| check<br/>-c      | boolean | Only checks the deployment, there is no impact on target org                                                                                                                                                                           |         |          |                                                                                                                                                           |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                                                                                                                                                        |         |          |                                                                                                                                                           |
| delta             | boolean | Applies sfdx-git-delta to package.xml before other deployment processes                                                                                                                                                                |         |          |                                                                                                                                                           |
| flags-dir         | option  | Import flag values from a directory.                                                                                                                                                                                                   |         |          |                                                                                                                                                           |
| json              | boolean | Format output as json.                                                                                                                                                                                                                 |         |          |                                                                                                                                                           |
| packagexml<br/>-p | option  | Path to package.xml containing what you want to deploy in target org                                                                                                                                                                   |         |          |                                                                                                                                                           |
| runtests<br/>-r   | option  | If testlevel=RunSpecifiedTests, please provide a list of classes.<br/>If testlevel=RunRepositoryTests, can contain a regular expression to keep only class names matching it. If not set, will run all test classes found in the repo. |         |          |                                                                                                                                                           |
| skipauth          | boolean | Skip authentication check when a default username is required                                                                                                                                                                          |         |          |                                                                                                                                                           |
| source-branch     | option  | Source git branch name (agent mode: overrides local git branch detection via FORCE_SOURCE_BRANCH)                                                                                                                                      |         |          |                                                                                                                                                           |
| target-branch     | option  | Target git branch name (agent mode: sets CONFIG_BRANCH so the target branch config is loaded, providing the correct targetUsername)                                                                                                    |         |          |                                                                                                                                                           |
| target-org<br/>-o | option  | Username or alias of the target org. Not required if the `target-org` configuration variable is already set.                                                                                                                           |         |   true   |                                                                                                                                                           |
| testlevel<br/>-l  | option  | Level of tests to validate deployment. RunRepositoryTests auto-detect and run all repository test classes                                                                                                                              |         |          | NoTestRun<br/>RunSpecifiedTests<br/>RunRepositoryTests<br/>RunRepositoryTestsExceptSeeAllData<br/>RunLocalTests<br/>RunRelevantTests<br/>RunAllTestsInOrg |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                                                                                                                              |         |          |                                                                                                                                                           |

## Examples

```shell
$ sf hardis:project:deploy:smart
```

```shell
$ sf hardis:project:deploy:smart --check
```

```shell
$ sf hardis:project:deploy:smart --check --testlevel RunRepositoryTests
```

```shell
$ sf hardis:project:deploy:smart --check --testlevel RunRepositoryTests --runtests '^(?!FLI|MyPrefix).*'
```

```shell
$ sf hardis:project:deploy:smart --check --testlevel RunRepositoryTestsExceptSeeAllData
```

```shell
$ sf hardis:project:deploy:smart
```

```shell
$ FORCE_TARGET_BRANCH=preprod NODE_OPTIONS=--inspect-brk sf hardis:project:deploy:smart --check --websocket localhost:2702 --skipauth --target-org nicolas.vuillamy@myclient.com.preprod
```

```shell
$ SYSTEM_ACCESSTOKEN=xxxxxx SYSTEM_COLLECTIONURI=https://dev.azure.com/xxxxxxx/ SYSTEM_TEAMPROJECT="xxxxxxx" BUILD_REPOSITORY_ID=xxxxx SYSTEM_PULLREQUEST_PULLREQUESTID=1418 FORCE_TARGET_BRANCH=uat NODE_OPTIONS=--inspect-brk sf hardis:project:deploy:smart --check --websocket localhost:2702 --skipauth --target-org my.salesforce@org.com
```

```shell
$ CI_SFDX_HARDIS_BITBUCKET_TOKEN=xxxxxx BITBUCKET_WORKSPACE=sfdxhardis-demo BITBUCKET_REPO_SLUG=test BITBUCKET_BUILD_NUMBER=1 BITBUCKET_BRANCH=uat BITBUCKET_PR_ID=2 FORCE_TARGET_BRANCH=uat NODE_OPTIONS=--inspect-brk sf hardis:project:deploy:smart --check --websocket localhost:2702 --skipauth --target-org my-salesforce-org@client.com
```

```shell
$ GITHUB_TOKEN=xxxx GITHUB_REPOSITORY=my-user/my-repo FORCE_TARGET_BRANCH=uat NODE_OPTIONS=--inspect-brk sf hardis:project:deploy:smart --check --websocket localhost:2702 --skipauth --target-org my-salesforce-org@client.com
```

```shell
$ sf hardis:project:deploy:smart --agent --check
```

```shell
$ sf hardis:project:deploy:smart --agent --check --source-branch feature/my-feature --target-branch integration --target-org deploy@myclient.com.integration
```


