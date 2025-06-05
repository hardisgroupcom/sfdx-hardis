---
title: All Environment Variables
description: Comprehensive list of all environment variables used in sfdx-hardis
---
<!-- markdownlint-disable MD013 -->

## All Environment Variables

Here is a comprehensive list of all environment variables that can be used in sfdx-hardis source code.

This list has been generated with GitHub Copilot so if you see any incoherence please raise an issue :)

## Table of Contents

1. [Custom sfdx-hardis Variables](#custom-sfdx-hardis-variables)
   - [Salesforce Configuration](#salesforce-configuration)
   - [Deployment Control](#deployment-control)
   - [Monitoring & Debugging](#monitoring--debugging)
   - [System Configuration](#system-configuration)
2. [Tool-Specific Variables](#tool-specific-variables)
   - [Azure DevOps](#azure-devops)
   - [GitLab](#gitlab)
   - [GitHub](#github)
   - [Bitbucket](#bitbucket)
   - [JIRA Integration](#jira-integration)
   - [Slack Integration](#slack-integration)
   - [AI Provider (OpenAI)](#ai-provider-openai)
   - [Email Notifications](#email-notifications)
   - [Browser Automation](#browser-automation)
   - [Generic Ticketing](#generic-ticketing)
   - [Generic CI/CD](#generic-cicd)

---

## Custom sfdx-hardis Variables

These variables control specific behaviors and configurations within sfdx-hardis itself.

### Salesforce Configuration

| Variable Name | Description | Default Value | Usage Location |
|---|---|---|---|
| **CI_SCRATCH_MODE** | Mode for scratch org in CI (e.g., 'deploy') | `undefined` | [`src/common/utils/orgUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/orgUtils.ts) |
| **DEVHUB_ALIAS** | Alias for the Salesforce DevHub org | `undefined` | Multiple files in config, hooks, and auth |
| **INSTANCE_URL** | Salesforce instance URL for authentication | `undefined` | [`src/common/utils/authUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/authUtils.ts) |
| **NOT_IMPACTING_METADATA_TYPES** | Comma-separated list of metadata types that don't impact deployments | Predefined list | [`src/config/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/config/index.ts) |
| **ORG_ALIAS** | Alias for the target Salesforce org | `undefined` | Multiple files in hooks and auth |
| **SFDX_API_VERSION** | Salesforce API version to use | `'62.0'` | [`src/config/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/config/index.ts) |
| **SFDX_AUTH_URL_DEV_HUB** | Salesforce auth URL for DevHub | `undefined` | [`src/common/utils/authUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/authUtils.ts) |
| **SFDX_AUTH_URL_TECHNICAL_ORG** | Salesforce auth URL for technical org | `undefined` | [`src/commands/hardis/auth/login.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/commands/hardis/auth/login.ts) |
| **SFDX_CLIENT_ID** | Salesforce connected app client ID | `undefined` | [`src/common/utils/authUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/authUtils.ts) |
| **SFDX_CLIENT_KEY** | Salesforce connected app client key | `undefined` | [`src/common/utils/authUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/authUtils.ts) |
| **SFDX_ENV** | Salesforce CLI environment setting | Set to `'development'` when debug is enabled | [`src/hooks/init/log.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/hooks/init/log.ts) |
| **SFDX_XML_INDENT** | Indentation string for XML formatting | `'    '` (4 spaces) | [`src/common/utils/xmlUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/xmlUtils.ts) |
| **SKIP_TECHNICAL_ORG** | Skip technical org connection | `undefined` | [`src/common/utils/orgUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/orgUtils.ts) |
| **TARGET_USERNAME** | Target Salesforce username for operations | `undefined` | [`src/common/utils/authUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/authUtils.ts) |
| **TECHNICAL_ORG_ALIAS** | Alias for technical Salesforce org | `undefined` | [`src/commands/hardis/auth/login.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/commands/hardis/auth/login.ts) |

### Deployment Control

| Variable Name | Description | Default Value | Usage Location |
|---|---|---|---|
| **AUTO_UPDATE** | Enable automatic update of .gitignore and .forceignore files when not in CI | `undefined` | Found in changelog |
| **SFDX_DEPLOY_WAIT_MINUTES** | Minutes to wait for deployment completion | `120` | Multiple files in deployUtils and Azure config |
| **SFDX_DISABLE_FLOW_DIFF** | Disable Flow Visual Git Diff calculation in PR comments | `undefined` | [`src/common/utils/gitUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/gitUtils.ts) |
| **SFDX_HARDIS_DEPLOY_BEFORE_MERGE** | Deploy before merge in CI/CD | `undefined` | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts) |
| **SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES** | Ignore splitting of package.xml files during deployment | `'true'` | [`src/common/utils/deployUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/deployUtils.ts) |

### Monitoring & Debugging

| Variable Name | Description | Default Value | Usage Location |
|---|---|---|---|
| **DEBUG** | Enable debug logging output | `undefined` | [`src/common/websocketClient.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/websocketClient.ts) |
| **DEBUG_DEPLOY** | Enable debug logging for deployment operations | `undefined` | [`src/common/utils/orgUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/orgUtils.ts) |
| **MONITORING_BACKUP_SKIP_METADATA_TYPES** | Metadata types to skip during backup monitoring | `undefined` | Found in changelog and documentation |
| **SFDX_HARDIS_DEBUG_ENV** | Enable debug environment for sfdx-hardis | `undefined` | [`src/hooks/init/log.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/hooks/init/log.ts) |
| **SFDX_HARDIS_MONITORING** | Indicates if running a monitoring job | `undefined` | [`src/common/utils/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/index.ts) |

### System Configuration

| Variable Name | Description | Default Value | Usage Location |
|---|---|---|---|
| **CONFIG_BRANCH** | Override for configuration branch name | Current git branch | [`src/config/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/config/index.ts) |
| **FORCE_COLOR** | Control color output in terminal commands | `'0'` | [`src/common/utils/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/index.ts) |
| **GIT_FETCH_EXTRA_FLAGS** | Extra flags for git fetch operations | `undefined` | Found in documentation |
| **MERMAID_MODES** | Modes for Mermaid diagram generation | `undefined` | Found in Dockerfile |
| **NODE_OPTIONS** | Node.js runtime options | Cleared if contains `--inspect-brk` | [`src/common/utils/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/index.ts) |
| **PROJECT_NAME** | Name of the sfdx-hardis project | `undefined` | [`src/config/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/config/index.ts) |
| **SFDX_HARDIS_WEBSOCKET_PORT** | Port for sfdx-hardis WebSocket server | `2702` | [`src/common/websocketClient.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/websocketClient.ts) |

---

## Tool-Specific Variables

These variables integrate sfdx-hardis with external tools and platforms.

### Azure DevOps

| Variable Name | Description | Default Value | Usage Location |
|---|---|---|---|
| **BUILD_BUILD_ID** | Azure build ID for CI/CD pipeline identification | `undefined` | [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts) |
| **BUILD_REPOSITORY_ID** | Azure repository ID for accessing repository information | `undefined` | [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts), [`src/common/ticketProvider/azureBoardsProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/azureBoardsProvider.ts) |
| **BUILD_REPOSITORYNAME** | Azure repository name for building URLs and references | `undefined` | [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts) |
| **BUILD_SOURCEBRANCHNAME** | Azure source branch name for the current build | `undefined` | [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts) |
| **CI_SFDX_HARDIS_AZURE_TOKEN** | Custom Azure DevOps token for sfdx-hardis integration | `SYSTEM_ACCESSTOKEN` | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts), [`src/common/ticketProvider/azureBoardsProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/azureBoardsProvider.ts) |
| **SYSTEM_ACCESSTOKEN** | Azure DevOps system access token | `undefined` | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts), [`src/common/ticketProvider/azureBoardsProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/azureBoardsProvider.ts) |
| **SYSTEM_COLLECTIONURI** | Azure DevOps collection URI | `undefined` | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts), [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts), [`src/common/ticketProvider/azureBoardsProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/azureBoardsProvider.ts) |
| **SYSTEM_JOB_DISPLAY_NAME** | Azure DevOps job display name | `undefined` | [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts) |
| **SYSTEM_JOB_ID** | Azure DevOps job ID | `undefined` | [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts) |
| **SYSTEM_PULLREQUEST_PULLREQUESTID** | Azure DevOps pull request ID | `undefined` | [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts) |
| **SYSTEM_TEAMPROJECT** | Azure DevOps team project name | `undefined` | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts), [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts), [`src/common/ticketProvider/azureBoardsProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/azureBoardsProvider.ts) |

### GitLab

| Variable Name | Description | Default Value | Usage Location |
|---|---|---|---|
| **CI_JOB_TOKEN** | GitLab CI job token for API authentication | `undefined` | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts) |
| **CI_PROJECT_ID** | GitLab project ID | `undefined` | [`src/common/gitProvider/gitlab.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/gitlab.ts) |
| **CI_PROJECT_URL** | GitLab project URL for building branch URLs | `undefined` | [`src/common/gitProvider/gitlab.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/gitlab.ts) |
| **CI_SFDX_HARDIS_GITLAB_TOKEN** | Custom GitLab token for sfdx-hardis integration | `ACCESS_TOKEN` | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts) |

### GitHub

| Variable Name | Description | Default Value | Usage Location |
|---|---|---|---|
| **GITHUB_TOKEN** | GitHub token for API authentication | `undefined` | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts) |

### Bitbucket

| Variable Name | Description | Default Value | Usage Location |
|---|---|---|---|
| **BITBUCKET_WORKSPACE** | Bitbucket workspace identifier for Bitbucket provider detection | `undefined` | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts) |
| **CI_SFDX_HARDIS_BITBUCKET_TOKEN** | Custom Bitbucket token for sfdx-hardis integration | `undefined` | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts) |

### JIRA Integration

| Variable Name | Description | Default Value | Usage Location |
|---|---|---|---|
| **JIRA_EMAIL** | JIRA user email for authentication | `undefined` | [`src/common/ticketProvider/jiraProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/jiraProvider.ts) |
| **JIRA_HOST** | JIRA server hostname | `"https://define.JIRA_HOST.in.cicd.variables/"` | [`src/common/ticketProvider/jiraProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/jiraProvider.ts) |
| **JIRA_PAT** | JIRA Personal Access Token for authentication | `undefined` | [`src/common/ticketProvider/jiraProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/jiraProvider.ts) |
| **JIRA_TICKET_REGEX** | Regular expression for JIRA ticket references | `"(?<=[^a-zA-Z0-9_-]|^)([A-Za-z0-9]{2,10}-\\d{1,6})(?=[^a-zA-Z0-9_-]|$)"` | [`src/common/ticketProvider/jiraProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/jiraProvider.ts) |
| **JIRA_TOKEN** | JIRA API token for authentication | `undefined` | [`src/common/ticketProvider/jiraProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/jiraProvider.ts) |

### Slack Integration

| Variable Name | Description | Default Value | Usage Location |
|---|---|---|---|
| **SLACK_CHANNEL_ID** | Slack channel ID for notifications | `undefined` | [`src/common/notifProvider/slackProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/slackProvider.ts) |
| **SLACK_CHANNEL_ID_ERRORS_WARNINGS** | Slack channel ID for error and warning notifications | `undefined` | [`src/common/notifProvider/slackProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/slackProvider.ts) |
| **SLACK_CHANNEL_ID_{BRANCH}** | Branch-specific Slack channel ID | `undefined` | [`src/common/notifProvider/slackProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/slackProvider.ts) |
| **SLACK_TOKEN** | Slack API token for notifications | `undefined` | [`src/common/notifProvider/slackProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/slackProvider.ts), [`src/common/notifProvider/utils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/utils.ts) |

### AI Provider (OpenAI)

| Variable Name | Description | Default Value | Usage Location |
|---|---|---|---|
| **AI_MAX_TIMEOUT_MINUTES** | Maximum timeout in minutes for AI operations | `30` (in CI), `0` (local) | [`src/common/aiProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/aiProvider/index.ts) |
| **OPENAI_API_KEY** | OpenAI API key for AI operations | `undefined` | [`src/common/aiProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/aiProvider/index.ts) |

### Email Notifications

| Variable Name | Description | Default Value | Usage Location |
|---|---|---|---|
| **MS_TEAMS_WEBHOOK_URL** | Microsoft Teams webhook URL for notifications (deprecated) | `undefined` | [`src/common/notifProvider/utils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/utils.ts) |
| **NOTIF_EMAIL_ADDRESS** | Email address for notifications | `undefined` | [`src/common/notifProvider/emailProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/emailProvider.ts), [`src/common/notifProvider/utils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/utils.ts) |
| **NOTIF_EMAIL_ADDRESS_{BRANCH}** | Branch-specific email address for notifications | `undefined` | [`src/common/notifProvider/emailProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/emailProvider.ts) |

### Browser Automation

| Variable Name | Description | Default Value | Usage Location |
|---|---|---|---|
| **CHROMIUM_PATH** | Path to Chromium executable for Puppeteer | `undefined` | Found in deployment documentation |
| **PUPPETEER_EXECUTABLE_PATH** | Path to Chrome/Chromium executable for Puppeteer | Auto-detected | [`src/common/utils/orgConfigUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/orgConfigUtils.ts) |

### Generic Ticketing

| Variable Name | Description | Default Value | Usage Location |
|---|---|---|---|
| **GENERIC_TICKETING_PROVIDER_REGEX** | Regular expression for generic ticketing provider ticket references | `undefined` | [`src/common/ticketProvider/genericProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/genericProvider.ts) |
| **GENERIC_TICKETING_PROVIDER_URL_BUILDER** | URL template for generic ticketing provider | `undefined` | [`src/common/ticketProvider/genericProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/genericProvider.ts) |

### Generic CI/CD

| Variable Name | Description | Default Value | Usage Location |
|---|---|---|---|
| **CI** | Indicates if running in a Continuous Integration environment | `undefined` | [`src/common/utils/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/index.ts) |
| **CI_COMMIT_REF_NAME** | Current git branch name in CI environment | Current git branch | [`src/common/utils/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/index.ts), [`src/common/utils/filesUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/filesUtils.ts), [`src/common/gitProvider/gitlab.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/gitlab.ts), [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts) |

---

## Summary

This documentation covers **64 environment variables** used throughout sfdx-hardis:

- **Custom sfdx-hardis Variables**: 26 variables controlling native behavior
- **Tool-Specific Variables**: 38 variables for external integrations

The variables are organized by functionality to help developers and administrators understand their purpose and configure them appropriately for their environments.
