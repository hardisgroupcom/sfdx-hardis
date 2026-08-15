## Deployment actions (beta)

> This feature is currently in beta, but you can start using it right away.

### What are deployment actions ?

Salesforce Deployments are mainly Metadata, but can also be other actions that will be performed before or after Metadata deployment:

- [Run Apex scripts](#run-apex-script)
- [Upsert records (Import SFDMU project)](#import-sfdmu-project)
- [Run command lines](#run-command)
- [Publish Experience Cloud sites](#publish-experience-site)
- [Schedule Apex batch jobs](#schedule-batch)
- [Remove items from package.xml before deployment](#remove-packagexml-items)
- [Manual actions that cannot be automated](#manual-step)

You can define them at two levels:

- **Pull Request level**: these actions will be run during the deployment of a feature pull request, but also during deployment of Pull Requests between major branches (ex: `preprod` to `main`)
- **Project level**: The deployment actions will be performed during each deployment

### Use DevOps Pipeline UI

You can display / create / edit deployment actions using **My Pull Request** button in the DevOps pipeline UI.

![](assets/images/card-my-pull-request.png)

![](assets/images/screenshot-edit-deployment-action.jpg)

You can also see deployment actions of already merged Pull Requests by clicking on a major git branch name in the pipeline.

![](assets/images/screenshot-deployment-actions.jpg)

### How to define deployment actions

Actions can be defined in properties `commandsPreDeploy` / `commandsPostDeploy` of .sfdx-hardis.yml config files.

- Pull Request level: `scripts/actions/.sfdx-hardis.<PR_ID>.yml` (ex: `scripts/actions/.sfdx-hardis.372.yml`).
- Repository level: `config/.sfdx-hardis.yml`

Example of a Pull Request level configuration file defining pre-deploy and post-deploy actions:

```yaml
# scripts/actions/.sfdx-hardis.372.yml
commandsPreDeploy:
  - id: runInitApex
    label: Run initialization apex
    type: apex
    parameters:
      apexScript: scripts/apex/init.apex
    context: process-deployment-only
  - id: removeKnowledgeFlag
    label: Remove KnowledgeUser flag
    type: command
    command: >-
      sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
    context: all

commandsPostDeploy:
  - id: importTemplates
    label: Import email templates
    type: data
    parameters:
      sfdmuProject: EmailTemplate
    context: process-deployment-only
  - id: publishSite
    label: Publish Experience site
    type: publish-community
    parameters:
      communityName: "My Experience Site"
    context: process-deployment-only
```

### Configuration: action object shape

Each action is an object with the following required and optional properties.

| Field                   | Type    | Required? | Description                                                                                                                                                                                       |
|-------------------------|---------|:---------:|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `id`                    | string  |    Yes    | Unique identifier for the action.                                                                                                                                                                 |
| `label`                 | string  |    Yes    | Human-readable description of the action.                                                                                                                                                         |
| `type`                  | string  |    Yes    | One of `command`, `data`, `apex`, `publish-community`, `schedule-batch`, `remove-packagexml-items`, `manual`.                                                                                     |
| `context`               | string  |    Yes    | When the action should run. Allowed values: `all` (default), `check-deployment-only`, `process-deployment-only`.                                                                                  |
| `command`               | string  |    No     | Shell command to run (used by `command` type).                                                                                                                                                    |
| `parameters`            | object  |    No     | Parameters of the action (see action details)                                                                                                                                                     |
| `customUsername`        | string  |    No     | Run the action with a specific username instead of the default target org.                                                                                                                        |
| `includeTargetBranches` | array   |    No     | Run the action only when the deployment targets one of these branches. See [Restricting an action to some orgs](#restricting-an-action-to-some-orgs).                                             |
| `excludeTargetBranches` | array   |    No     | Run the action on every target branch except these ones. See [Restricting an action to some orgs](#restricting-an-action-to-some-orgs).                                                           |
| `allowFailure`          | boolean |    No     | If true and the action fails, the deployment continues but the result is marked failed/allowed.                                                                                                   |
| `runOnlyOnceByOrg`      | boolean |    No     | Default: `true`. If true, the action runs only once per target org. Execution state is tracked in a dedicated "Deployment Actions" PR comment (see below) - no Salesforce custom object required. |

> Post-deployment actions are never run when the metadata deployment failed. They are reported as `not run` in the Pull Request comment, no execution state is stored for them, and they are proposed again during the next successful deployment.

### Restricting an action to some orgs

By default an action runs on every target org. Some actions only make sense in a subset of them: seeding demo data everywhere but production, publishing a community on UAT only, disabling an integration on developer sandboxes.

Two mutually exclusive properties control this:

- `includeTargetBranches`: the action runs only when the deployment targets one of the listed branches.
- `excludeTargetBranches`: the action runs everywhere except on the listed branches.

```yaml
commandsPostDeploy:
  # Runs on UAT and preprod only
  - id: publishCommunity
    label: Publish the customer community
    type: publish-community
    parameters:
      communityName: Customer
    context: process-deployment-only
    includeTargetBranches:
      - uat
      - preprod

  # Runs everywhere except production
  - id: seedDemoData
    label: Import demo records
    type: data
    parameters:
      sfdmuProject: DemoData
    context: process-deployment-only
    excludeTargetBranches:
      - main
```

Branch names are matched exactly, ignoring case. There are no wildcards: list each branch you mean.

**The `dev-sandboxes` virtual branch**

A deployment does not always target a major branch. `sf hardis:work:backpromote` deploys to a developer sandbox, and so does a local `sf hardis:project:deploy:start` run from a feature branch. In those cases the name `dev-sandboxes` matches, so you can target developer sandboxes without knowing their branch names:

```yaml
commandsPreDeploy:
  # Never runs when a developer backpromotes into their own sandbox
  - id: lockIntegrationUser
    label: Lock the integration user
    type: apex
    parameters:
      apexScript: scripts/apex/lock-integration-user.apex
    excludeTargetBranches:
      - dev-sandboxes
```

A target counts as `dev-sandboxes` when it has no `config/branches/.sfdx-hardis.<branch>.yml` file. In a repository with no branch config files at all, every deployment therefore counts as a developer sandbox.

**Reporting and validation**

When an action does not apply to the branch being deployed, it is reported as `skipped` in the Deployment Actions Pull Request comment with the reason, and no execution state is stored: the action still runs later on a branch it does target. A manual action skipped this way is not added to the manual checklist.

Setting both properties on the same action is a configuration error. `sf hardis:project:action:create` and `sf hardis:project:action:update` refuse to save it, and a deployment reading such an action from a YAML file fails with an explicit message.

### Which Pull Requests are in scope

The actions collected for a deployment depend on the branch the merged Pull Request comes from.

| Merge                                                              | Scope                                              |
|--------------------------------------------------------------------|----------------------------------------------------|
| From a feature branch (ex: `feature/my-story` -> `integration`)    | Only the Pull Request that has just been merged    |
| Between major branches (ex: `integration` -> `uat`)                | Every Pull Request merged since the previous merge |
| From a retrofit branch (ex: `retrofit/from-main` -> `integration`) | Every Pull Request merged since the previous merge |

A feature branch merge carries a single Pull Request, so its notification and its Pull Request comment list only that Pull Request's actions. A major branch or retrofit branch merge carries a batch of Pull Requests, whose actions must be replayed in the target org.

- Between major branches, the batch is every Pull Request merged into the source major branch since its last promotion.
- Into the production branch (which has no promotion target), the batch is every Pull Request carried by the go-live merge itself.
- Pull Requests merged into upstream branches are part of the batch as soon as their commits arrive in the window: a hotfix merged into `main` is collected when a retrofit branch brings it down to `integration`, so its actions run there too.

In every case, `runOnlyOnceByOrg` state tracking ensures each action runs only in the orgs where it has not been performed yet.

The same scope applies to the Apex test classes selected from Pull Requests when `enableDeploymentApexTestClasses` is active.

The resolved scope is visible in two places:

- In job logs, as a single line: `Pull Request scope: 5 Pull Request(s) (#4491, #4494, ...)`. Each Running/Skipping line then shows the Pull Request that defines the action.
- In the check and deployment Pull Request comments, which state which Pull Requests the deployment actions and Apex test classes were collected from, with links.

> If the deployment job of a feature branch fails, its actions are not picked up by the next merged Pull Request. Re-run the failed deployment job, or open a new Pull Request carrying the actions of the previous one.

### Deployment Actions PR comment

After every action runs, sfdx-hardis creates or updates a dedicated **"Deployment Actions"** comment on the Pull Request. This gives release managers a consolidated view of what has been executed across every org for the lifetime of the PR.

**Comment structure** - one shared comment per PR, across all CI workflows:

- A **Pending manual actions** checklist: one checkbox per manual action still waiting to be performed in an org. Tick a box once you have performed the action: the next sfdx-hardis job records it as done (see [Confirming manual actions with checkboxes](#confirming-manual-actions-with-checkboxes)).
- A **Status by org branch** matrix: one row per action, one column per org branch, so you can see at a glance in which orgs an action has been performed and where it is still pending.
- A collapsible **Action Details** section with the action properties (type, context, command or script...) and truncated output per org.

Example of the status matrix:

```markdown
### Status by org branch

| Action                      | When        |          integration           |              uat              |
|-----------------------------|-------------|:------------------------------:|:-----------------------------:|
| Remove KnowledgeUser flag   | pre-deploy  | ✅ 2024-06-01<br/>[12345](...)  | ✅ 2024-06-05<br/>[12890](...) |
| Import email templates      | post-deploy | ✅ 2024-06-01<br/>[12345](...)  | ✅ 2024-06-05<br/>[12890](...) |
| Publish Experience site     | post-deploy | ❌ 2024-06-02<br/>[12501](...)  |               ⬜               |
| Check external callback URL | post-deploy | 👋 2024-06-01<br/>[12345](...) |               ⬜               |

*Legend: ✅ done · ❌ failed · 👋 waiting for manual execution · ⚪ skipped · ⬜ not run in this org branch yet*
```

Columns are ordered from dev to production (integration → uat → preprod → prod), rows follow the deployment order (pre-deploy actions first, then post-deploy). Each cell shows the status icon, the execution date and a link to the CI job that performed the action. A *Last updated* date is displayed under the matrix. The action `id` is embedded in each row as an HTML comment for machine parsing.

**Status icons:**

| Icon | Status    | Meaning                                                          |
|------|-----------|------------------------------------------------------------------|
| ✅    | `success` | Executed successfully (or confirmed as done via its checkbox)    |
| ❌    | `failed`  | Executed but failed - will be retried next run                   |
| 👋   | `manual`  | Manual step - waiting for a human to perform it and tick the box |
| ⚪    | `skipped` | Skipped (e.g. already run via `runOnlyOnceByOrg`)                |
| ⬜    | -         | Not run in this org branch yet                                   |

> Comments written with the previous format (one row per action and org branch pair) are still parsed, and are migrated to the matrix format on their next update.

### runOnlyOnceByOrg - skip-on-next-run logic

When `runOnlyOnceByOrg` is `true` (the default), the "Deployment Actions" PR comment is used as the state store:

- If the table already contains a ✅ `success` row for `(actionId, orgBranch)`, the action is **skipped** with a ⚪ status on subsequent deployments.
- ❌ `failed` entries are always **retried** on the next run.
- Each action is tracked per org independently: the same action will run once in `integration` and once in `uat`.

**Requirements for `runOnlyOnceByOrg`:**

- A git provider token must be configured (GitHub: `GITHUB_TOKEN`, GitLab: `CI_SFDX_HARDIS_GITLAB_TOKEN`, Azure DevOps: `SYSTEM_ACCESSTOKEN`, Bitbucket: `CI_SFDX_HARDIS_BITBUCKET_TOKEN`).
- Without a git provider, actions with `runOnlyOnceByOrg: true` are **skipped with a warning** (to avoid untracked re-executions). All other actions still run normally; only the PR comment update is skipped.

**Opt out:** Add `runOnlyOnceByOrg: false` explicitly on any action that should always run.

### Confirming manual actions with checkboxes

Manual action checklists appear in three kinds of Pull Request comments: check results, deployment results, and the Deployment Actions comment. Every checklist item carries a hidden marker identifying the action and the org branch.

When someone ticks one of these checkboxes (in any of the three comments), the next check or deployment job:

- records the action as done for that org branch in the Deployment Actions comment,
- skips it in later deployments to that org (same behavior as a successful `runOnlyOnceByOrg` action),
- ticks the same checkbox in the other comments where the action appears, so all views stay consistent.

This works on GitHub, GitLab, Azure DevOps and Bitbucket, and requires the same git provider token as `runOnlyOnceByOrg` state tracking.

### Action implementations

| Action type                                           | Purpose                                                                |
|-------------------------------------------------------|------------------------------------------------------------------------|
| [`command`](#run-command)                             | Run an arbitrary shell or `sf` command.                                |
| [`data`](#import-sfdmu-project)                       | Import a SFDMU project.                                                |
| [`apex`](#run-apex-script)                            | Run an Apex script file through the local `sf apex` integration.       |
| [`publish-community`](#publish-experience-site)       | Publish an Experience Cloud (community) site.                          |
| [`schedule-batch`](#schedule-batch)                   | Schedule an Apex batch job with a cron expression.                     |
| [`remove-packagexml-items`](#remove-packagexml-items) | Remove metadata items from package.xml before the metadata deployment. |
| [`manual`](#manual-step)                              | Represent a manual step (no CLI execution).                            |

#### Run command

Runs a custom command line. In case of multiple commands, use `&&` to separate them.

| Custom parameter | Description                   | Example                    |
|------------------|-------------------------------|----------------------------|
| `command`        | Command line to run (string). | `echo "My custom command"` |

Example:

```yaml
- id: removeKnowledgeFlag
  label: Remove KnowledgeUser flag
  type: command
  command: >-
    sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
  context: all
```

#### Import SFDMU project

Runs a SFDMU import for the specified project name. Typically used post-deploy to load records such as templates or reference data.

| Custom parameter          | Description                       | Example         |
|---------------------------|-----------------------------------|-----------------|
| `parameters.sfdmuProject` | Name of the SFDMU project to run. | `EmailTemplate` |

Example:

```yaml
- id: importTemplates
  label: Import email templates
  type: data
  parameters:
    sfdmuProject: EmailTemplate
  context: process-deployment-only
```

#### Run Apex script

Executes an Apex script file against the target org using `sf apex run --file`. Useful for initialization scripts or migrations that must run before or after metadata deployment.

| Custom parameter        | Description                                                 | Example                  |
|-------------------------|-------------------------------------------------------------|--------------------------|
| `parameters.apexScript` | Relative path to the `.apex` script file in the repository. | `scripts/apex/init.apex` |

Example:

```yaml
- id: runInitApex
  label: Run initialization apex
  type: apex
  parameters:
    apexScript: scripts/apex/init.apex
  context: process-deployment-only
```

#### Publish Experience site

Publishes the specified Experience Cloud (community) site using `sf community publish`. Use this when deployment changes require a publish step.

| Custom parameter           | Description                                       | Example            |
|----------------------------|---------------------------------------------------|--------------------|
| `parameters.communityName` | Name of the community/Experience site to publish. | `MyExperienceSite` |

Example:

```yaml
- id: publishSite
  label: Publish Experience site
  type: publish-community
  parameters:
    communityName: "My Experience Site"
  context: process-deployment-only
```

#### Schedule batch

Schedules an Apex batch class using `System.schedule()`. The action verifies that the specified Apex class exists in the org, implements the `Schedulable` interface, and has a public no-arg constructor. If the class does not meet these requirements, the action fails with a recommendation to use an [`apex`](#run-apex-script) action instead.

If a scheduled job with the same name and cron expression already exists, the action is skipped (idempotent). If a job with the same name but a **different** cron expression exists, the action fails so you can resolve the conflict manually.

| Custom parameter            | Required? | Description                                                                            | Example            |
|-----------------------------|:---------:|----------------------------------------------------------------------------------------|--------------------|
| `parameters.className`      |    Yes    | Name of the Apex class that implements `Schedulable` with a public no-arg constructor. | `MyBatchScheduler` |
| `parameters.cronExpression` |    Yes    | Cron expression for the schedule (Salesforce format).                                  | `0 0 0 * * ?`      |
| `parameters.jobName`        |    No     | Name of the scheduled job. Defaults to `<className>_Schedule` if omitted.              | `MyBatch_Nightly`  |

Example:

```yaml
- id: scheduleNightlyBatch
  label: Schedule nightly batch
  type: schedule-batch
  parameters:
    className: MyBatchScheduler
    cronExpression: "0 0 0 * * ?"
    jobName: MyBatch_Nightly
  context: process-deployment-only
```

> **Note:** If your Schedulable class requires constructor arguments or has a non-public constructor, use an [`apex`](#run-apex-script) action with a custom `.apex` script instead.

#### Remove package.xml items

Removes metadata items from the package.xml calculated by `hardis:deploy:smart`, so they are ignored during the metadata deployment step. Useful to exclude components that are present in git but must not be deployed to the target org (for example org-specific classes or layouts).

Only available as a **pre-deploy** action. The removal applies to the temporary copies of package.xml used by the deployment, never to the manifest files committed in the repository. It is also compatible with delta deployments: items are removed from the calculated delta package.xml.

`runOnlyOnceByOrg` is ignored for this action type: since it only alters the current deployment, it runs at every deployment (check and process).

| Custom parameter             | Description                                                                                                                                                                                                                   | Example                       |
|------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------|
| `parameters.packageXmlItems` | List of items to remove, each in format `TypeName:Member1,Member2`. Use `*` as member to remove a whole type. Member names also support glob wildcards (ex: `Account*`). A single string is also accepted for a single entry. | `ApexClass:MyClass1,MyClass3` |

Example:

```yaml
- id: removeLegacyItems
  label: Remove legacy items from deployment package.xml
  type: remove-packagexml-items
  parameters:
    packageXmlItems:
      - ApexClass:MyClass1,MyClass3
      - Layout:MyLayout1,MyLayout2,MyLayout3
  context: all
```

#### Manual step

Marks a manual step that cannot be automated. The Pull Request comments show the instructions (rendered as markdown) and an unchecked box. Once the operator has performed the action, they tick the box: the next job records the action as done for the org branch and skips it from then on (see [Confirming manual actions with checkboxes](#confirming-manual-actions-with-checkboxes)).

| Custom parameter          | Description                                                                                                                      | Example |
|---------------------------|----------------------------------------------------------------------------------------------------------------------------------|---------|
| `parameters.instructions` | Human-readable instructions or checklist for the operator/reviewer, in markdown format. Use a YAML block to preserve formatting. |         |

Example:

```yaml
- id: url-check
  label: Check external callback URL
  type: manual
  parameters:
    instructions: |
      Verify that the callback URL in `Setup > Named Credentials` is reachable from the target org and matches the production URL.
  context: process-deployment-only
```


