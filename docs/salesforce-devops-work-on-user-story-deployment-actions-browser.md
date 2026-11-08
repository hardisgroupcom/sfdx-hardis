---
title: "Apply a Setup setting in a browser - Salesforce deployment action"
description: "Apply a Setup setting the Metadata API cannot deploy with Browserforce, as a step of a Salesforce deployment."
---
<!-- markdownlint-disable MD013 -->

## Apply a Setup setting in a browser

One of the types of [deployment actions](salesforce-devops-work-on-user-story-deployment-actions.md), YAML `type: browser`. That page explains what all types share: when actions run, how to choose their target orgs, how they are tracked and how to recover a failed one.

Some Setup settings cannot be deployed with the Metadata API: the density of Lightning Experience, the company currency, the secret of an auth provider, the record types of a picklist value, and many more. A browser action applies one of them with [Browserforce](https://github.com/amtrack/sfdx-browserforce-plugin), which clicks through the Setup pages in a headless browser. It only changes what differs from the org, so running it again does nothing.

In VS Code, pick the setting in the list: its fields show as a form, with the example of Browserforce already filled in, and its warnings (a value that cannot be changed back, a feature that only exists in Salesforce Classic, what the org needs first). **Edit as JSON** shows the whole value, and **Check with Browserforce** validates it before saving.

During a deployment check, nothing is changed: Browserforce reads the org and the Pull Request comment shows what the deployment will change.

<details markdown="1"><summary>Technical: browser action (YAML)</summary>

| Custom parameter     | Required? | Description                                                                                       | Example                  |
|----------------------|:---------:|---------------------------------------------------------------------------------------------------|--------------------------|
| `parameters.setting` |    Yes    | Key of the Browserforce setting.                                                                  | `densitySettings`        |
| `parameters.config`  |    Yes    | Value of the setting: an object or a list, in the format Browserforce describes for that setting. | `{ density: "Compact" }` |

```yaml
commandsPostDeploy:
  - id: 2f0c4d1e-7a3b-4c5d-9e8f-0a1b2c3d4e5f
    label: Compact density for all users
    type: browser
    context: all
    parameters:
      setting: densitySettings
      config:
        density: Compact
```

List the settings and the format of each one with [hardis:project:action:types](hardis/project/action/types.md):

```sh
sf hardis:project:action:types --type browser
sf hardis:project:action:types --type browser --browser-setting authProviders --json
```

**Secrets and values that differ per org.** Write a value as `"${VARIABLE}"` and declare a CI/CD variable instead of writing the value in git. When deploying to `uat`, sfdx-hardis reads `VARIABLE_UAT` first, then `VARIABLE` (the same rule as `SFDX_CLIENT_ID_<BRANCH>`), and passes the value to Browserforce as an environment variable only. The values are masked in the job logs and in the Pull Request comments. A missing variable fails the action and lists the names that were looked up.

```yaml
    parameters:
      setting: authProviders
      config:
        PaymentProvider:
          consumerSecret: "${PAYMENT_PROVIDER_SECRET}"
```

On GitHub Actions, a workflow only passes to its jobs the secrets it lists: add the variables to the `env` of the deployment check and deployment workflows.

The action runs in both phases. Its default context is `all`: the check job shows the planned changes, the deployment job applies them. It runs once per org by default, like most types: set `runOnlyOnceByOrg: false` to apply the setting at each deployment, for a setting that a deployment can change back.

Browserforce (`sfdx-browserforce-plugin`) is installed when missing. It is in the sfdx-hardis Docker images, which also set its browser. On another machine, Browserforce uses `CHROME_BIN`, or the local Chrome sfdx-hardis finds; otherwise run `sf browserforce playwright -- install chromium`.

</details>
