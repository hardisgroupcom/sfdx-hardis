---
title: Initialize the SFDX project for CI/CD
description: Learn how to initialize a Salesforce DX project for CI/CD with sfdx-hardis, and which workflow files to keep for your Git provider
---

<!-- markdownlint-disable MD013 -->

## Initialize the SFDX project

- Clone locally the [repository that you created in the previous step](salesforce-ci-cd-setup-git.md) (or reuse an existing SFDX project repository)

- Create a new git branch named **cicd** under your lowest major branch (usually **integration**)

- Run the command **Configuration ->** ![Create new sfdx project](assets/images/btn-create-project.jpg) (`sf hardis:project:create`) and select the options to create a new sfdx-hardis project

> Use the sfdx-hardis command to create the new project, not the default Salesforce one.

- Open the file **manifest/package.xml** and replace its content with the following code

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
<version>65.0</version> <!-- use the current Salesforce API version -->
</Package>
```

- If you use GitLab CI and sandboxes only (no scratch orgs), open **gitlab-ci-config.yml** at the root of the repository and set the variable **USE_SCRATCH_ORGS** to `"false"`

- Depending on your Git provider, keep the related workflow files and delete the others

  - GitLab
    - `gitlab-ci.yml`
    - `gitlab-ci-config.yml`
  - Azure
    - `azure-pipelines-checks.yml`
    - `azure-pipelines-deployment.yml`
  - GitHub
    - Folder `.github/workflows`
  - Bitbucket
    - `bitbucket-pipelines.yml`

- During the CI/CD setup, find the variable **SFDX_DISABLE_FLOW_DIFF** in the pipeline of your Git provider and set its value to **true**, to avoid generating too many Pull Request comments during the setup. At the end of the setup, set the variable back to false.

> Some workflow files contain additional configuration instructions: read the comments at the beginning of the files.

You can now go to step [4. Configure CI authentication](salesforce-ci-cd-setup-auth.md).
