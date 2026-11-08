---
title: Deployment actions on a Salesforce CI/CD project
description: "With sfdx-hardis, automate and track the steps around your deployments: data loads, Apex scripts, community publishing, scheduled batches and manual steps"
---
<!-- markdownlint-disable MD013 -->

## Deployment actions

### What are deployment actions?

Deploying a User Story is not always just about metadata. Sometimes something else must happen around the deployment: load reference records, run an Apex script, publish an Experience Cloud site, schedule a batch job, or simply remind someone to activate a setting in Setup.

**Deployment actions** let you declare these steps once, together with your Pull Request. sfdx-hardis then runs them automatically in every org your work is deployed to (integration, uat, preprod, production...), in the right order, exactly once per org, and keeps a visible record of what has been done where. Even the steps a human must perform are declared the same way, so they are replayed identically from one org to the next instead of living in someone's memory or in a chat message.

Actions can be attached to a **Pull Request** (they follow your User Story from org to org) or to the **whole project** (they run at every deployment).

### Action types

You can automate (or track) the following kinds of steps. Each type has its own page: what it does, how it looks in VS Code, and its YAML parameters.

| Type                                                                                                                                                                                       | YAML `type`               | What it does                                                                                     |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------|--------------------------------------------------------------------------------------------------|
| <a id="run-a-command"></a>[Run a command](salesforce-devops-work-on-user-story-deployment-actions-command.md)                                                                              | `command`                 | Runs any command line: a `sf` command, a script, anything your CI runner can execute.            |
| <a id="import-data-sfdmu"></a>[Import data (SFDMU)](salesforce-devops-work-on-user-story-deployment-actions-data.md)                                                                       | `data`                    | Loads records with one of the SFDMU data workspaces of the project.                              |
| <a id="run-an-apex-script"></a>[Run an Apex script](salesforce-devops-work-on-user-story-deployment-actions-apex.md)                                                                       | `apex`                    | Runs a `.apex` script file of the project against the target org.                                |
| <a id="publish-an-experience-cloud-site"></a>[Publish an Experience Cloud site](salesforce-devops-work-on-user-story-deployment-actions-publish-community.md)                              | `publish-community`       | Publishes an Experience Cloud site after the deployment.                                         |
| <a id="schedule-an-apex-batch"></a>[Schedule an Apex batch](salesforce-devops-work-on-user-story-deployment-actions-schedule-batch.md)                                                     | `schedule-batch`          | Schedules an Apex batch job with a cron expression.                                              |
| <a id="run-an-apex-batch"></a>[Run an Apex batch](salesforce-devops-work-on-user-story-deployment-actions-run-batch.md)                                                                    | `run-batch`               | Runs an Apex batch once, and can wait for its result.                                            |
| <a id="activate-user-access-policies"></a>[Activate User Access Policies](salesforce-devops-work-on-user-story-deployment-actions-user-access-policy.md)                                   | `user-access-policy`      | Activates the User Access Policies a deployment left in Design status, and can run Apply To All. |
| <a id="apply-a-setup-setting-in-a-browser"></a>[Apply a Setup setting in a browser](salesforce-devops-work-on-user-story-deployment-actions-browser.md)                                    | `browser`                 | Applies a Setup setting the Metadata API cannot deploy, with Browserforce.                       |
| <a id="remove-items-from-packagexml"></a>[Remove items from package.xml](salesforce-devops-work-on-user-story-deployment-actions-remove-packagexml-items.md)                               | `remove-packagexml-items` | Removes items from the calculated package.xml, without touching the repository.                  |
| <a id="manual-step"></a><a id="write-the-instructions-click-by-click"></a>[Manual step](salesforce-devops-work-on-user-story-deployment-actions-manual.md)                                 | `manual`                  | A step a person performs, with instructions and a checkbox in the Pull Request comments.         |
| <a id="publish-an-agentforce-agent"></a>[Publish an Agentforce agent](salesforce-devops-work-on-user-story-deployment-actions-agent-publish.md)                                            | `agent-publish`           | Publishes the authoring bundle of an Agentforce agent after the deployment.                      |
| <a id="create-the-running-user-of-an-agentforce-agent"></a>[Create the running user of an Agentforce agent](salesforce-devops-work-on-user-story-deployment-actions-agent-running-user.md) | `agent-running-user`      | Creates the user a service agent runs as, in an org that does not have it.                       |
| <a id="activate-a-version-of-an-agentforce-agent"></a>[Activate a version of an Agentforce agent](salesforce-devops-work-on-user-story-deployment-actions-agent-activate.md)               | `agent-activate`          | Activates the latest version of an Agentforce agent in the target org.                           |
| [Custom functions](salesforce-devops-work-on-user-story-custom-functions.md)                                                                                                               | the name of your function | Your own node, python or bash script, packaged as an action type of your project.                |

### Manage your actions from VS Code

Everything can be done with clicks in the [VS Code SFDX Hardis extension](https://sfdx-hardis.cloudity.com/vscode-extension/), from the **DevOps Pipeline** panel:

1. Open the **DevOps Pipeline** and click the **My Pull Request** card.

    ![My Pull Request card](assets/images/card-my-pull-request.png)

2. In the window that opens, go to the **Deployment Actions** tab. It lists the actions already attached to your Pull Request (Merge Request on GitLab), with their type and when they run.

    ![List of the deployment actions of a Pull Request](assets/images/screenshot-pr-deployment-actions-list.jpg)

3. Click **Add New Action** to create an action, or click an existing action to view and edit it.

    ![Deployment action editor](assets/images/screenshot-edit-deployment-action.jpg)

Deployment actions are declared on the Pull Requests of User Stories (feature or fix branches). A Pull Request between two major branches, like a promotion from `integration` to `uat`, carries no action of its own: its **Deployment Actions** tab lists, read-only, the actions of the User Story Pull Requests it brings along, with their author and Pull Request.

You can also review the deployment actions of already merged Pull Requests: click a major branch (like `integration`) in the pipeline diagram, then open its **Deployment Actions** tab.

![Deployment actions of a branch](assets/images/screenshot-deployment-actions.jpg)

<details markdown="1"><summary>Technical: where actions are stored (YAML)</summary>

Actions are stored in properties `commandsPreDeploy` / `commandsPostDeploy` of `.sfdx-hardis.yml` config files. The VS Code extension reads and writes these files for you. Create each action with it, or with [hardis:project:action:create](hardis/project/action/create.md): both generate the `id` of the action. When you edit a file by hand, never write or change an `id`: it links the action to its state in the Pull Request comments.

- Pull Request level: `scripts/actions/.sfdx-hardis.<PR_ID>.yml` (ex: `scripts/actions/.sfdx-hardis.372.yml`).
- Repository level: `config/.sfdx-hardis.yml`

Example of a Pull Request level configuration file defining pre-deploy and post-deploy actions:

```yaml
# scripts/actions/.sfdx-hardis.372.yml
commandsPreDeploy:
  - id: 00de1479-8639-46a2-96e1-88cfa69be4db
    label: Run initialization apex
    type: apex
    parameters:
      apexScript: scripts/apex/init.apex
    context: process-deployment-only
  - id: 47f666ba-944c-4721-9127-a08f51fb0a6c
    label: Remove KnowledgeUser flag
    type: command
    command: >-
      sf data update record --sobject User --where "UserPermissionsKnowledgeUser='true'" --values "UserPermissionsKnowledgeUser='false'" --json
    context: all

commandsPostDeploy:
  - id: f150d991-ecec-460a-8a0e-5f2db77ded60
    label: Import email templates
    type: data
    parameters:
      sfdmuProject: EmailTemplate
    context: process-deployment-only
  - id: 3d700b21-4916-4344-ac46-67919081a008
    label: Publish Experience site
    type: publish-community
    parameters:
      communityName: "My Experience Site"
    context: process-deployment-only
```

Each action is an object with the following required and optional properties.

| Field                   | Type    | Required? | Description                                                                                                                                                                                      |
|-------------------------|---------|:---------:|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `id`                    | string  |    Yes    | Generated when the action is created. Never write it or change it by hand: it links the action to its tracked state.                                                                             |
| `label`                 | string  |    Yes    | Human-readable description of the action.                                                                                                                                                        |
| `type`                  | string  |    Yes    | One of `command`, `data`, `apex`, `publish-community`, `schedule-batch`, `run-batch`, `remove-packagexml-items`, `manual`.                                                                       |
| `context`               | string  |    Yes    | When the action should run. Allowed values: `all` (default), `check-deployment-only`, `process-deployment-only`.                                                                                 |
| `command`               | string  |    No     | Shell command to run (used by `command` type).                                                                                                                                                   |
| `parameters`            | object  |    No     | Parameters of the action (see action types)                                                                                                                                                      |
| `customUsername`        | string  |    No     | Run the action with a specific username instead of the default target org.                                                                                                                       |
| `includeTargetBranches` | array   |    No     | Run the action only when the deployment targets one of these branches. See [Choose the target orgs](#choose-the-target-orgs).                                                                    |
| `excludeTargetBranches` | array   |    No     | Run the action on every target branch except these ones. See [Choose the target orgs](#choose-the-target-orgs).                                                                                  |
| `allowFailure`          | boolean |    No     | If true and the action fails, the deployment continues and the action is reported as a warning (⚠️) instead of a failure. It runs again on the next deployment, like a failed action.            |
| `runOnlyOnceByOrg`      | boolean |    No     | Default: `true`. If true, the action runs only once per target org. Execution state is tracked in a dedicated "Deployment Actions" PR comment (see below), no Salesforce custom object required. |
| `movedFrom`             | integer |    No     | Number of the Pull Request the action was moved from, to fix its definition after it failed. See [Recover a failed action](#recover-a-failed-action).                                            |

</details>

### When do they run?

For each action you choose two simple things, visible in the editor:

- **When**: before or after the metadata deployment.
- **Execution Contexts**: run it during **validation jobs** (the simulated deployment when the Pull Request is checked), during **deployment jobs** (the real deployment after the merge), or both.

By default, an action **runs only once per org**: once it has been performed in `uat`, it will not run there again, but it will still run in `preprod` and production when your work gets promoted. A failed action runs again at the next deployment that carries its Pull Request: in practice, the promotion to the next org. To fix it in the org where it failed, see [Recover a failed action](#recover-a-failed-action). Manual steps wait until someone confirms them (see below).

> Post-deployment actions are never run when the metadata deployment failed. They are proposed again during the next successful deployment.

<details markdown="1"><summary>Technical: execution contexts, run-once tracking and Pull Request scope</summary>

**Execution contexts** map to the `context` property: `all` (default), `check-deployment-only` (validation job of the Pull Request), `process-deployment-only` (real deployment after merge).

**runOnlyOnceByOrg: skip-on-next-run logic**

When `runOnlyOnceByOrg` is `true` (the default), the "Deployment Actions" PR comment is used as the state store:

- If the table already contains a ✅ `success` row for `(actionId, orgBranch)`, the action is **skipped** with a ⚪ status on subsequent deployments.
- ❌ `failed` entries are always **retried** on the next run.
- Each action is tracked per org independently: the same action will run once in `integration` and once in `uat`.

Requirements:

- A git provider token must be configured (GitHub: `GITHUB_TOKEN`, GitLab: `CI_SFDX_HARDIS_GITLAB_TOKEN`, Azure DevOps: `SYSTEM_ACCESSTOKEN`, Bitbucket: `CI_SFDX_HARDIS_BITBUCKET_TOKEN`).
- Without a git provider, actions with `runOnlyOnceByOrg: true` are **skipped with a warning** (to avoid untracked re-executions). All other actions still run normally; only the PR comment update is skipped.

Opt out by adding `runOnlyOnceByOrg: false` explicitly on any action that should always run.

**Which Pull Requests are in scope**

The actions collected for a deployment depend on the branch the merged Pull Request comes from. The validation job of a Pull Request applies the same rule to the Pull Request being checked, so the check comment of a feature Pull Request lists only its own actions.

| Merge                                                                                                                                                                       | Scope                                                                |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------|
| From a feature branch (ex: `feature/my-story` to `integration`)                                                                                                             | Only the Pull Request that has just been merged                      |
| Between major branches (ex: `integration` to `uat`)                                                                                                                         | Every Pull Request merged since the previous merge                   |
| From a retrofit branch (ex: `retrofit/from-main` to `integration`)                                                                                                          | Every Pull Request merged since the previous merge                   |
| From a [promotion branch (Beta)](salesforce-devops-promotion-branches.md) (ex: `promotion/uat/preprod/2026-09-06-1430` to `preprod`), when `enablePromotionBranches` is set | The Pull Requests declared in the promotion Pull Request description |

- Between major branches, the batch is every Pull Request merged into the source major branch since its last promotion.
- Into the production branch (which has no promotion target), the batch is every Pull Request carried by the go-live merge itself.
- Pull Requests merged into upstream branches are part of the batch as soon as their commits arrive in the window: a hotfix merged into `main` is collected when a retrofit branch brings it down to `integration`, so its actions run there too.

In every case, `runOnlyOnceByOrg` state tracking makes sure each action runs only in the orgs where it has not been performed yet. The same scope applies to the Apex test classes selected from Pull Requests when `enableDeploymentApexTestClasses` is active.

The resolved scope is visible in two places:

- In job logs, as a single line: `Pull Request scope: 5 Pull Request(s) (#4491, #4494, ...)`. Each Running/Skipping line then shows the Pull Request that defines the action.
- In the check and deployment Pull Request comments, which state which Pull Requests the deployment actions and Apex test classes were collected from, with links.

> If the deployment job of a feature branch fails, its actions are not picked up by the next merged Pull Request. When the metadata deployment itself failed, re-run the failed deployment job. When only an action failed, see [Recover a failed action](#recover-a-failed-action).

</details>

#### Identical actions run once

When several Pull Requests of the same deployment carry the same action, for example five User Stories that each publish the same Experience Cloud site, it runs once. The first one runs, and the others are recorded as done by it on their own Pull Request.

Two actions are the same when they are of the same type, run at the same moment (before or after the deployment) as the same user, with the same parameters: the same command line, Apex script, data workspace, site name... Their labels do not matter. Manual steps are never merged: each Pull Request keeps its own checkbox. An action written twice in the same Pull Request runs twice.

<details markdown="1"><summary>Technical: how identical actions are detected and recorded</summary>

**What is compared**

The type, the phase (`commandsPreDeploy` or `commandsPostDeploy`), `customUsername`, and what the action does, once its `${{ }}` references are resolved:

| Type                      | Compared                                                   |
|---------------------------|------------------------------------------------------------|
| `command`                 | The command line                                           |
| `apex`                    | The path of the Apex script                                |
| `data`                    | The data workspace                                         |
| `publish-community`       | The site name                                              |
| `schedule-batch`          | The class, the cron expression and the job name            |
| `run-batch`               | The class and the run options, with their defaults applied |
| `remove-packagexml-items` | The items to remove, whatever their order                  |
| Custom function           | Its input parameters                                       |
| `manual`                  | Never merged                                               |

The id, the label, the Pull Request, `context`, the branch filters, `allowFailure` and `runOnlyOnceByOrg` are not compared: whether an action runs in a job is decided before it is compared.

**Which one runs**

- Only actions of different sources are merged: two Pull Requests, or a Pull Request and the branch or project config. An action written twice in one Pull Request, or twice in the config, runs twice.
- Actions are compared within one job: the validation job, the deployment job, a retry with `sf hardis:project:action:run` and a backpromote each run their own. Two copies that run in different jobs both run, for example one with `context: all` (run by the validation job) and one with `context: process-deployment-only`.
- The first copy in the deployment order runs: the branch and project actions first, then the Pull Requests from the oldest merge to the newest. When a later Pull Request lists other actions before its copy, they run after the shared action.
- Only a successful run stands for the others. When the first copy fails, even with `allowFailure: true`, the next copy runs.

**How a copy is recorded**

- In the results of the job, a copy is ⚪ skipped: `same action as <label> (#101), run once for this deployment`.
- In the status matrix of its own Pull Request, it is ✅ done in that org, with a note naming the action that ran. A re-run of the job does not run it again.
- When a failure stops the job, a later copy of an action that already succeeded is recorded as done, not as stopped.
- A copy of a custom function receives the outputs of the action that ran, so `${{ actions.<id of the copy>.outputs.<name> }}` keeps working.
- The **Next promotion** mode of the VS Code Deployment Actions tab and the Backpromote panel show which actions run once with an identical one.

</details>

### Choose the target orgs

By default, an action runs in every org your work is deployed to. In the editor, the **Target orgs** field lets you restrict it: run it **everywhere**, only on **some major branches** (for example only `uat`), or **everywhere except** a few (for example everywhere but production). You can also target **developer sandboxes** specifically.

Choose **Only these branches** when the action makes sense in a few orgs only. In the example below, the ERP is connected to the uat and production orgs only, so the action that enables the integration runs in `uat` and `main`, and nowhere else.

![Deployment action running on uat and main only](assets/images/screenshot-deployment-action-target-orgs-include.jpg)

Choose **All except these branches** when the action must run everywhere but a few orgs, most often production. In the example below, the Apex script that upserts the sample records used to test the agents runs in every org except `main`.

![Deployment action running everywhere except main](assets/images/screenshot-deployment-action-target-orgs-exclude.jpg)

<details markdown="1"><summary>Technical: includeTargetBranches / excludeTargetBranches</summary>

Two mutually exclusive properties control the target orgs:

- `includeTargetBranches`: the action runs only when the deployment targets one of the listed branches.
- `excludeTargetBranches`: the action runs everywhere except on the listed branches.

```yaml
commandsPostDeploy:
  # Runs on UAT and preprod only
  - id: 6e9749de-d7e7-4e44-8742-f8cae3e2142e
    label: Publish the customer community
    type: publish-community
    parameters:
      communityName: Customer
    context: process-deployment-only
    includeTargetBranches:
      - uat
      - preprod

  # Runs everywhere except production
  - id: 1a4d01e2-7008-4651-9afb-589c280d9b2e
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
  - id: 6c3daad7-9fbc-4bfd-b8fc-587a6fe7ff85
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

</details>

### Track what has been done

After every deployment, sfdx-hardis creates or updates a **"Deployment Actions"** comment on the Pull Request. At a glance, it shows:

- the **manual steps still waiting** to be performed, as a checklist: tick a box once you have done the action, and sfdx-hardis records it,
- a **status matrix**: one row per action, one column per org, so release managers can see in which orgs each action has been performed, has failed, or is still pending.

This works on GitHub, GitLab, Azure DevOps and Bitbucket.

<details markdown="1"><summary>Technical: the Deployment Actions PR comment format</summary>

**Comment structure**: one shared comment per PR, across all CI workflows:

- A one-line verdict: what failed, what waits for a failed action and what is still to do by hand, per org.
- A **Needs you** checklist: one checkbox per action that failed (❌), was stopped by a failure (⏸️), or is a manual action still to perform (👋), in an org. Ticking it records the action as done, or as closed by hand for a failed one.
- A **Status by org** matrix: one row per action, one column per org branch.
- A collapsible **Action Details** section with the action properties (type, context, command or script...) and truncated output per org.

Example of the status matrix:

```markdown
#### Status by org

| Action                      | When        |          integration           |              uat              |
|-----------------------------|-------------|:------------------------------:|:-----------------------------:|
| Remove KnowledgeUser flag   | pre-deploy  | ✅ 2024-06-01<br/>[12345](...)  | ✅ 2024-06-05<br/>[12890](...) |
| Import email templates      | post-deploy | ✅ 2024-06-01<br/>[12345](...)  | ✅ 2024-06-05<br/>[12890](...) |
| Publish Experience site     | post-deploy | ❌ 2024-06-02<br/>[12501](...)  |               ⬜               |
| Check external callback URL | post-deploy | 👋 2024-06-01<br/>[12345](...) |               ⬜               |

*Legend: ✅ done · ❌ failed · 👋 to do by hand · ⚪ skipped · ⏸️ waits for a failed action · ↪️ moved to another Pull Request · ⬜ not run in this org branch yet*
```

Columns are ordered from dev to production (integration → uat → preprod → prod), rows follow the deployment order (pre-deploy actions first, then post-deploy). Each cell shows the status icon, the execution date and a link to the CI job that performed the action. The date of the last update is displayed under the matrix. The action `id` is embedded in each row as an HTML comment for machine parsing. The notes of the *Action Details* section name who did an action, without their email address: the hidden data of the matrix keeps it.

**Status icons:**

| Icon | Status    | Meaning                                                            |
|------|-----------|--------------------------------------------------------------------|
| ✅    | `success` | Executed successfully (or confirmed as done via its checkbox)      |
| ❌    | `failed`  | Executed but failed, will be retried next run                      |
| 👋   | `manual`  | Manual step - waiting for a human to perform it and tick the box   |
| ⚪    | `skipped` | Skipped (e.g. already run via `runOnlyOnceByOrg`)                  |
| ⏸️   | `not-run` | Not run because a previous action failed, will be retried next run |
| ↪️   | `moved`   | Moved to a fix Pull Request (`movedFrom`), runs from there         |
| ⬜    | -         | Not run in this org branch yet                                     |

> Comments written with the previous format (one row per action and org branch pair) are still parsed, and are migrated to the matrix format on their next update.

**Confirming manual actions with checkboxes**

Manual action checklists appear in three kinds of Pull Request comments: check results, deployment results, and the Deployment Actions comment. Every checklist item carries a hidden marker identifying the action and the org branch.

When someone ticks one of these checkboxes (in any of the three comments), or the checkbox of a failed action, the next check or deployment job:

- records the action as done for that org branch in the Deployment Actions comment,
- skips it in later deployments to that org (same behavior as a successful `runOnlyOnceByOrg` action),
- ticks the same checkbox in the other comments where the action appears, so all views stay consistent.

**Block the validation until a pre-deployment manual action is done**

A manual action that runs **before the metadata deployment** must be performed before the merge. By default, the validation job only lists the ones not marked as performed in the target org branch, with a warning. Set `failValidationOnPendingManualActions: true` in `config/.sfdx-hardis.yml` to make it stop instead: as long as one is not marked as performed in the target org branch, the validation job of the Pull Request fails right after its pre-deployment actions, before the deployment check, with the list of the actions to perform and the three ways to mark them:

- tick its box in the **Needs you** list of the Deployment Actions comment, or in the validation comment,
- click **Mark as done in <branch>** in the VS Code Deployment Actions tab,
- or run `sf hardis:project:action:set-status --pr <number> --action-id <id> --org-branch <branch> --status success`.

The execution context of such an action is ignored: the validation job lists it even when the action is declared for the deployment job only, because the step has to be done before the merge.

Then run the validation job again: it records the tick and goes on. A draft Pull Request (the draft flag of the git provider, or `draft` in its title) is never stopped: the job only warns, so the deployment check still runs while the work is in progress. A post-deployment manual action never blocks the validation, since it can only be done after the merge.

This requires the same git provider token as `runOnlyOnceByOrg` state tracking.

</details>

### Try your actions in your own org

Before the merge, run the actions of your Pull Request in your own org, a developer sandbox or a scratch org, to check they do what you expect.

**From VS Code**: open your Pull Request with the **My Pull Request** card, then its **Deployment Actions** tab. Each action has a **Run in my org** button, which reads **Rerun** once a try in your org failed. It runs in your default org: when that is the org of a major branch, nothing runs.

**From the terminal**: [sf hardis:project:action:run](hardis/project/action/run.md) with `--action-id`, or `--all` to run them all, pre-deployment actions first, in a developer org.

- Validation-only actions and package.xml item removals are skipped: they only make sense in a deployment. A `runOnlyOnceByOrg` action already done in your org is skipped too.
- The result of each action shows under its label: *In your org: Done*. With a Pull Request, it is also recorded in its "Deployment Actions" comment, under `dev-sandboxes`, shared by every developer org: it never counts as done in a major org and never turns the comment red.
- Without a Pull Request yet, the results stay on your computer, in `config/user/deployment-actions/draft.json`, which git ignores.

### Recover a failed action

A post-deployment action runs after the metadata deployment, once the Pull Request is merged. When it fails, the metadata is already in the org, the job is red, and the actions after it were not run. The deployment comment says it first, *Deployed to integration, but an action failed after the deployment*, with the end of the output of the failed action. The "Deployment Actions" comment of the Pull Request lists them under **Needs you**: ❌ for the action that failed, ⏸️ for the ones its failure stopped.

![Deployment Actions comment with a failed action and two stopped ones](assets/images/screenshot-deployment-actions-comment-failed.jpg)

You do not need to re-run the whole deployment job. Pick the way that fits the cause:

| The cause                                                                       | What to do                                                                                                          |
|---------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| Something was missing in the org (a record, a permission, a setting), now fixed | **Retry** the action: it runs again in the org, alone, then you choose whether to run the actions it stopped        |
| The action definition is wrong (script path, class name, parameter)             | **Move it to a fix Pull Request**, correct it there, merge: it runs from the fix Pull Request                       |
| Someone already did it by hand                                                  | **Mark it as done**: it is recorded as done, with who closed it and when, and later deployments to that org skip it |

**From VS Code**: open the DevOps Pipeline, click the major branch (or the Pull Request), then the **Deployment Actions** tab. The actions are grouped by Pull Request, in the order they run, with their status in the org of the branch and, for a stopped one, the action that stopped it. The header of each Pull Request counts its actions by status and, when the window lists several Pull Requests, the **Total** pills above them add up the whole window. Click a **Total** pill to hide the actions of that status, and click it again to show them. A failed action shows **Retry** and **Mark as done** buttons, and the menu at the end of each row holds the rest, **Move to my Pull Request** included.

![Deployment Actions tab with the status of each action and the menu of a failed one](assets/images/screenshot-deployment-action-failed-tab.jpg)

**Retry** runs the action in the org, then offers to run the actions its failure stopped. Here the first action succeeds, and the next one fails on a wrong class name: that one needs a fix Pull Request.

![Retry of a failed deployment action in VS Code](assets/images/screenshot-deployment-action-retry.jpg)

**Mark as done in <branch>** records the action as done in the background, with who closed it and when: the button reads *Marking as done in <branch>...* until the status turns to *Done*.

Click a status pill to see the action in every org: one line per major branch (status, date, job, note, and a **Mark as done** button where it is not done yet), then one line per developer sandbox or scratch org that ran it, from the Backpromotes comment of the Pull Request.

In the window of a major branch, the **Next promotion: preprod** switch (the first merge target of the branch) shows what the promotion will do with each action in preprod: **Waiting for you** (a pre-deployment manual action, with **Mark as done in preprod**), **After the merge** (a post-deployment manual action, to do once the promotion is deployed), **Done in preprod**, **Runs at validation**, **Runs at deployment**, **Failed in preprod**, **Not for preprod** (branch filter, validation only), or **Not in this promotion** when the open promotion Pull Request does not carry its Pull Request. A bar above the actions links the promotion Pull Request and its last job, and the **Total** pills add up the actions the promotion carries (the Pull Requests it leaves out are not counted). The forecast comes from [sf hardis:project:action:list](hardis/project/action/list.md) with `--forecast`.

**Mark as done in another org...**, in the menu of every action, asks where it was done: a major branch where it is not done yet, before or after the current one, or a developer org authenticated on your computer. Before creating the Pull Request from uat to preprod, mark the pre-deployment manual actions you already did in preprod: its validation and deployment jobs skip them. In a developer org, the action is recorded in the Backpromotes comment for that org, and a backpromote skips it there. A manual action waiting in the org has the same button: it does what ticking its checkbox in the Pull Request comment does, and also names who did it. A failure the action allows (*Failed (allowed)*) blocked nothing, so its group is not listed first. In the window of a major branch, an action never run in its org, or skipped there, has **Run in <branch>** in its menu: sfdx-hardis asks for a confirmation first. **Move to my Pull Request** stays greyed out until you are on a branch with a Pull Request. **Run in another org...**, on every action that can run, lists every org authenticated on your computer, the orgs of the major branches first: in a major org it is a retry, recorded in the Deployment Actions comment; in a developer sandbox or a scratch org it is a try, also recorded in the Backpromotes comment of the Pull Request for that org, so a later backpromote does not run it again there.

**Move to my Pull Request** moves the action to the Pull Request of your current branch: correct it there. The action editor shows where it comes from.

![Deployment action editor showing the Pull Request the action was moved from](assets/images/screenshot-deployment-action-moved-from.jpg)

**From the terminal**:

- Retry: [sf hardis:project:action:run](hardis/project/action/run.md). Without flags, it proposes the recent Pull Requests with failed actions in the org, then their actions. Once the action succeeds, it offers to run only the next stopped action, or all of them.
- Mark as done: [sf hardis:project:action:set-status](hardis/project/action/set-status.md), or tick the checkbox of the action in the **Needs you** list of the Deployment Actions comment (recorded by the next sfdx-hardis job).
- Move to a fix Pull Request, from your fix branch: `sf hardis:project:action:update --scope pr --pr-id <failed PR> --when post-deploy --action-id <id> --move-to-pr current`. The action keeps its id, leaves the file of the original Pull Request and gets `movedFrom: <failed PR>`. Correct it, then open and merge the fix Pull Request as usual.

Things to know:

- Anyone authenticated to the org can retry an action, production included. The Pull Request comment says who did it: *Run locally by Jane Doe on 2026-10-03 14:05 UTC*.
- An action with a `customUsername` runs as that user. When your computer is not authenticated with it, you are asked to log in with it.
- The action definition is read from your current branch. When the org is a major org and you are on another branch, you are warned and asked to confirm.
- A pre-deployment action can be run after a confirmation, since in a deployment it runs before the metadata, which is already in the org. When it failed and blocked the deployment, nothing was deployed: re-run the deployment job instead.
- Once an action moved to a fix Pull Request has run, the original Pull Request shows it as ↪️ moved, with a link. When both Pull Requests are promoted together, the action runs once.

![Deployment Actions comment of the original Pull Request, with the action moved to the fix Pull Request](assets/images/screenshot-deployment-actions-comment-moved.jpg)
- A git provider token is required to record the result, as for `runOnlyOnceByOrg`.

### Disable deployment actions

On some projects you may want to turn the whole feature off: for example when the repository has a very long Pull Request history and the git provider API takes too long to process it, or when your pipelines must not call the git provider at all.

Set the `disableDeploymentActions` property in `config/.sfdx-hardis.yml` (or in a branch-scoped config file to disable it only for some target branches):

```yaml
disableDeploymentActions: true
```

You can also set the env variable `SFDX_HARDIS_DISABLE_DEPLOYMENT_ACTIONS=true` on a CI job to get the same result without committing a config change (setting it to `false` re-enables the feature even if the config property is `true`).

When disabled:

- `commandsPreDeploy` and `commandsPostDeploy` are not run, whether they are defined in the project / branch config or attached to Pull Requests,
- the Pull Request scope is not computed, so no Merge Request history is fetched from the git provider,
- test classes attached to Pull Requests (`enableDeploymentApexTestClasses`) are not collected, since they would need the Pull Request scope,
- the Deployment Actions comments and manual action checkboxes are neither read nor updated,
- internal actions requested by Pull Request custom behaviors (like `purgeFlowVersions` or `destructiveChangesAfterDeployment`) are skipped too, with a warning in the job logs.

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.cloudity.com) course does this, click by click, on an org of your own, in these labs:

- [Lab 2.3 - Fix broken records with an Apex deployment action](https://sfdx-hardis-training.cloudity.com/en/level-2-contributor-advanced/2-3-fix-broken-records-with-an-apex-deployment-action/)
- [Lab 2.4 - Ship reference data and a batch with deployment actions](https://sfdx-hardis-training.cloudity.com/en/level-2-contributor-advanced/2-4-ship-reference-data-and-a-batch-with-deployment-actions/)
- [Lab 2.9 - Capstone: deliver a User Story that has it all](https://sfdx-hardis-training.cloudity.com/en/level-2-contributor-advanced/2-9-capstone-deliver-a-user-story-that-has-it-all/)
- [Lab 3.3 - Read the deployment log, and what .forceignore hides from it](https://sfdx-hardis-training.cloudity.com/en/level-3-release-manager/3-3-deploy-to-integration-and-read-the-log/)

<!-- training-links:end -->
