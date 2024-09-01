---
title: Sfdx-hardis deployment assistant setup
description: Learn how to setup Salesforce deployment assistant
---
<!-- markdownlint-disable MD013 -->

# Setup Salesforce Deployment Assistant

## Using sfdx-hardis CI/CD

If you are using [sfdx-hardis CI/CD](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/), you are already all set !

Just make sure to have configured your [GitHub](salesforce-ci-cd-setup-integration-github.md), [Gitlab](salesforce-ci-cd-setup-integration-gitlab.md), [Azure Pipelines](salesforce-ci-cd-setup-integration-azure.md) or [BitBucket](salesforce-ci-cd-setup-integration-bitbucket.md) integration so the deployment assistant can post its help in Pull Request comments.

If you want to **supercharge Salesforce deployment assistant with AI**, process [sfdx-hardis AI setup](salesforce-ai-setup.md).

## Using custom CI/CD pipeline

Replace your calls to Salesforce CLI by calls to sfdx-hardis commands wrapper.

| sfdx command                                                                                                                                                                                | Corresponding sfdx-hardis wrapper command                                           |
|:--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:------------------------------------------------------------------------------------|
| [sf project deploy start](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_deploy_start_unified) | [sf hardis:project:deploy:start](https://sfdx-hardis.cloudity.com/hardis/project/deploy/start/)   |
| [sf project deploy validate](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_deploy_validate_unified) | [sf hardis:project:deploy:validate](https://sfdx-hardis.cloudity.com/hardis/project/deploy/validate/)   |
| [sf project deploy quick](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_project_commands_unified.htm#cli_reference_project_deploy_quick_unified) | [sf hardis:project:deploy:quick](https://sfdx-hardis.cloudity.com/hardis/project/deploy/quick/)   |
| [sfdx force:source:deploy](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_deploy) ([**removed on 6 november**](https://github.com/forcedotcom/cli/issues/2974))   | [sf hardis:source:deploy](https://sfdx-hardis.cloudity.com/hardis/source/deploy/) |
| [sfdx force:source:push](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_push) ([**removed on 6 november**](https://github.com/forcedotcom/cli/issues/2974))      | [sf hardis:source:push](https://sfdx-hardis.cloudity.com/hardis/source/push/)     |
| [sfdx force:mdapi:deploy](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_mdapi.htm#cli_reference_force_mdapi_beta_deploy) ([**removed on 6 november**](https://github.com/forcedotcom/cli/issues/2974))  | [sf hardis:mdapi:deploy](https://sfdx-hardis.cloudity.com/hardis/mdapi/deploy/)   |

Configure your [GitHub](salesforce-ci-cd-setup-integration-github.md), [Gitlab](salesforce-ci-cd-setup-integration-gitlab.md), [Azure Pipelines](salesforce-ci-cd-setup-integration-azure.md) or [BitBucket](salesforce-ci-cd-setup-integration-bitbucket.md) integration so the deployment assistant can post its help in Pull Request comments.

_Notes:_

- _sfdx-hardis deployment assistant currently do not support --json option. If you really need it please request it in sfdx-hardis GitHub issues !_
- _there is no sfdx-hardis wrapper command yet for `sf project deploy start`. If you really need it please request it in sfdx-hardis GitHub issues !_

### Example

Replace:

`sfdx force:source:deploy -x manifest/package.xml --checkonly`

by

`sf hardis:source:deploy -x manifest/package.xml --checkonly`