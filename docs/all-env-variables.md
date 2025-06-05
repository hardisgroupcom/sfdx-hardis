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

| Variable Name | Description | Default Value | Possible Values | Usage Location |
|---|---|---|---|---|
| **CI_SCRATCH_MODE** | Mode for scratch org in CI (e.g., 'deploy') | `undefined` | `'deploy'`, any string (e.g., `'test'`, `'dev'`) | [`src/common/utils/orgUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/orgUtils.ts) |
| **DEVHUB_ALIAS** | Alias for the Salesforce DevHub org | `undefined` | Any valid org alias (e.g., `'MyDevHub'`, `'production-devhub'`) | Multiple files in config, hooks, and auth |
| **INSTANCE_URL** | Salesforce instance URL for authentication | `undefined` | Valid Salesforce instance URLs (e.g., `'https://mycompany.my.salesforce.com'`, `'https://test.salesforce.com'`) | [`src/common/utils/authUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/authUtils.ts) |
| **NOT_IMPACTING_METADATA_TYPES** | Comma-separated list of metadata types that don't impact deployments | Predefined list | Comma-separated metadata type names (e.g., `'Document,StaticResource,Report'`) | [`src/config/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/config/index.ts) |
| **ORG_ALIAS** | Alias for the target Salesforce org | `undefined` | Any valid org alias (e.g., `'staging'`, `'production'`, `'sandbox1'`) | Multiple files in hooks and auth |
| **SFDX_API_VERSION** | Salesforce API version to use | `'62.0'` | Valid Salesforce API versions (e.g., `'62.0'`) | [`src/config/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/config/index.ts) |
| **SFDX_AUTH_URL_DEV_HUB** | Salesforce auth URL for DevHub | `undefined` | Valid Salesforce auth URLs (e.g., `'force://PlatformCLI::5Aep8614XXXXXXXXXXXX...'`) | [`src/common/utils/authUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/authUtils.ts) |
| **SFDX_AUTH_URL_TECHNICAL_ORG** | Salesforce auth URL for technical org | `undefined` | Valid Salesforce auth URLs (e.g., `'force://PlatformCLI::5Aep8614XXXXXXXXXXXX...'`) | [`src/commands/hardis/auth/login.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/commands/hardis/auth/login.ts) |
| **SFDX_CLIENT_ID** | Salesforce connected app client ID | `undefined` | Valid connected app client IDs (e.g., `'3MVG9CEn_O3jvv0XXXXXXXXXXXX...'`) | [`src/common/utils/authUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/authUtils.ts) |
| **SFDX_CLIENT_KEY** | Salesforce connected app client key | `undefined` | Valid connected app client keys (e.g., `'/path/to/server.key'`, certificate content) | [`src/common/utils/authUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/authUtils.ts) |
| **SFDX_ENV** | Salesforce CLI environment setting | Set to `'development'` when debug is enabled | `'development'`, `'production'` | [`src/hooks/init/log.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/hooks/init/log.ts) |
| **SFDX_XML_INDENT** | Indentation string for XML formatting | `'    '` (4 spaces) | Any string (e.g., `'    '` for 4 spaces, `'\t'` for tabs, `'  '` for 2 spaces) | [`src/common/utils/xmlUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/xmlUtils.ts) |
| **SKIP_TECHNICAL_ORG** | Skip technical org connection | `undefined` | `'true'`, `'false'` | [`src/common/utils/orgUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/orgUtils.ts) |
| **TARGET_USERNAME** | Target Salesforce username for operations | `undefined` | Valid Salesforce usernames (e.g., `'admin@mycompany.com'`, `'test-user@example.com.sandbox'`) | [`src/common/utils/authUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/authUtils.ts) |
| **TECHNICAL_ORG_ALIAS** | Alias for technical Salesforce org | `undefined` | Any valid org alias (e.g., `'technical-org'`, `'monitoring-org'`) | [`src/commands/hardis/auth/login.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/commands/hardis/auth/login.ts) |

### Deployment Control

| Variable Name | Description | Default Value | Possible Values | Usage Location |
|---|---|---|---|---|
| **AUTO_UPDATE** | Enable automatic update of .gitignore and .forceignore files when not in CI | `undefined` | `'true'`, `'false'` | Found in changelog |
| **SFDX_DEPLOY_WAIT_MINUTES** | Minutes to wait for deployment completion | `120` | Positive integers (e.g., `'120'`, `'60'`) | Multiple files in deployUtils and Azure config |
| **SFDX_DISABLE_FLOW_DIFF** | Disable Flow Visual Git Diff calculation in PR comments | `undefined` | `'true'`, `'false'` | [`src/common/utils/gitUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/gitUtils.ts) |
| **SFDX_HARDIS_DEPLOY_BEFORE_MERGE** | Deploy before merge in CI/CD | `undefined` | `'true'`, `'false'` | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts) |
| **SFDX_HARDIS_DEPLOY_IGNORE_SPLIT_PACKAGES** | Ignore splitting of package.xml files during deployment | `'true'` | `'true'`, `'false'` | [`src/common/utils/deployUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/deployUtils.ts) |

### Monitoring & Debugging

| Variable Name | Description | Default Value | Possible Values | Usage Location |
|---|---|---|---|---|
| **DEBUG** | Enable debug logging output | `undefined` | `'true'`, `'false'` | [`src/common/websocketClient.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/websocketClient.ts) |
| **DEBUG_DEPLOY** | Enable debug logging for deployment operations | `undefined` | `'true'`, `'false'` | [`src/common/utils/orgUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/orgUtils.ts) |
| **MONITORING_BACKUP_SKIP_METADATA_TYPES** | Metadata types to skip during backup monitoring | `undefined` | Comma-separated metadata type names (e.g., `'Document,Report,Dashboard'`) | Found in changelog and documentation |
| **SFDX_HARDIS_DEBUG_ENV** | Enable debug environment for sfdx-hardis | `undefined` | `'true'`, `'false'` | [`src/hooks/init/log.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/hooks/init/log.ts) |
| **SFDX_HARDIS_MONITORING** | Indicates if running a monitoring job | `undefined` | `'true'`, `'false'` | [`src/common/utils/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/index.ts) |

### System Configuration

| Variable Name | Description | Default Value | Possible Values | Usage Location |
|---|---|---|---|---|
| **CONFIG_BRANCH** | Override for configuration branch name | Current git branch | Any valid git branch name (e.g., `'main'`, `'develop'`, `'config-override'`) | [`src/config/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/config/index.ts) |
| **FORCE_COLOR** | Control color output in terminal commands | `'0'` | `'0'`, `'1'`, `'2'`, `'3'` | [`src/common/utils/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/index.ts) |
| **GIT_FETCH_EXTRA_FLAGS** | Extra flags for git fetch operations | `undefined` | Valid git fetch flags (e.g., `'--depth=1'`, `'--quiet'`, `'--prune'`) | Found in documentation |
| **MERMAID_MODES** | Modes for Mermaid diagram generation | `undefined` | Mermaid mode values (e.g., `'dark'`, `'light'`, `'forest'`) | Found in Dockerfile |
| **NODE_OPTIONS** | Node.js runtime options | Cleared if contains `--inspect-brk` | Valid Node.js options (e.g., `'--max-old-space-size=4096'`, `'--experimental-modules'`) | [`src/common/utils/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/index.ts) |
| **PROJECT_NAME** | Name of the sfdx-hardis project | `undefined` | Any project name string (e.g., `'My Salesforce Project'`, `'CRM-Development'`) | [`src/config/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/config/index.ts) |
| **SFDX_HARDIS_WEBSOCKET_PORT** | Port for sfdx-hardis WebSocket server | `2702` | Valid port numbers (e.g., `2702`) | [`src/common/websocketClient.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/websocketClient.ts) |

---

## Tool-Specific Variables

These variables integrate sfdx-hardis with external tools and platforms.

### Azure DevOps

| Variable Name | Description | Default Value | Possible Values | Usage Location |
|---|---|---|---|---|
| **BUILD_BUILD_ID** | Azure build ID for CI/CD pipeline identification | `undefined` | Numeric build IDs (e.g., `'12345'`, `'987654'`) | [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts) |
| **BUILD_REPOSITORY_ID** | Azure repository ID for accessing repository information | `undefined` | Valid Azure repository GUIDs (e.g., `'550e8400-e29b-41d4-a716-446655440000'`) | [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts), [`src/common/ticketProvider/azureBoardsProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/azureBoardsProvider.ts) |
| **BUILD_REPOSITORYNAME** | Azure repository name for building URLs and references | `undefined` | Valid Azure repository names (e.g., `'my-salesforce-project'`, `'CRM-Repository'`) | [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts) |
| **BUILD_SOURCEBRANCHNAME** | Azure source branch name for the current build | `undefined` | Valid git branch names (e.g., `'main'`, `'feature/new-component'`, `'develop'`) | [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts) |
| **CI_SFDX_HARDIS_AZURE_TOKEN** | Custom Azure DevOps token for sfdx-hardis integration | `SYSTEM_ACCESSTOKEN` | Valid Azure DevOps personal access tokens (e.g., `'eyJ0eXAiOiJKV1QiLCJhbGciOiXXXXXXXXXXXX...'`) | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts), [`src/common/ticketProvider/azureBoardsProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/azureBoardsProvider.ts) |
| **SYSTEM_ACCESSTOKEN** | Azure DevOps system access token | `undefined` | Valid Azure DevOps access tokens (e.g., `'eyJ0eXAiOiJKV1QiLCJhbGciOiXXXXXXXXXXXX...'`) | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts), [`src/common/ticketProvider/azureBoardsProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/azureBoardsProvider.ts) |
| **SYSTEM_COLLECTIONURI** | Azure DevOps collection URI | `undefined` | Valid Azure DevOps collection URIs (e.g., `'https://dev.azure.com/myorganization/'`) | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts), [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts), [`src/common/ticketProvider/azureBoardsProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/azureBoardsProvider.ts) |
| **SYSTEM_JOB_DISPLAY_NAME** | Azure DevOps job display name | `undefined` | Valid job display names (e.g., `'Build and Test'`, `'Deploy to Staging'`) | [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts) |
| **SYSTEM_JOB_ID** | Azure DevOps job ID | `undefined` | Valid Azure job IDs (e.g., `'550e8400-e29b-41d4-a716-446655440000'`) | [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts) |
| **SYSTEM_PULLREQUEST_PULLREQUESTID** | Azure DevOps pull request ID | `undefined` | Valid pull request IDs (e.g., `'123'`, `'456'`) | [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts) |
| **SYSTEM_TEAMPROJECT** | Azure DevOps team project name | `undefined` | Valid Azure DevOps project names (e.g., `'MyProject'`, `'Salesforce-Development'`) | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts), [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts), [`src/common/ticketProvider/azureBoardsProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/azureBoardsProvider.ts) |

### GitLab

| Variable Name | Description | Default Value | Possible Values | Usage Location |
|---|---|---|---|---|
| **CI_JOB_TOKEN** | GitLab CI job token for API authentication | `undefined` | Valid GitLab job tokens (e.g., `'glcbt-64chars_token_XXXXXXXXXXXXXXXXXXXX'`) | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts) |
| **CI_PROJECT_ID** | GitLab project ID | `undefined` | Valid GitLab project IDs (e.g., `'123456'`, `'42'`) | [`src/common/gitProvider/gitlab.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/gitlab.ts) |
| **CI_PROJECT_URL** | GitLab project URL for building branch URLs | `undefined` | Valid GitLab project URLs (e.g., `'https://gitlab.com/myuser/myproject'`) | [`src/common/gitProvider/gitlab.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/gitlab.ts) |
| **CI_SFDX_HARDIS_GITLAB_TOKEN** | Custom GitLab token for sfdx-hardis integration | `ACCESS_TOKEN` | Valid GitLab access tokens (e.g., `'glpat-XXXXXXXXXXXXXXXXXXXX'`) | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts) |

### GitHub

| Variable Name | Description | Default Value | Possible Values | Usage Location |
|---|---|---|---|---|
| **GITHUB_TOKEN** | GitHub token for API authentication | `undefined` | Valid GitHub personal access tokens (e.g., `'ghp_XXXXXXXXXXXXXXXXXXXX'`, `'github_pat_XXXXXXXXXXXX'`) | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts) |

### Bitbucket

| Variable Name | Description | Default Value | Possible Values | Usage Location |
|---|---|---|---|---|
| **BITBUCKET_WORKSPACE** | Bitbucket workspace identifier for Bitbucket provider detection | `undefined` | Valid Bitbucket workspace names (e.g., `'mycompany'`, `'my-team-workspace'`) | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts) |
| **CI_SFDX_HARDIS_BITBUCKET_TOKEN** | Custom Bitbucket token for sfdx-hardis integration | `undefined` | Valid Bitbucket app passwords or tokens (e.g., `'ATBBXXXXXXXXXXXXXXXXXXXX'`) | [`src/common/gitProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/index.ts) |

### JIRA Integration

| Variable Name | Description | Default Value | Possible Values | Usage Location |
|---|---|---|---|---|
| **JIRA_EMAIL** | JIRA user email for authentication | `undefined` | Valid email addresses (e.g., `'admin@mycompany.com'`, `'jira-user@example.org'`) | [`src/common/ticketProvider/jiraProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/jiraProvider.ts) |
| **JIRA_HOST** | JIRA server hostname | `"https://define.JIRA_HOST.in.cicd.variables/"` | Valid JIRA server URLs (e.g., `'https://mycompany.atlassian.net'`, `'https://jira.mycompany.com'`) | [`src/common/ticketProvider/jiraProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/jiraProvider.ts) |
| **JIRA_PAT** | JIRA Personal Access Token for authentication | `undefined` | Valid JIRA personal access tokens (e.g., `'ATATTXXXXXXXXXXXXXXXXXXXX'`) | [`src/common/ticketProvider/jiraProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/jiraProvider.ts) |
| **JIRA_TICKET_REGEX** | Regular expression for JIRA ticket references | `"(?<=[^a-zA-Z0-9_-]|^)([A-Za-z0-9]{2,10}-\\d{1,6})(?=[^a-zA-Z0-9_-]|$)"` | Valid regular expressions (e.g., `'PROJ-\\d+'`, `'[A-Z]+-\\d{1,4}'`) | [`src/common/ticketProvider/jiraProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/jiraProvider.ts) |
| **JIRA_TOKEN** | JIRA API token for authentication | `undefined` | Valid JIRA API tokens (e.g., `'ATATT3xFfGF0T4JVXXXXXXXXXXXXXXXXXXXX'`) | [`src/common/ticketProvider/jiraProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/jiraProvider.ts) |

### Slack Integration

| Variable Name | Description | Default Value | Possible Values | Usage Location |
|---|---|---|---|---|
| **SLACK_CHANNEL_ID** | Slack channel ID for notifications | `undefined` | Valid Slack channel IDs (e.g., `'C1234567890'`, `'C0123456789'`) | [`src/common/notifProvider/slackProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/slackProvider.ts) |
| **SLACK_CHANNEL_ID_ERRORS_WARNINGS** | Slack channel ID for error and warning notifications | `undefined` | Valid Slack channel IDs (e.g., `'C1234567890'`, `'C9876543210'`) | [`src/common/notifProvider/slackProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/slackProvider.ts) |
| **SLACK_CHANNEL_ID_{BRANCH}** | Branch-specific Slack channel ID | `undefined` | Valid Slack channel IDs (e.g., `'C1234567890'` for main branch) | [`src/common/notifProvider/slackProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/slackProvider.ts) |
| **SLACK_TOKEN** | Slack API token for notifications | `undefined` | Valid Slack bot tokens (e.g., `'xoxb-1234567890123-1234567890123-XXXXXXXXXXXXXXXXXXXXXXXX'`) | [`src/common/notifProvider/slackProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/slackProvider.ts), [`src/common/notifProvider/utils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/utils.ts) |

### AI Provider (OpenAI)

| Variable Name | Description | Default Value | Possible Values | Usage Location |
|---|---|---|---|---|
| **AI_MAX_TIMEOUT_MINUTES** | Maximum timeout in minutes for AI operations | `30` (in CI), `0` (local) | Positive integers (e.g., `30`, `60`) | [`src/common/aiProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/aiProvider/index.ts) |
| **OPENAI_API_KEY** | OpenAI API key for AI operations | `undefined` | Valid OpenAI API keys (e.g., `'sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'`) | [`src/common/aiProvider/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/aiProvider/index.ts) |

### Email Notifications

| Variable Name | Description | Default Value | Possible Values | Usage Location |
|---|---|---|---|---|
| **MS_TEAMS_WEBHOOK_URL** | Microsoft Teams webhook URL for notifications (deprecated) | `undefined` | Valid MS Teams webhook URLs (e.g., `'https://outlook.office.com/webhook/XXXXXXXXXXXX...'`) | [`src/common/notifProvider/utils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/utils.ts) |
| **NOTIF_EMAIL_ADDRESS** | Email address for notifications | `undefined` | Valid email addresses (e.g., `'notifications@mycompany.com'`, `'alerts@example.org'`) | [`src/common/notifProvider/emailProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/emailProvider.ts), [`src/common/notifProvider/utils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/utils.ts) |
| **NOTIF_EMAIL_ADDRESS_{BRANCH}** | Branch-specific email address for notifications | `undefined` | Valid email addresses (e.g., `'prod-alerts@mycompany.com'` for main branch) | [`src/common/notifProvider/emailProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/notifProvider/emailProvider.ts) |

### Browser Automation

| Variable Name | Description | Default Value | Possible Values | Usage Location |
|---|---|---|---|---|
| **CHROMIUM_PATH** | Path to Chromium executable for Puppeteer | `undefined` | Valid file system paths (e.g., `'/usr/bin/chromium'`, `'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'`) | Found in deployment documentation |
| **PUPPETEER_EXECUTABLE_PATH** | Path to Chrome/Chromium executable for Puppeteer | Auto-detected | Valid file system paths (e.g., `'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`) | [`src/common/utils/orgConfigUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/orgConfigUtils.ts) |

### Generic Ticketing

| Variable Name | Description | Default Value | Possible Values | Usage Location |
|---|---|---|---|---|
| **GENERIC_TICKETING_PROVIDER_REGEX** | Regular expression for generic ticketing provider ticket references | `undefined` | Valid regular expressions (e.g., `'TICKET-\\d+'`, `'[A-Z]{2,5}-\\d{1,6}'`, `'#\\d+'`) | [`src/common/ticketProvider/genericProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/genericProvider.ts) |
| **GENERIC_TICKETING_PROVIDER_URL_BUILDER** | URL template for generic ticketing provider | `undefined` | Valid URL templates with placeholders (e.g., `'https://tickets.mycompany.com/{ticketId}'`, `'https://helpdesk.example.com/ticket/{ticketId}'`) | [`src/common/ticketProvider/genericProvider.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/ticketProvider/genericProvider.ts) |

### Generic CI/CD

| Variable Name | Description | Default Value | Possible Values | Usage Location |
|---|---|---|---|---|
| **CI** | Indicates if running in a Continuous Integration environment | `undefined` | `'true'`, `'false'` | [`src/common/utils/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/index.ts) |
| **CI_COMMIT_REF_NAME** | Current git branch name in CI environment | Current git branch | Valid git branch names (e.g., `'main'`, `'develop'`, `'feature/new-feature'`, `'hotfix/urgent-fix'`) | [`src/common/utils/index.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/index.ts), [`src/common/utils/filesUtils.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/filesUtils.ts), [`src/common/gitProvider/gitlab.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/gitlab.ts), [`src/common/gitProvider/azureDevops.ts`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/gitProvider/azureDevops.ts) |

---

## Summary

This documentation covers **64 environment variables** used throughout sfdx-hardis:

- **Custom sfdx-hardis Variables**: 26 variables controlling native behavior
- **Tool-Specific Variables**: 38 variables for external integrations

The variables are organized by functionality to help developers and administrators understand their purpose and configure them appropriately for their environments.
