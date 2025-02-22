<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:deploy:notify

## Description

Post notifications related to:

- **Deployment simulation** _(use with --check-only)_

- **Deployment process** _(to call only if your deployment is successful)_

### Integrations

According to the [integrations you configured](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integrations-home/), notifications can contain deployment information and [Flow Visual Git Diff](https://sfdx-hardis.cloudity.com/salesforce-deployment-assistant-home/#flow-visual-git-diff)

- GitHub, Gitlab, Azure DevOps, Bitbucket comments on Pull Requests (including Flows Visual Git Diff)

- Slack, Microsoft Teams, Email deployment summary after a successful deployment

- JIRA tags and comments on tickets that just has been deployed

![](https://sfdx-hardis.cloudity.com/assets/images/screenshot-jira-gitlab.jpg)

![](https://sfdx-hardis.cloudity.com/assets/images/screenshot-jira-slack.jpg)

### Flows Visual Git Diff

- Visually show you the differences on a diagram

- Display the update details without having to open any XML !

🟩 = added

🟥 = removed

🟧 = updated

![](https://sfdx-hardis.cloudity.com/assets/images/flow-visual-git-diff.jpg)

![](https://sfdx-hardis.cloudity.com/assets/images/flow-visual-git-diff-2.jpg)

### In custom CI/CD workflow

Example of usage in a custom CI/CD pipeline:

```bash
# Disable exit-on-error temporarily
set +e

# Run the deploy command
sf project deploy start [....]
RET_CODE=$?

# Re-enable exit-on-error
set -e

# Determine MYSTATUS based on return code
if [ $RET_CODE -eq 0 ]; then
    MYSTATUS="valid"
else
    MYSTATUS="invalid"
fi

# Run the notify command with MYSTATUS
sf hardis:project:deploy:notify --check-only --deploy-status "$MYSTATUS"
```

### Other usages

This command is for custom SF Cli pipelines, if you are a sfdx-hardis user, it is already embedded in sf hardis:deploy:smart.

You can also use [sfdx-hardis wrapper commands of SF deployment commands](https://sfdx-hardis.cloudity.com/salesforce-deployment-assistant-setup/#using-custom-cicd-pipeline)


## Parameters

| Name                 |  Type   | Description                                                                                                            | Default | Required |            Options            |
|:---------------------|:-------:|:-----------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-----------------------------:|
| check-only<br/>-c    | boolean | Use this option to send notifications from a Deployment simulation job                                                 |         |          |                               |
| debug<br/>-d         | boolean | Activate debug mode (more logs)                                                                                        |         |          |                               |
| deploy-status<br/>-s | option  | Send success, failure or unknown (default) to indicate if the deployment or deployment simulation is in success or not | unknown |          | valid<br/>invalid<br/>unknown |
| flags-dir            | option  | undefined                                                                                                              |         |          |                               |
| json                 | boolean | Format output as json.                                                                                                 |         |          |                               |
| message<br/>-m       | option  | Custom message that you want to be added in notifications (string or markdown format)                                  |         |          |                               |
| skipauth             | boolean | Skip authentication check when a default username is required                                                          |         |          |                               |
| target-org<br/>-o    | option  | undefined                                                                                                              |         |          |                               |
| websocket            | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                              |         |          |                               |

## Examples

```shell
sf hardis:project:deploy:notify --check-only --deploy-status valid --message "This deployment check is valid\n\nYahooo !!"
```

```shell
sf hardis:project:deploy:notify --check-only --deploy-status invalid --message "This deployment check has failed !\n\Oh no !!"
```

```shell
sf hardis:project:deploy:notify --deploy-status valid --message "This deployment has been processed !\n\nYahooo !!"
```


