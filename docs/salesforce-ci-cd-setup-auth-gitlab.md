---
title: Configure Gitlab CI/CD variables
description: Learn how to configure CI/CD variables for CI Server authentication to automate deployments with Gitlab
---
<!-- markdownlint-disable MD013 -->

## Define sfdx-hardis environment variables

- Go to **Project -> Settings > CI/CD -> Variables** _(you must have Gitlab authorizations to access this menu)_

![](assets/images/screenshot-gitlab-variables.png)

- Create the variable with the following info:
  - name: **YOUR_VARIABLE_NAME**
  - value: `Your variable value`
  - Select **Mask variable** if the value is secured, like credentials or tokens
  - Unselect **Protected variable**

![](assets/images/screenshot-add-variable-gitlab.png)

More info: [Gitlab documentation](https://docs.gitlab.com/ee/ci/variables/#for-a-project){target=blank}