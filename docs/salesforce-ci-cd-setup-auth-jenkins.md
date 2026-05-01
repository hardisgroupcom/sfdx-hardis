---
title: Configure Jenkins CI/CD credentials
description: Learn how to configure CI/CD credentials for Jenkins Pipelines to automate Salesforce deployments with sfdx-hardis
---
<!-- markdownlint-disable MD013 -->

## Add credentials in Jenkins

- Go to **Dashboard -> Manage Jenkins -> Credentials -> (global)**
- Click **Add Credentials**
- Kind: **Secret text**
- Secret: paste the credential value
- ID: the variable name expected by sfdx-hardis (e.g. `SFDX_CLIENT_ID_INTEGRATION`)
- Click **Create**

![](assets/images/screenshot-monitoring-jenkins-variable.png)

More info: [Jenkins documentation](https://www.jenkins.io/doc/book/using/using-credentials/){target=blank}

## Reference credentials in your Jenkinsfile

Credentials are injected per-stage using `withCredentials()` so that each stage only receives the secrets it actually needs.

```groovy
withCredentials([
    string(credentialsId: 'SFDX_CLIENT_ID_INTEGRATION',  variable: 'SFDX_CLIENT_ID_INTEGRATION'),
    string(credentialsId: 'SFDX_CLIENT_KEY_INTEGRATION', variable: 'SFDX_CLIENT_KEY_INTEGRATION'),
    // Optional credentials use `optional: true` - missing ones are silently ignored
    string(credentialsId: 'SLACK_TOKEN', variable: 'SLACK_TOKEN', optional: true),
]) {
    sh 'sf hardis:auth:login'
    sh 'sf hardis:project:deploy:smart --check'
}
```

Impacted files if present in your repo:

- `Jenkinsfile`

## Auto-fix branches

Default CI templates skip `sf hardis` commands when the current branch starts with `auto-fix/`.
This prevents recursive or redundant deploy/check executions on auto-generated fix branches.
