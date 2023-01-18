---
title: Salesforce CI/CD User Guide for Developer, Admins, Release managers
description: Learn how to use Salesforce DX to perform updates in Salesforce (developer, business consultant or release management)
---
<!-- markdownlint-disable MD013 -->

## Business consultant / Developer guide

Working on a Salesforce DX project can be described in the following steps

### Initialization

You need a stack of applications and to have Salesforce sources on your computer to be able to start to work on a CI/CD project.

- [Install necessary applications on your computer](salesforce-ci-cd-use-install.md) (to perform only **once by computer**)
- [Clone git repository on your computer](salesforce-ci-cd-clone-repository.md) (to perform only **once by Salesforce project**)

### Make updates on your Salesforce project

Now your computer is ready, let's see how you can use sandboxes or scratch orgs to make updates in your Salesforce projects !

- [Create a new task](salesforce-ci-cd-create-new-task.md)
- [Work on your current task](salesforce-ci-cd-work-on-task.md)
- [Publish your task](salesforce-ci-cd-publish-task.md)
- [Validate a merge request](salesforce-ci-cd-validate-merge-request.md) _(Release manager and advanced user only, depending on the project organization)_

## Release manager guide

In order to respect the best DevOps practices, it's highly recommended for project teams to have members taking the role of **Release Manager**

The release manager(s) responsibilities are:

- Train & support all project members about the use Salesforce CI/CD on the project
- [Validate users merge requests](salesforce-ci-cd-validate-merge-request.md)
- [Proceed deployments to major branches/org (UAT,Preprod,Production...)](salesforce-ci-cd-deploy-major-branches.md)
- [Configure CI/CD project](salesforce-ci-cd-config-home.md)
