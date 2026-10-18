---
title: Replacement rules on a Salesforce CI/CD Project
description: With sfdx-hardis, change metadata files right before each deployment for the org they go to - per org values, secrets from CI/CD variables, and removal of XML elements an older API version refuses
---

<!-- markdownlint-disable MD013 MD033 -->

## Replacement rules

- [What are replacement rules?](#what-are-replacement-rules)
- [Rule types](#rule-types)
- [Values per org](#values-per-org)
- [Secrets](#secrets)
- [Where rules are stored](#where-rules-are-stored)
- [Fix a deployment without a commit: the issue](#fix-a-deployment-without-a-commit-the-issue)
- [Built-in rules](#built-in-rules)
- [Commands and VS Code panel](#commands-and-vs-code-panel)
- [Pull Request comments](#pull-request-comments)
- [Good to know](#good-to-know)

---

### What are replacement rules?

Some metadata must not be the same in every org: the endpoint of a Named Credential, the sender address of an email alert, the admin of an Experience Cloud site, a password. Other metadata comes from a sandbox already on the next Salesforce release and holds XML elements production does not know yet, so the deployment fails.

Replacement rules change the metadata files **right before each deployment, for the org the deployment goes to**, then put the files back. Git keeps one version of each file.

They apply to:

- [hardis:project:deploy:smart](hardis/project/deploy/smart.md): deployment checks of Pull Requests, deployments to major orgs, quick deploys.
- Scratch org creation and push, and org initialization of pool orgs.
- [Backpromote](salesforce-devops-backpromote.md) deployments to developer sandboxes.

Only the files that are deployed are changed (the components of the package.xml, so a delta deployment stays a delta deployment).

---

### Rule types

| Type         | What it does                                                                    | Example                                                  |
|--------------|---------------------------------------------------------------------------------|----------------------------------------------------------|
| `xml-value`  | Writes the value of the target org in an XML element, whatever git holds        | `NamedCredential/endpoint`                               |
| `xml-remove` | Removes an XML element before deploying                                         | `Layout/platformActionList`                              |
| `text`       | Finds and replaces a text or a regular expression, in any file (Apex, LWC, JSON) | `https://pay-[a-z]+\.example\.com` in `PaymentService.cls` |

`xmlPath` is a path of elements from the root, without namespace:

| Path                                              | Matches                                             |
|---------------------------------------------------|-----------------------------------------------------|
| `NamedCredential/endpoint`                        | The `endpoint` element under the root               |
| `//dayOfMonthToRun`                               | `dayOfMonthToRun` at any depth                      |
| `Flow/screens//fields/styleProperties`            | `styleProperties` of screen fields, at any depth    |
| `Workflow/alerts[fullName=Escalation_Alert]/senderAddress` | The sender of one email alert              |
| `Layout/excludeButtons[.=SmartFillEnrich]`        | The `excludeButtons` element holding this value     |

An `xml-value` rule never creates a missing element: it reports "not found". A `text` rule replaces every occurrence, and its replacement is literal (no `$1`), so a value containing `$` is safe.

---

### Values per org

```yaml
replacementRules:
  - id: payment-api-endpoint
    description: Payment provider URL of each environment
    type: xml-value
    files: "**/namedCredentials/Payment_API.namedCredential-meta.xml"
    xmlPath: NamedCredential/endpoint
    values:
      integration: https://pay-int.example.com
      uat: https://pay-uat.example.com
      preprod: https://pay-staging.example.com
      main: https://pay.example.com
      default: https://pay-sandbox.example.com
    required: true
```

- `value`: the same value for every org.
- `values`: one value per target branch. `default` applies to developer sandboxes, scratch orgs, and the branches without their own value. An org with no value and no default keeps the file of git.
- `includeTargetBranches` / `excludeTargetBranches`: limit the rule to some target branches, like [deployment actions](salesforce-devops-deployment-actions.md) (`dev-sandboxes` means any org that is not a major branch).
- `required: true`: warns in the Pull Request comment when the files of the rule are deployed but nothing matched.

The target branch is the target of the Pull Request in a deployment check, and the branch being deployed in a deployment job.

---

### Secrets

```yaml
  - id: payment-api-password
    type: xml-value
    files: "**/namedCredentials/Payment_API.namedCredential-meta.xml"
    xmlPath: NamedCredential/password
    secret: PAYMENT_API_PASSWORD
```

`secret` is the **name** of a CI/CD variable, never a value. When deploying to `uat`, sfdx-hardis reads `PAYMENT_API_PASSWORD_UAT` first, then `PAYMENT_API_PASSWORD`: the same convention as `SFDX_CLIENT_ID_<BRANCH>`.

Secret values never appear anywhere:

- They are registered with the masking of the CI (`::add-mask::` on GitHub Actions, `task.setsecret` on Azure Pipelines), and replaced by `***` in every log line, command output, Pull Request comment and notification of sfdx-hardis.
- On GitLab, Bitbucket and Jenkins, **declare the variable as masked (or secured)** in the CI settings, so the CI masks it too.
- `preview` and `list --json` only show variable names.

When a secret is missing, the rule is skipped, the file of git is deployed, and the Pull Request comment shows a warning with the variable names that were looked up.

On GitHub Actions, a workflow only sees the secrets it passes to its jobs: add your variables to the `env` of the deployment check and deployment workflows.

```yaml
      env:
        PAYMENT_API_PASSWORD_UAT: ${{ secrets.PAYMENT_API_PASSWORD_UAT }}
        PAYMENT_API_PASSWORD_MAIN: ${{ secrets.PAYMENT_API_PASSWORD_MAIN }}
```

`secretsProvider: ciVariables` (the default) is the only provider today. Vaults (HashiCorp Vault, Azure Key Vault, AWS Secrets Manager) will be other values of this property.

---

### Where rules are stored

Rules merge by `id`, each place changing the ones before it:

1. **Built-in rules** shipped with sfdx-hardis.
2. **Project**: `config/.sfdx-hardis.yml`.
3. **Branch**: `config/branches/.sfdx-hardis.<branch>.yml` of the target branch only.
4. **Issue**: the "sfdx-hardis Replacement Rules" issue of the git provider.

A rule with the same `id` in a later place changes only the fields it sets, and `values` are merged org by org. For example, this branch file changes the uat value of the project rule:

```yaml
replacementRules:
  - id: payment-api-endpoint
    values:
      uat: https://pay-uat2.example.com
```

and `enabled: false` turns a rule off.

---

### Fix a deployment without a commit: the issue

The issue holds rules in a YAML block of its body. Editing it changes the rules of the whole project at the next deployment job, without any commit or merge: useful to fix a Pull Request between major branches that fails because of a value.

- GitHub and GitLab: an issue. Azure DevOps: a work item. Bitbucket: a dedicated Pull Request that is never merged.
- Edit the YAML block in the web UI, from the VS Code panel, or with `sf hardis:project:replacement:update --layer issue`. On Azure DevOps, prefer the panel or the command: the rich text editor can damage YAML.
- Once the fix is in the repository, delete the rule from the issue.
- A quick deploy reuses the package of the deployment check: after changing the issue, run the check of an open Pull Request again.
- Anyone who can edit the issue can change what reaches production. Rules coming from the issue are marked in the job log and the Pull Request comment.

---

### Built-in rules

When the deployment API version of the target org is older than the sources (sources retrieved from a preview sandbox, production still on the previous release), some XML elements make the deployment fail with errors like `Element {http://soap.sforce.com/2006/04/metadata}dayOfMonthToRun invalid at this location`. Built-in rules remove them before deploying. Others remove elements Salesforce stopped accepting.

The deployment API version is the `org-api-version` sf config (or `SF_ORG_API_VERSION`) when set, otherwise the maximum API version of the target org.

| Id                                         | Element                                                         | Removed when API is | Default |
|--------------------------------------------|-----------------------------------------------------------------|---------------------|---------|
| builtin-flow-ends                          | Flow `ends`, and the connectors pointing to them                | below 68.0          | on      |
| builtin-flow-groups                        | Flow `groups`, element `group`                                  | below 68.0          | on      |
| builtin-flow-schedule-day-of-month         | Flow `start/schedule/dayOfMonthToRun`                           | below 66.0          | on      |
| builtin-flow-schedule-frequency-number     | Flow `start/schedule/frequencyNumber`                           | below 66.0          | on      |
| builtin-flow-screen-style-settings         | Flow `screens/styleSettings`                                    | below 66.0          | on      |
| builtin-flow-screen-field-style            | Flow screen fields `styleProperties`                            | below 64.0          | on      |
| builtin-flow-choice-icon                   | Flow `choices/choiceIcon`                                       | below 64.0          | on      |
| builtin-flow-metrics-data-cloud            | Flow `areMetricsLoggedToDataCloud`                              | below 63.0          | on      |
| builtin-flow-custom-properties             | Flow `customProperties`                                         | below 63.0          | on      |
| builtin-view-all-fields-false              | Profile / Permission Set `viewAllFields` set to false           | below 63.0          | on      |
| builtin-agent-accesses                     | Profile / Permission Set `agentAccesses`                        | below 63.0          | on      |
| builtin-email-routing-address-accesses     | Permission Set `emailRoutingAddressAccesses`                    | below 62.0          | on      |
| builtin-service-presence-status-accesses   | Profile / Permission Set `servicePresenceStatusAccesses`        | below 64.0          | on      |
| builtin-gen-computing-summary-def-accesses | Profile / Permission Set `genComputingSummaryDefAccesses`       | below 66.0          | on      |
| builtin-aura-static-res-pref               | LightningExperienceSettings `enableAuraSecStaticResCRUCPref`    | 68.0 or above       | on      |
| builtin-analytics-incremental-upsert       | AnalyticsSettings `incrementalUpsertEnabled`                    | 68.0 or above       | on      |
| builtin-help-menu-prefs                    | UserEngagementSettings `enableHelpMenuShow*`                    | 65.0 or above       | on      |
| builtin-enhanced-sites-pref                | SiteSettings `enableEnhancedSitesAndContentPlatform`            | 63.0 or above       | on      |
| builtin-voice-whatsapp-pref                | ServiceCloudVoiceSettings `enableDigitalVoiceWhatsapp`          | 65.0 or above       | on      |
| builtin-view-all-fields-true               | Profile / Permission Set `viewAllFields` set to true            | below 63.0          | off     |
| builtin-flow-schedule-days-of-week         | Flow `start/schedule/daysOfWeekToRun`                           | below 66.0          | off     |
| builtin-flow-get-records-limit             | Flow `recordLookups/limit`                                      | below 63.0          | off     |
| builtin-flow-upsert                        | Flow `recordCreates` upsert options                             | below 62.0          | off     |
| builtin-flow-create-matching-records       | Flow `recordCreates` matching record filters                    | below 61.0          | off     |
| builtin-flow-action-wait                   | Flow `actionCalls` wait options                                 | below 61.0          | off     |
| builtin-flow-action-timeout                | Flow `actionCalls/timeoutConnector`                             | below 62.0          | off     |
| builtin-flow-action-timeout-path-usage     | Flow `actionCalls/timeoutPathUsage`                             | below 66.0          | off     |
| builtin-flow-decision-attributes           | Flow decision and rule `attributes`                             | below 65.0          | off     |

Rules marked **off** remove elements that change what a component does (without `limit`, a Get Records element returns every record). When such an element is found, the Pull Request comment says the deployment will fail and which rule removes it. Turn one on, or any built-in rule off, with `enabled`:

```yaml
replacementRules:
  - id: builtin-flow-get-records-limit
    enabled: true
  - id: builtin-flow-ends
    enabled: false
```

---

### Commands and VS Code panel

Every action exists as a command, and every command runs without prompt with `--agent`:

| Command                                                              | Purpose                                                       |
|----------------------------------------------------------------------|---------------------------------------------------------------|
| [hardis:project:replacement:list](hardis/project/replacement/list.md)       | Rules of every place, effective rules of every org, built-in rules |
| [hardis:project:replacement:create](hardis/project/replacement/create.md)   | Add a rule to a place                                         |
| [hardis:project:replacement:update](hardis/project/replacement/update.md)   | Change a rule, or turn a rule on or off                       |
| [hardis:project:replacement:delete](hardis/project/replacement/delete.md)   | Remove a rule from a place                                    |
| [hardis:project:replacement:preview](hardis/project/replacement/preview.md) | What the rules would change for a target org, without writing |

```sh
sf hardis:project:replacement:preview --target-branch main --api-version 67.0
```

In VS Code, the **Replacement Rules** panel (DevOps Pipeline settings menu) shows the rules, a grid of values per org, the built-in rules and the preview. It runs these commands: the files it writes are the same as the ones written from the terminal.

---

### Pull Request comments

The deployment check and deployment comments have a **Replacement rules** section: the rules applied, where they come from, the number of files they changed, and the warnings (missing secret, required rule without match, invalid rule, unreadable issue, element that will make the deployment fail). It is open when there are warnings. Values are never shown.

---

### Good to know

- Files are changed in place during the deployment and always put back, also when the deployment fails or the job is interrupted. A run killed before restoring them (power loss) is repaired by the next run in the same folder.
- On a scratch org push, the restored files look changed to source tracking, so they are pushed again at the next push.
- `SFDX_HARDIS_SKIP_REPLACEMENT_RULES=true` skips every rule, built-in ones included. The Pull Request comment says so.
- Native `replacements` of `sfdx-project.json` keep working: sf CLI applies them when building the deployment.
