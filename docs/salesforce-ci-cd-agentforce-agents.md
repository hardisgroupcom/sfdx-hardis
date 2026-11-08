---
title: Agentforce agents in CI/CD
description: Retrieve an Agentforce agent with its dependencies, deploy it with sfdx-hardis, then publish and activate it in each org
---
<!-- markdownlint-disable MD013 -->

# Agentforce agents in CI/CD

From API 68.0 (Winter '27), an Agentforce agent is made of three metadata types:

- `AiAuthoringBundle`: the Agent Script of the agent (`.agent` file), what you write in Agentforce Builder.
- `AiAgentDefinition`: the agent itself.
- `AiAgentDefinitionVersion`: one version of the agent, written `AgentName#Number` in a package.xml (`My_Service_Agent#3`).

They replace `GenAiPlannerBundle`. Publishing an authoring bundle in an org (`sf agent publish authoring-bundle`) creates the agent there, or a new version of it, numbered by that org.

The project holds **one authoring bundle per agent**, `aiAuthoringBundles/<Agent>/`, and no version: each org of the pipeline gets its own version when the bundle is published there. A new version of an agent is then a plain change of the Agent Script in the Pull Request, and the version numbers of the orgs never have to match.

sfdx-hardis covers the three steps of an agent delivery: retrieve it, deploy its dependencies, publish and activate it.

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
- retrieves the version with its dependencies (its Flow, Apex and prompt template actions) in your project
- writes the Agent Script of this version in `aiAuthoringBundles/<Agent>/`, and removes the retrieved files of the version and of the agent definition
- adds the dependencies and `AiAuthoringBundle:<Agent>` to `manifest/package.xml`
- lists the custom objects, custom fields and Data 360 objects that the agent names and that your project does not hold

The Salesforce CLI does not retrieve these objects and fields with the agent. When the target orgs do not have them, retrieve them too and add them to `manifest/package.xml`.

Then [publish your User Story](salesforce-devops-publish-user-story.md) as usual.

## 2. Deploy the agent

[hardis:project:deploy:smart](hardis/project/deploy/smart.md) deploys the bundle and the dependencies of the agent like any other metadata. A metadata deployment of a bundle only updates the draft of the agent in the org: it creates no version. The version is created after the deployment, by the [publication](#3-publish-and-activate-the-agent).

Salesforce refuses the deployment when one of these is not met:

- **The target org must be on API 68.0 or above.**
- **The project must be on API 68.0**: `sourceApiVersion` and the package.xml version.
- **The running user of a service agent is a user of the target org.** An `agent-running-user` deployment action creates it: see [the running user of a service agent](#the-running-user-of-a-service-agent).

Agent metadata types do not trigger Apex tests with [Smart Deployment Tests](hardis/project/deploy/smart.md#smart-deployments-tests).

### Deliver a new version of an agent

1. In your developer sandbox, change the agent in Agentforce Builder and click **Commit Version**.
2. Run [hardis:org:retrieve:agent](hardis/org/retrieve/agent.md) again: it writes the new version over the Agent Script of `aiAuthoringBundles/<Agent>/`.
3. Commit and open your Pull Request as usual. The Pull Request shows the change of the Agent Script against the version the project had. With the [cleaning](#automate-it-at-each-user-story), the publication of the agent is added to the deployment actions of the Pull Request.

Each org of the pipeline then gets a new version, numbered by that org, which is activated, and Salesforce deactivates the previous one. The older versions stay in the orgs, with a different number in each org: to go back to one of them, revert the change of the Agent Script and publish again.

Keep the bundle folder of each agent in the project. Removing an agent from the orgs is not automated: Salesforce refuses to delete an agent definition that has versions, and deleting authoring bundles from an org deletes agent versions.

### The running user of a service agent

A service agent (`agentType` `EinsteinServiceAgent`) runs as a user of its org: `default_agent_user` in the Agent Script of its authoring bundle, and `botUser` in the `AiAgentDefinition` that the publication creates. The retrieved files hold the username of the sandbox you retrieved from, and a user record is data: it is not deployed, and the other orgs have no such user.

sfdx-hardis handles it in two steps, both recorded in the Pull Request or the project:

1. An `agent-running-user` [deployment action](salesforce-devops-work-on-user-story-deployment-actions.md#create-the-running-user-of-an-agentforce-agent), run before the deployment, creates the user when the org has none, with the Salesforce CLI command `sf org create agent-user`: profile **Einstein Agent User**, permission sets `AgentforceServiceAgentBase`, `AgentforceServiceAgentUser` and `EinsteinGPTPromptTemplateUser`, after checking that the org has the licenses. Its username is `<agent>.<unique id>@<org id>.ext`. The [cleaning](#automate-it-at-each-user-story) writes this action, in the `all` context: it runs in the deployment check too, so the check validates the agent with its real user.
2. The built-in replacement rule `builtin-agent-running-user`, on by default, finds this user by its username, writes it in the bundle while it is deployed and while it is published, and puts the files of git back after each of them. It never creates a user: when the org has none, it logs a warning that names the action to add.

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

While a rule of yours writes the user, the built-in rule steps aside, in every org.

With several agents, you can replace only the part after `@`, so one variable per org covers all of them: name the agent users of each org with one domain (for example `service.agent@acme.com.uat` and `sales.agent@acme.com.uat`, created with `sf org create agent-user --base-username`), and use this `find` with a variable such as `AGENT_USER_DOMAIN_UAT=acme.com.uat`:

```yaml
    find: '(?<=<botUser>[^<@]+@)[^<]+(?=</botUser>)|(?<=default_agent_user: "[^"@]+@)[^"]+(?=")'
    secret: AGENT_USER_DOMAIN
```

To keep the usernames in git instead, replace `secret` with `values`, one username per branch, as in [values per org](salesforce-devops-config-replacement-rules.md#values-per-org).

When the built-in rule is off and no rule of yours writes the user, sfdx-hardis warns at retrieve time, when the agent has a `botUser`.

When activation fails for this reason, the error of the action points to this section.

## 3. Publish and activate the agent

An `agent-publish` [deployment action](salesforce-devops-work-on-user-story-deployment-actions.md#publish-an-agentforce-agent) of the Pull Request runs after the deployment. It publishes the bundle of the agent in the target org with `sf agent publish authoring-bundle`, which creates a new version, then activates this version. The action is stored in the sources, so the Pull Request shows it and reviewers can change it.

- The replacement rules of the target org are applied to the bundle while it is published, as for the deployment: the running user of a service agent is the one of that org.
- The deployment check job deploys nothing and publishes nothing. It lists the publication in the Pull Request comment, with the other post-deployment actions.
- Each publication creates a new version, even when the Agent Script did not change. The action runs once by org (`runOnlyOnceByOrg: true`): a deployment job run again does not create another version.
- When Salesforce refuses the publication or the activation, the action fails, and so does the deployment job: the metadata is in the org, and the Pull Request comment shows the error of the action.

sfdx-hardis never adds actions or changes the package.xml during the deployment job: what the deployment needs is recorded before, in the sources.

### Automate it at each User Story

Add the cleaning `autoAddAgentsDeploymentActions` to `autoCleanTypes` in `config/.sfdx-hardis.yml`:

```yaml
autoCleanTypes:
  - autoAddAgentsDeploymentActions
```

Each time you save a User Story with [hardis:work:save](hardis/work/save.md), [hardis:project:clean:agents-deployment-actions](hardis/project/clean/agents-deployment-actions.md):

- writes, for each agent whose bundle changed in the User Story, an `agent-publish` action in the deployment actions of the Pull Request (`scripts/actions/.sfdx-hardis.<id>.yml`, or the draft file when the Pull Request does not exist yet).
- writes, for each of these agents that runs as a user, an `agent-running-user` action before the deployment: see [the running user of a service agent](#the-running-user-of-a-service-agent).

Run by hand without `--delta-from`, the cleaning only handles the changes not committed yet.

When several Pull Requests that change the same agent are deployed together, each one publishes the agent, and the last one wins: all of them publish the Agent Script of the deployed commit, so the last version holds every change.

To leave production for a manual publication, add `excludeTargetBranches` to the action, or delete it from the Pull Request.

Without the cleaning, add the action yourself:

```yaml
commandsPostDeploy:
  - id: 7d1f3c2a-5e4b-4c8a-9f61-2b3e4d5a6c7e
    label: Publish the service agent
    type: agent-publish
    parameters:
      agentName: My_Service_Agent
    context: process-deployment-only
    runOnlyOnceByOrg: true
```

## Good to know

- The version numbers of an agent differ from one org to the next: each org numbers the versions it publishes. A version committed in Agentforce Builder of another org than a developer sandbox is not in the project, and the next publication replaces it as the active version.
- The files of an agent version are generated by Salesforce, and the agent graph (`agentGraph/*_graph.json`) is base64 text despite its `.json` extension. The project no longer holds them, but the [MegaLinter configuration of sfdx-hardis](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/config/sfdx-hardis.mega-linter-config.yml) still leaves them out of the JSON linters (`JSON_FILTER_REGEX_EXCLUDE: (aiAgentDefinitionVersions/|aiAuthoringBundles/)`), for projects that committed some.

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
2. Run [hardis:org:retrieve:agent](hardis/org/retrieve/agent.md) for the agent, in your developer sandbox. It adds the bundle of the agent to `manifest/package.xml`, removes the `GenAiPlannerBundle`, `Bot` and `BotVersion` entries of the agent, and lists the old folders: `bots/<agent>` and `genAiPlannerBundles/<agent>_v<n>`.
3. Delete these folders and commit. Do not add them to `destructiveChanges.xml`: the agent still exists in the orgs.

Until every agent is moved, Salesforce refuses the deployment check and deployment jobs.

!!! warning
    The [monitoring backup](salesforce-monitoring-metadata-backup.md) raises the API version of its own repository to the version of the org. A pin to 67.0 does not hold in a monitoring repository.
