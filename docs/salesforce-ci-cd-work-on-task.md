---
title: Work on a User Story on a Salesforce CI/CD project
description: How to work in your dev sandbox or scratch org on a Salesforce CI/CD project, and the guidelines that keep deployments simple
---
<!-- markdownlint-disable MD013 -->

## Work in your org

Once your User Story is started, you work in your dev sandbox or scratch org like in any other org: Salesforce Setup for configuration, VS Code for code. A few guidelines make the life of the release manager easier and avoid regressions when your work is deployed to the other orgs.

- [Open your org](salesforce-ci-cd-work-on-task-open-org.md): open the org linked to your User Story from VS Code.
- [Configuration guidelines](salesforce-ci-cd-work-on-task-configuration.md): API names, access management, Flows, hardcoded Ids, images, user references.
- [Profiles and Permission Sets](salesforce-ci-cd-work-on-task-profiles.md): why Permission Sets come first, and the Profile attributes that need special care.
- [Development guidelines](salesforce-ci-cd-work-on-task-development.md): push and pull code between VS Code and your org.
- [Install packages](salesforce-ci-cd-work-on-task-install-packages.md): register the packages installed in your org so the CI server installs them everywhere.
- [Deployment actions](salesforce-ci-cd-work-on-task-deployment-actions.md): declare the steps that must run before or after the deployment of your User Story (data loads, Apex scripts, Experience Cloud publishing, scheduled batches, manual steps).

When you are done, [publish your User Story](salesforce-ci-cd-publish-task.md).

> If your colleagues merged changes in the meantime, [Backpromote (Beta)](hardis/work/backpromote.md) brings them into your dev sandbox so you work on an up-to-date org.

---

### Video walkthrough

This recording shows how to work on a User Story in a source-tracked sandbox. It was recorded with the previous interface of the extension: the screens have changed, the steps have not.

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/-EjPkDDH7VY" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>
