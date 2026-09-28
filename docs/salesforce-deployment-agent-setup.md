---
title: Setup Deployment Agent
description: With sfdx-hardis, learn how to set up Salesforce Deployment Agent
---

<!-- markdownlint-disable MD013 -->

# Setup Deployment Agent

## Configure integrations

Make sure to have configured your [GitHub](salesforce-devops-setup-integration-github.md), [GitLab](salesforce-devops-setup-integration-gitlab.md), [Azure Pipelines](salesforce-devops-setup-integration-azure.md) or [Bitbucket](salesforce-devops-setup-integration-bitbucket.md) integration so Deployment Agent can post its help in Pull Request comments.

If you want to add AI to Deployment Agent, follow [sfdx-hardis AI setup](salesforce-ai-setup.md).

You can also receive [Slack](salesforce-devops-setup-integration-slack.md), [Microsoft Teams](salesforce-devops-setup-integration-ms-teams.md) and [Email](salesforce-devops-setup-integration-email.md) notifications in case of successful deployment.

If you configure [Jira](salesforce-devops-setup-integration-jira.md) or [Generic Ticketing](salesforce-devops-setup-integration-generic-ticketing.md) integrations, ticket numbers will be extracted and displayed in the Pull Request comment.

If you want to **automatically fix deployment errors using coding agents** (Claude, Codex, Gemini, Copilot), see [Coding Agent Auto-Fix setup](salesforce-deployment-agent-autofix.md).

## Using sfdx-hardis CI/CD

If you are using [sfdx-hardis CI/CD](https://sfdx-hardis.cloudity.com/salesforce-devops-home/), you are already all set.

## Using custom CI/CD pipeline

Replace your calls to Salesforce CLI commands with calls to the sfdx-hardis wrapper commands.

| sfdx command                                                                                                                                                                                                                                                                   | Corresponding sfdx-hardis wrapper command                                                             |
|:-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:------------------------------------------------------------------------------------------------------|
| [sf project deploy start](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_deploy_start_unified)                                                                  | [sf hardis:project:deploy:start](https://sfdx-hardis.cloudity.com/hardis/project/deploy/start/)       |
| [sf project deploy validate](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_deploy_validate_unified)                                                            | [sf hardis:project:deploy:validate](https://sfdx-hardis.cloudity.com/hardis/project/deploy/validate/) |
| [sf project deploy quick](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_deploy_quick_unified)                                                                  | [sf hardis:project:deploy:quick](https://sfdx-hardis.cloudity.com/hardis/project/deploy/quick/)       |
| [sfdx force:source:deploy](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_deploy) ([**removed on 6 November 2023**](https://github.com/forcedotcom/cli/issues/2974))   | [sf hardis:source:deploy](https://sfdx-hardis.cloudity.com/hardis/source/deploy/)                     |
| [sfdx force:source:push](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_push) ([**removed on 6 November 2023**](https://github.com/forcedotcom/cli/issues/2974))       | [sf hardis:source:push](https://sfdx-hardis.cloudity.com/hardis/source/push/)                         |
| [sfdx force:mdapi:deploy](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_mdapi.htm#cli_reference_force_mdapi_beta_deploy) ([**removed on 6 November 2023**](https://github.com/forcedotcom/cli/issues/2974)) | [sf hardis:mdapi:deploy](https://sfdx-hardis.cloudity.com/hardis/mdapi/deploy/)                       |

Configure your [GitHub](salesforce-devops-setup-integration-github.md), [GitLab](salesforce-devops-setup-integration-gitlab.md), [Azure Pipelines](salesforce-devops-setup-integration-azure.md) or [Bitbucket](salesforce-devops-setup-integration-bitbucket.md) integration so Deployment Agent can post its help in Pull Request comments.

_Notes:_

- _sfdx-hardis Deployment Agent works better with the **--json** option, please use it._

### Example

Replace:

`sf project:deploy:start -x manifest/package.xml --checkonly`

with:

`sf hardis:project:deploy:start -x manifest/package.xml --checkonly`

### Advanced example

Replace:

`sf project deploy start --dry-run --source-dir force-app --ignore-warnings --ignore-conflicts --test-level RunLocalTests --coverage-formatters json-summary --verbose --wait 120 --json`

with:

`sf hardis:project:deploy:start --dry-run --source-dir force-app --ignore-warnings --ignore-conflicts --test-level RunLocalTests --coverage-formatters json-summary --verbose --wait 120 --json`

## Not updating custom CI/CD pipeline

You don't want to update your calls to `sf project deploy start`?

That's fine: you won't benefit from the error management, but you can still benefit from the Flow Visual Git Diff and the other integrations.

Just add the [Notify command](hardis/project/deploy/notify.md) to your custom CI/CD pipeline.
