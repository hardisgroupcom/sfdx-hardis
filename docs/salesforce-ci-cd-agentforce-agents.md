---
title: Agentforce agents in CI/CD
description: Retrieve an Agentforce agent with its dependencies, deploy it with sfdx-hardis and activate it in the target org
---
<!-- markdownlint-disable MD013 -->

# Agentforce agents in CI/CD

From API 68.0 (Winter '27), an Agentforce agent is made of two metadata types:

- `AiAgentDefinition`: the agent itself.
- `AiAgentDefinitionVersion`: one version of the agent, written `AgentName#Number` in a package.xml (`My_Service_Agent#3`).

They replace `GenAiPlannerBundle`, and the Salesforce CLI can retrieve an agent version with the Flow, Apex and prompt template actions it uses.

sfdx-hardis covers the three steps of an agent delivery: retrieve it, deploy it, activate it.

## Before you start: API 68.0 in the project

Set the API version of the project to 68.0, once:

- `sfdx-project.json`: `"sourceApiVersion": "68.0"`
- `manifest/package.xml`: `<version>68.0</version>`

Salesforce reads the metadata with the lowest of the org version, `sourceApiVersion` and the package.xml version. Below 68.0 it knows neither `AiAgentDefinition` nor `AiAgentDefinitionVersion`: the retrieve returns no agent file, and the deployment refuses them.

## 1. Retrieve the agent

In your developer sandbox, run [hardis:org:retrieve:agent](hardis/org/retrieve/agent.md):

```shell
sf hardis:org:retrieve:agent
```

The command:

- lists the agents of the org and their versions, and proposes the latest one. An agent built in Agentforce Builder is listed once you clicked **Commit Version**: a draft is not an agent yet
- retrieves the version with its dependencies in your project
- adds every retrieved component to `manifest/package.xml`, with the whole `AiAgentDefinition`
- lists the custom objects, custom fields and Data 360 objects that the agent names and that your project does not hold

The Salesforce CLI does not retrieve these objects and fields with the agent. When the target orgs do not have them, retrieve them too and add them to `manifest/package.xml`.

Then [publish your User Story](salesforce-devops-publish-user-story.md) as usual.

## 2. Deploy the agent

[hardis:project:deploy:smart](hardis/project/deploy/smart.md) deploys the agent like any other metadata, with these checks:

- **The target org must be on API 68.0 or above.** Otherwise the deployment stops before anything is sent.
- **The project must be on API 68.0.** When `sourceApiVersion` or the package.xml version is lower, the check and deployment jobs log a warning that asks to raise them.
- **The first deployment of an agent needs its whole `AiAgentDefinition`.** With [delta deployments](salesforce-devops-config-delta-deployment.md), a Pull Request that only changes a version holds only the `AiAgentDefinitionVersion`. When the target org does not have the agent yet, the deployment stops before anything is sent: deploy the definition too, for example with `nodelta` in the commit message.
- **A version the target org already has is left out.** A committed version never changes, and Salesforce refuses the whole deployment when it holds the active version (*Can't edit an active bot version*). Add `AiAgentDefinitionVersion` with member `*` to [package-no-overwrite.xml](salesforce-ci-cd-config-overwrite.md): only the new versions are sent. The [cleaning](#automate-it-at-each-user-story) adds it for you. Without it, a deployment that holds an active version stops before anything is sent.
- **Agent versions come from the project only.** A warning lists the versions the target org has and the project does not: they were committed in that org, against the [rule](#deliver-a-new-version-of-an-agent).
- **The running user of a service agent is a user of the target org.** An `agent-running-user` deployment action creates it, and the deployment writes it in the agent files: see [the running user of a service agent](#the-running-user-of-a-service-agent).

Agent metadata types do not trigger Apex tests with [Smart Deployment Tests](hardis/project/deploy/smart.md#smart-deployments-tests).

### Deliver a new version of an agent

The project keeps every version you retrieved: `aiAgentDefinitionVersions/My_Agent#1`, `My_Agent#2`... and one authoring bundle per version (`My_Agent_1`, `My_Agent_2`).

1. In your developer sandbox, change the agent in Agentforce Builder and click **Commit Version**.
2. Run [hardis:org:retrieve:agent](hardis/org/retrieve/agent.md) again: it proposes the new version and adds it to `manifest/package.xml`, next to the previous ones.
3. Commit and open your Pull Request as usual. With the [cleaning](#automate-it-at-each-user-story), the activation of the new version, with its number, is added to the deployment actions of the Pull Request.

Each org of the pipeline then gets the new version, which is activated, and Salesforce deactivates the previous one. The older versions stay in the project and in the orgs. To go back to one of them, activate it with an [agent-activate deployment action](#3-activate-the-agent).

Keep the folders of the older versions and of their authoring bundles in the project. Deleting an authoring bundle from an org deletes the whole agent with all its versions, so a Pull Request that deletes one may generate a destructive change that removes the agent from the orgs. The warning about versions committed outside the project also reads them.

!!! warning "Rule: commit agent versions in a developer sandbox only"
    Version numbers are given by the org where the version is committed. A version committed in Agentforce Builder of another org (integration, uat, production) takes a number that the next version of the developer sandbox takes again, and that version is then never deployed there: the org already has a version with this number. The deployment check and deployment jobs warn when the target org has versions of an agent that the project does not have.

### The running user of a service agent

A service agent (`agentType` `EinsteinServiceAgent`) runs as a user of its org: `botUser` in `AiAgentDefinition`, and `default_agent_user` in the Agent Script of its authoring bundles. The retrieved files hold the username of the sandbox you retrieved from, and a user record is data: it is not deployed, and the other orgs have no such user.

sfdx-hardis handles it in two steps, both recorded in the Pull Request or the project:

1. An `agent-running-user` [deployment action](salesforce-devops-work-on-user-story-deployment-actions.md#create-the-running-user-of-an-agentforce-agent), run before the deployment, creates the user when the org has none, with the Salesforce CLI command `sf org create agent-user`: profile **Einstein Agent User**, permission sets `AgentforceServiceAgentBase`, `AgentforceServiceAgentUser` and `EinsteinGPTPromptTemplateUser`, after checking that the org has the licenses. Its username is `<agent>.<unique id>@<org id>.ext`. The [cleaning](#automate-it-at-each-user-story) writes this action, in the `all` context: it runs in the deployment check too, so the check validates the agent with its real user.
2. The built-in replacement rule `builtin-agent-running-user`, on by default, finds this user by its username, writes it in the deployed files, and puts the files of git back after the deployment. It never creates a user: when the org has none, it logs a warning that names the action to add.

A username of git that the target org has (the org you retrieved from, or a sandbox copy of its users) is kept.

To turn it off, for example to create the users yourself in production, add to `config/branches/.sfdx-hardis.main.yml` (or to `config/.sfdx-hardis.yml` for every org):

```yaml
replacementRules:
  - id: builtin-agent-running-user
    enabled: false
```

#### Choose the users yourself

A rule of your own that writes the user wins over the built-in one. It can read the username from a [CI/CD variable](salesforce-devops-config-replacement-rules.md#secrets), for both places the username is written:

```yaml
replacementRules:
  - id: agent-running-user
    description: Running user of the service agents, from a CI/CD variable of each org
    type: text
    files: "**/{aiAgents/*.aiAgentDefinition-meta.xml,aiAuthoringBundles/*/*.agent}"
    find: '(?<=<botUser>)[^<]+(?=</botUser>)|(?<=default_agent_user: ")[^"]+(?=")'
    regex: true
    secret: AGENT_RUNNING_USER
    required: true
```

Then create one variable per major branch of your pipeline in the CI/CD settings: `AGENT_RUNNING_USER_<BRANCH>`, with the name of the branch in upper case (a `/` becomes `__`, any other character that is not a letter or a digit becomes `_`). Each org needs its own user, because a username is unique across all Salesforce orgs. For example, with the branches `integration`, `uat`, `preprod` and `main`:

| Variable                         | Value                                    |
|----------------------------------|------------------------------------------|
| `AGENT_RUNNING_USER_INTEGRATION` | the agent user of the integration org    |
| `AGENT_RUNNING_USER_UAT`         | the agent user of the uat org            |
| `AGENT_RUNNING_USER_PREPROD`     | the agent user of the preprod org        |
| `AGENT_RUNNING_USER_MAIN`        | the agent user of the production org     |

Do not create the variable without a branch suffix (`AGENT_RUNNING_USER`): it is the fallback of every branch that has no variable of its own, and one username can only exist in one org. On GitHub Actions, also add the variables to the `env` of the deployment check and deployment workflows. A missing variable skips the rule for that org, and the Pull Request comment says so.

While a rule of yours writes the user, the built-in rule creates no user, in any org.

With several agents, you can replace only the part after `@`, so one variable per org covers all of them: name the agent users of each org with one domain (for example `service.agent@acme.com.uat` and `sales.agent@acme.com.uat`, created with `sf org create agent-user --base-username`), and use this `find` with a variable such as `AGENT_USER_DOMAIN_UAT=acme.com.uat`:

```yaml
    find: '(?<=<botUser>[^<@]+@)[^<]+(?=</botUser>)|(?<=default_agent_user: "[^"@]+@)[^"]+(?=")'
    secret: AGENT_USER_DOMAIN
```

To keep the usernames in git instead, replace `secret` with `values`, one username per branch, as in [values per org](salesforce-devops-config-replacement-rules.md#values-per-org).

When the built-in rule is off and no rule of yours writes the user, sfdx-hardis warns:

- at retrieve time, when the agent has a `botUser`
- in the deployment check and deployment jobs, when the target org has no user with this username

When activation fails for this reason, the error of the action points to this section.

## 3. Activate the agent

A deployed version is not active. An `agent-activate` [deployment action](salesforce-devops-work-on-user-story-deployment-actions.md#activate-an-agentforce-agent) of the Pull Request activates it after the deployment. The action is stored in the sources, so the Pull Request shows it and reviewers can change it.

- The deployment check job lists the activation in the Pull Request comment, with the other post-deployment actions.
- A version that is already active is left as it is.
- When the version is not found in the target org, or Salesforce refuses to activate it, the action fails, and so does the deployment job: the metadata is in the org, and the Pull Request comment shows the error of the action.

sfdx-hardis never adds actions or changes the package.xml during the deployment job: what the deployment needs is recorded before, in the sources.

### Automate it at each User Story

Add the cleaning `autoAddAgentsDeploymentActions` to `autoCleanTypes` in `config/.sfdx-hardis.yml`:

```yaml
autoCleanTypes:
  - autoAddAgentsDeploymentActions
```

Each time you save a User Story with [hardis:work:save](hardis/work/save.md), [hardis:project:clean:agents-deployment-actions](hardis/project/clean/agents-deployment-actions.md):

- writes, for each agent with a version changed in the User Story, an `agent-activate` action in the deployment actions of the Pull Request (`scripts/actions/.sfdx-hardis.<id>.yml`, or the draft file when the Pull Request does not exist yet). The action activates the version saved with the User Story (`agentVersion: 3`), so the Pull Request says which version each org gets. To activate the highest version of the target org instead, set `agentVersion: latest` in the action: the cleaning keeps it.
- writes, for each of these agents that runs as a user, an `agent-running-user` action before the deployment: see [the running user of a service agent](#the-running-user-of-a-service-agent).
- adds `AiAgentDefinitionVersion` to `manifest/package-no-overwrite.xml` and to every file of `packageNoOverwritePath` in the project and branch configs, once.

!!! note "Deployment time"
    Like for any item of package-no-overwrite.xml, a deployment that holds an agent version lists the content of the target org first, to know which versions it already has. It can take a few minutes on a large org.

Run by hand without `--delta-from`, the cleaning only handles the agent versions not committed yet.

When several Pull Requests that change the same agent are deployed together, each one activates its own version, in the order the actions run: the last one wins. Deliver one version of an agent at a time, or set the action of the last Pull Request to `latest`.

To leave production for a manual activation, add `excludeTargetBranches` to the action, or delete it from the Pull Request.

Without the cleaning, add the action yourself:

```yaml
commandsPostDeploy:
  - id: 7d1f3c2a-5e4b-4c8a-9f61-2b3e4d5a6c7e
    label: Activate the service agent
    type: agent-activate
    parameters:
      agentName: My_Service_Agent
      agentVersion: "3"
    context: process-deployment-only
    runOnlyOnceByOrg: false
```

## Good to know

- The files of an agent version and of an authoring bundle are generated by Salesforce, and the agent graph (`agentGraph/*_graph.json`) is base64 text despite its `.json` extension. The [MegaLinter configuration of sfdx-hardis](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/config/sfdx-hardis.mega-linter-config.yml) leaves them out of the JSON linters (`JSON_FILTER_REGEX_EXCLUDE: (aiAgentDefinitionVersions/|aiAuthoringBundles/)`): the graph is not JSON, and an automatic fix of the action schemas would make every new retrieve show up as a change. If your `.mega-linter.yml` does not extend this configuration, add this line.

## Keep the previous agent types with API 67.0

Both the source org and the target org must be on API 68.0 to use the new types. During a release window, while your sandboxes are on Winter '27 and production is still on Summer '26, keep the previous types: `Bot`, `BotVersion`, `GenAiPlannerBundle` and `AiAuthoringBundle`.

To do so, pin the API version of the project to 67.0:

- `sfdx-project.json`: `"sourceApiVersion": "67.0"`
- `manifest/package.xml` (and the other manifests you deploy): `<version>67.0</version>`
- do not set the `SFDX_API_VERSION` variable to a higher version in your CI/CD

sfdx-hardis deploys `manifest/package.xml` without forcing an API version, so the pinned version is used.

## Move agents from the format before API 68.0

From API 68.0, Salesforce refuses the previous format of an agent: `GenAiPlannerBundle`, and the `Bot` and `BotVersion` of an agent (a classic Einstein Bot is still a `Bot`). A deployment that holds one agent in the previous format fails as a whole, even when the other agents are in the new format: a deployment runs with one API version.

The agents themselves need no change: an org on API 68.0 holds each agent once, and gives it as `AiAgentDefinition` to an API 68.0 retrieve. For each agent of the previous format:

1. Set the API version of the project to 68.0 ([before you start](#before-you-start-api-680-in-the-project)).
2. Run [hardis:org:retrieve:agent](hardis/org/retrieve/agent.md) for the agent, in your developer sandbox. It adds the new format to `manifest/package.xml`, removes the `GenAiPlannerBundle`, `Bot` and `BotVersion` entries of the agent, and lists the old folders: `bots/<agent>` and `genAiPlannerBundles/<agent>_v<n>`.
3. Delete these folders and commit. Do not add them to `destructiveChanges.xml`: the agent still exists in the orgs.

Until every agent is moved, the deployment check and deployment jobs stop before anything is sent, and list the entries of the previous format with these steps.

!!! warning
    The [monitoring backup](salesforce-monitoring-metadata-backup.md) raises the API version of its own repository to the version of the org. A pin to 67.0 does not hold in a monitoring repository.
