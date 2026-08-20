---
title: Prepare the Salesforce orgs for CI/CD
description: Learn how to activate Dev Hub and sandbox source tracking, apply the org settings, and create the major org sandboxes for a Salesforce CI/CD project
---
<!-- markdownlint-disable MD013 -->

## Prepare the Salesforce orgs

### Production org settings

#### Dev Hub and sandbox source tracking

You must declare an org (usually production) as a Dev Hub and activate sandbox source tracking to work with the advanced features of Salesforce DX.

- Log in to the Dev Hub org
- Go to `Setup -> Dev Hub`
- [Activate Dev Hub](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_setup_enable_devhub.htm)
- [Activate sandbox source tracking](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_setup_enable_source_tracking_sandboxes.htm)
  - If sandboxes already existed, you need to refresh them to activate their source tracking
  - To use **Create from** with an existing sandbox, refresh it before cloning, otherwise the new sandbox will not have source tracking activated

#### Activate Experience Bundle metadata

- Go to `Setup -> Digital Experiences`
- Activate **Enable ExperienceBundle Metadata API**

### Major orgs

When a major branch gets a new state (after a merge), the CI server automatically deploys it to the related major org.

You need a Salesforce sandbox for each major branch.

> Create the major org sandboxes by cloning from Production.

> If you have existing sandboxes, it is highly recommended to refresh them before activating the pipeline.

Example:

- Branch `preprod`: create a sandbox named `Preprod`
- Branch `uat`: create a sandbox named `UAT`
- Branch `integration`: create a sandbox named `Integci` (sandbox names are limited to 10 characters)

Depending on the number of "bigger" sandboxes you have available, here are the recommended sandbox types for each major org:

| Available        | Integ  | UAT        | Preprod    |
|------------------|--------|------------|------------|
| Partial only     | dev SB | partial SB | dev SB     |
| Partial + 1 Full | dev SB | Full SB    | partial SB |
| Partial + 2 Full | dev SB | Full SB    | Full SB    |

If you are converting an existing project to CI/CD and already have orgs, just create an `Integration` org now. You will refresh `UAT` and `PreProd` later, once your setup is more advanced.

It is **very important that Integ is a developer sandbox**: you will clone it to create the sandboxes where people actually implement the User Stories, and you can only clone sandboxes of the same type.

### Developer sandboxes

The actual development work is done in developer sandboxes, which must be created from the Integration org.

You can now go to step [3. Initialize the SFDX project](salesforce-ci-cd-setup-init-project.md).
