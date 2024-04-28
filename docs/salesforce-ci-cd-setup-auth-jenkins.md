---
title: Configure Jenkins CI/CD credentials
description: Learn how to configure CI/CD variables for CI Server authentication to automate deployments with Jenkins Pipelines
---
<!-- markdownlint-disable MD013 -->

## Define sfdx-hardis environment variables

- Go to **Dashboard -> Manage Jenkins**
- Under Security tab click on **Credentials -> global credentials**
- Click on **Add credential** , then choose **Secret text**
- Input variable name and value
- Don't forget to click on **create** !

![](assets/images/screenshot-monitoring-jenkins-variable.png)

More info: [Jenkins documentation](https://www.jenkins.io/doc/book/using/using-credentials/){target=blank}