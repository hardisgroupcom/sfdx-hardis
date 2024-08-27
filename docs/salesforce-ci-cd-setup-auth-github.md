---
title: Configure GitHub CI/CD variables
description: Learn how to configure CI/CD variables for CI Server authentication to automate deployments with GitHub
---
<!-- markdownlint-disable MD013 -->

## Define sfdx-hardis environment variables

- Go to **Repository -> Settings > Secret and variables -> Actions** _(you must have Github authorizations to access this menu)_

![](assets/images/screenshot-monitoring-github-variable.png.jpg)

- Create the new secret with the following info:
  - name: **YOUR_VARIABLE_NAME**
  - value: `Your variable value`

![](assets/images/screenshot-monitoring-github-variable-add.png.jpg)

More info: [GitHub documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets#creating-encrypted-secrets-for-a-repository){target=blank}