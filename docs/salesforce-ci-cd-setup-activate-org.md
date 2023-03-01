---
title: Activate Dev Hub and Sandbox Tracking
description: Learn how to activate Dev Hub and Sandbox Tracking on a CI/CD Salesforce project
---
<!-- markdownlint-disable MD013 -->

## Dev Hub and sandbox tracking

You must declare an org (usually production) as a DevHub and activate sandbox tracking to be able to work with advanced features of Salesforce DX

- Login to Dev Hub org

- Go to `Setup -> Dev Hub`

- [Activate Dev Hub](https://help.salesforce.com/articleView?id=sfdx_setup_enable_devhub.htm&type=5)

- [Activate Sandbox tracking](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_setup_enable_source_tracking_sandboxes.htm)
  - If sandbox were already existing, you need to refresh them if you want their source tracking to be activated
  - To use **Create from** from an existing sandbox, you need to refresh it before the cloning, else the nex sandbox won't have the tracking activated

## Major orgs

You need to have a Salesforce sandbox corresponding to each major branch.

Example:

- Branch `integration` - create a sandbox named `Integration`
- Branch `uat` - create a sandbox named `UAT `
- Branch `preprod` - create a sandbox named `Preprod`

If you are converting an existing project to CI/CD and already have existing orgs, just create an org `Integration`, and you'll refresh later `UAT` and `PreProd`, once your setup will be more advanced.
