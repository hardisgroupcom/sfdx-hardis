---
title: First merge request
description: Learn how to create your first merge request to complete your Salesforce CI/CD Setup
---
<!-- markdownlint-disable MD013 -->

- [Initialization merge request](#initialization-merge-request)
- [Common issues](#common-issues)
  - [Translations](#translations)

## Initialization merge request

[Create your first merge request](salesforce-ci-cd-publish-task.md) with branch **cicd** as source, and your lower major branch as target (usually **integration**)

Make sure that before merging your first merge request, file **manifest/destructiveChange.xml** is empty

You will see errors, but it is normal: Follow [Maintainer Guide](salesforce-ci-cd-config-home.md) to complete your configuration !

Once all controlling jobs are in success, your CI/CD setup is completed !

## Common issues

### Translations

If you removed Dashboards and reports from the repo, their translations can remain in files like **translations/en_US.xml**

Remove all related XML blocks as they contain unused translations.
