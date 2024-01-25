---
title: Configure Integrations between sfdx-hardis and Jira
description: Enrich pull requests with JIRA info and post comments & tags on tickets when they are deployed to a Salesforce org
---
<!-- markdownlint-disable MD013 -->

- [Jira integration](#jira-integration)
  - [For git providers](#for-git-providers)
  - [For notifications providers](#for-notifications-providers)
  - [Update JIRA issues](#update-jira-issues)
- [Global Configuration](#global-configuration)
  - [Identify JIRA tickets](#identify-jira-tickets)
  - [Jira Cloud](#jira-cloud)
  - [Jira On-Premise](#jira-on-premise)
- [Gitlab configuration](#gitlab-configuration)
- [Technical notes](#technical-notes)

## Jira integration

If you use JIRA on your project, sfdx-hardis can use it to enrich its integrations

Sfdx-hardis will automatically analyze commits and PR/MR descriptions to collect JIRA tickets URLS !

You can **use the full URL of JIRA tickets** in your commits and PR/MR descriptions.

> Use `https://sfdx-hardis.atlassian.net/browse/CLOUDITY-4` , not `CLOUDITY-4` !

If you don't use full URL, a default expression will be used, that you can override for a better accuracy ([see Identify JIRA Tickets](#identify-jira-tickets) )

> In that case, `CLOUDITY-4` will be detected, but make sure that JIRA_HOST is defined

### For git providers

Github, Gitlab, Azure, Bitbucket: Post references to JIRA tickets in PR/MR comments

![](assets/images/screenshot-jira-gitlab.jpg)

### For notifications providers

Slack, MsTeams: Add deployed JIRA tickets in deployment notifications

![](assets/images/screenshot-jira-slack.jpg)

### Update JIRA issues

Add comments and tags on JIRA tickets when they are deployed in a major org

Default tag is `UPPERCASE(branch_name) + "_DEPLOYED"`.

To override it, define env variable **DEPLOYED_TAG_TEMPLATE**, that must contain `{BRANCH}`.

Example: `DEPLOYED_TO_{BRANCH}`

![](assets/images/screenshot-jira-comment.jpg)

## Global configuration

### Identify JIRA Tickets

Define CI/CD variable **JIRA_TICKET_REGEX** with a regular expression allowing to identify the JIRA tickets of your project in commit& Pull Requests titles & bodies, for example `(CLOUDITY-[0-9]+)`

### Jira Cloud

Define CI/CD variables

- JIRA_HOST (example: `https://sfdx-hardis.atlassian.net/`)
- JIRA_EMAIL (example: `nicolas.vuillamy@cloudity.com`)
- JIRA_TOKEN , to create following [Atlassian documentation](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/)

### Jira On-Premise

_Note: Does not seems to work with every on-premise JIRA servers_

Define CI/CD variables

- JIRA_HOST (examples: `https://jira.cloudity.com/` , or with path like `https://pid.cloudity.com/jira/`)
- JIRA_PAT, to create following [Atlassian Documentation](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) (section **Creating PATs in the application**)

## Gitlab configuration

If you are using Gitlab, you need to update the Merge Request Settings

Go to Project -> Settings -> Merge Requests

Update **Merge Commit Message Template** with the following value

```sh
%{title} Merge branch '%{source_branch}' into '%{target_branch}'

%{issues}

See merge request %{reference}

%{description}

%{all_commits}
```

Update **Squash Commit Message Template** with the following value

```sh
%{title} Merge branch '%{source_branch}' into '%{target_branch}'

%{issues}

See merge request %{reference}

%{description}

%{all_commits}
```

## Technical notes

This integration use the following variables, that must be available from the pipelines:

- JIRA_HOST
- JIRA_EMAIL
- JIRA_TOKEN
- JIRA_PAT
