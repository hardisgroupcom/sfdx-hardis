## Deployment actions (beta)

> This feature is currently in beta, but you can start using it right away.

### What are deployment actions ?

Salesforce Deployments are mainly Metadata, but can also be other actions that will be performed before or after Metadata deployment:

- [Run Apex scripts](#run-apex-script)
- [Upsert records (Import SFDMU project)](#import-sfdmu-project)
- [Run command lines](#run-command)
- [Publish Experience Cloud sites](#publish-experience-site)
- [Manual actions that cannot be automated](#manual-step)

You can define them at two levels:

- **Pull Request level**: these actions will be run during the deployment of a feature pull request, but also during deployment of Pull Requests between major branches (ex: `preprod` to `main`)
- **Project level**: The deployment actions will be performed during each deployment

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

| Field              | Type    | Required? | Description                                                                                                                     |
|--------------------|---------|:---------:|---------------------------------------------------------------------------------------------------------------------------------|
| `id`               | string  |    Yes    | Unique identifier for the action.                                                                                               |
| `label`            | string  |    Yes    | Human-readable description of the action.                                                                                       |
| `type`             | string  |    Yes    | One of `command`, `data`, `apex`, `publish-community`, `manual`.                                                                |
| `context`          | string  |    Yes    | When the action should run. Allowed values: `all` (default), `check-deployment-only`, `process-deployment-only`.                |
| `command`          | string  |    No     | Shell command to run (used by `command` type).                                                                                  |
| `parameters`       | object  |    No     | Parameters of the action (see action details)                                                                                   |
| `customUsername`   | string  |    No     | Run the action with a specific username instead of the default target org.                                                      |
| `skipIfError`      | boolean |    No     | If true and the deployment itself failed, the action will be skipped.                                                           |
| `allowFailure`     | boolean |    No     | If true and the action fails, the deployment continues but the result is marked failed/allowed.                                 |
| `runOnlyOnceByOrg` | boolean |    No     | If true the action is recorded in the org (`SfdxHardisTrace__c` object required) and will not re-run on subsequent deployments. |

### Action implementations

| Action type                                     | Purpose                                                          |
|-------------------------------------------------|------------------------------------------------------------------|
| [`command`](#run-command)                       | Run an arbitrary shell or `sf` command.                          |
| [`data`](#import-sfdmu-project)                 | Import a SFDMU project.                                          |
| [`apex`](#run-apex-script)                      | Run an Apex script file through the local `sf apex` integration. |
| [`publish-community`](#publish-experience-site) | Publish an Experience Cloud (community) site.                    |
| [`manual`](#manual-step)                        | Represent a manual step (no CLI execution).                      |

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

#### Manual step

Marks a manual step that cannot be automated. The PR result will show the instructions and an unchecked box for reviewers/operators to complete.

| Custom parameter          | Description                                                                                                  | Example |
|---------------------------|--------------------------------------------------------------------------------------------------------------|---------|
| `parameters.instructions` | Human-readable instructions or checklist for the operator/reviewer. Use a YAML block to preserve formatting. |         |

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


