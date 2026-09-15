---
title: First Pull Request
description: With sfdx-hardis, learn how to create your first Pull Request (Merge Request on GitLab) to complete your Salesforce CI/CD setup
---
<!-- markdownlint-disable MD013 -->

## First Pull Request

- [Initialization Pull Request](#initialization-pull-request)
- [Common issues](#common-issues)
  - [Translations](#translations)

### Initialization Pull Request

[Create your first Pull Request](salesforce-devops-publish-user-story.md) (Merge Request on GitLab) with the branch **cicd** as source, and your lowest major branch as target (usually **integration**).

Before merging this first Pull Request, make sure that the file **manifest/destructiveChanges.xml** is empty.

You will see errors, and it is normal: follow the [Project configuration guide](salesforce-devops-config-home.md) to complete your configuration.

Once all control jobs succeed, your CI/CD setup is complete.

Now go through the [Setup checklist](salesforce-devops-setup-checklist.md) to make sure nothing is missing, especially the integrations.

### Common issues

#### Translations

If you removed Dashboards and Reports from the repository, their translations can remain in files like **translations/en_US.translation-meta.xml**.

Remove all the related XML blocks, as they contain unused translations.
