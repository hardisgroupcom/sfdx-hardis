---
title: Configure delta deployments on a Salesforce CI/CD Project
description: Learn how to configure Delta Deployments using sfdx-git-delta on a sfdx-hardis CI/CD Project
---
<!-- markdownlint-disable MD013 -->

- [Delta deployments](#delta-deployments)
  - [Full mode](#full-mode)
  - [Delta mode](#delta-mode)
  - [Delta with dependencies (beta)](#delta-with-dependencies-beta)
- [Configuration](#configuration)
  - [Base](#base)
  - [With Dependencies (beta)](#with-dependencies-beta)
  - [Miscellaneous](#miscellaneous)

___

## Delta deployments

### Full mode

By default, all deployments job (check deploy & process deploy) deploy the **full content of the `package.xml` minus what is matching `package-no-overwrite.xml`** (formerly `packageDeployOnce.xml`)

![](assets/images/ci-cd-schema-delta-off.jpg)

This is the safest way to deploy at each level

- major to major
- minor to major

___

### Delta mode

In order to improve performances on project with large metadata base, you can **activate delta deployments** for Pull Request/Merge Requests **from a minor branch** (examples: `feature/xxx`, `debug/xxx`) **to a major branch** (ex: `integration`, `uat`, `preprod`, `production`: sfdx-hardis will **deploy only updated metadatas** in the Pull Request / Merge Request.

![](assets/images/ci-cd-schema-delta.jpg)

![](assets/images/screenshot-delta-deployment.jpg)

**Merge Requests / Pull Request between major branches** (ex: uat to preprod) **remains in full deployment mode**, to avoid issues with configuration which would have been done directly in the orgs (whereas it shouldn't be, except for Reports, Dashboards and a few metadata types)

Examples:

- **features/config/my-work to integration** will be **DELTA** DEPLOYMENT
- **integration to uat** will be **FULL** DEPLOYMENT
- **hotfixes/fix-stuff to preprod** will be **DELTA** DEPLOYMENT
- **preprod to production** will be **FULL** DEPLOYMENT

> 💡 If you want to **force the use of full deployment for a PR/MR** on a delta project, add "**NO_DELTA**" in your latest commit title or text, or in your Pull Request description.

___

### Delta with Dependencies (beta)

Sometimes, using pure delta deployment is not enough: for example, if you delete a picklist value, simple delta deployment will pass, but later full deployment will fail because some references to the deleted value are remaining, like in Record Types, translations...

[Stepan Stepanov](https://www.linkedin.com/in/stepan-stepanov-79a48734/) implemented a smart way to handle that with sfdx-hardis: Delta with dependencies.

Delta with dependencies mode leverages a set of processors defined in `src/common/utils/deltaUtils.ts` to automatically detect and include related metadata dependencies in your deployment package. These processors analyze changes and ensure that dependent components are also deployed, reducing the risk of deployment failures due to missing references.

**List of supported dependency processors:**

- **CustomFieldPicklistProcessor**: Handles picklist value changes, ensuring related Record Types and translations are included.
- **CustomFieldProcessor**: Detects changes to custom fields and adds dependent layouts, validation rules, and field sets.
- **ObjectProcessor**: Manages object-level changes, including triggers, sharing rules, and compact layouts.
- **ProfilePermissionProcessor**: Ensures profile and permission set updates are deployed when related metadata changes.
- **RecordTypeProcessor**: Includes Record Type dependencies when fields or picklist values are modified.
- **TranslationProcessor**: Adds translation files for changed metadata, such as labels and picklist values.
- **WorkflowProcessor**: Handles workflow rule dependencies, including field updates and alerts.
- **LayoutProcessor**: Ensures layout changes are deployed when fields or objects are updated.

> ℹ️ The list of processors may evolve as new metadata types and dependency scenarios are supported. For the latest details, refer to the [deltaUtils.ts source](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/utils/deltaUtils.ts).

**How it works:**

When delta with dependencies is enabled, sfdx-hardis analyzes the changed files and applies each processor to detect and add required dependencies. This ensures that your deployment package contains all necessary components for a successful deployment, even in complex scenarios involving cross-referenced metadata.

What it adds automatically (high level):

- Translations for every language present in your project's main package. If an object, label, picklist or other translatable item is changed or deleted, the related translation files are included so languages stay in sync.
- Related Record Types when a field or picklist value on an object is changed. This prevents later full deployments from failing because an object still references a removed or modified picklist value.
- All records for a Custom Metadata type when one of its records is modified. This keeps metadata records consistent during delta deployments.
- Object-level translations when objects, layouts or similar items are modified so users in all languages get the corresponding changes.
- A small set of related settings (for example lead-convert related settings) when the changed item can have cross-references in those settings.
- For deletions, the feature also tries to include related translations and entries so removing something in a delta won't break a future full deployment.

Practical examples:

- You remove a picklist value in a feature branch. The delta will include any Record Types and translations that reference that value so later full deployments don't fail.
- You update a custom object or its layout. The delta will add object translations for all declared languages.
- You change a custom metadata record. The delta will include the other records of the same custom metadata type to keep the set consistent.

How to validate in CI:

- When enabled, the pipeline publishes or logs the delta package that will be deployed — inspect the generated package.xml in the job output or artifacts to see the added entries.
- Start by enabling the feature on a non-critical branch (or for a single PR) to confirm the produced delta includes the expected additional metadata before rolling it out broadly.

Note: This feature is provided in beta — it helps reduce deployment surprises but it's recommended to test it on your repository and workflows before relying on it for critical releases.

___

## Configuration

### Base

To activate delta deployments,you can:

- define `useDeltaDeployment: true` in **config/.sfdx-hardis.yml**
- define env variable `USE_DELTA_DEPLOYMENT=true`

In case of temporary deactivation of delta deployments, you can set variable `DISABLE_DELTA_DEPLOYMENT=true`, it has priority on other configurations.

> 💡If your sfdx-hardis installation is from before 4.10.0, you might need to update your CI/CD workflows
>
> Check updated versions in [sfdx-hardis sources](https://github.com/hardisgroupcom/sfdx-hardis/tree/main/defaults/ci)

It is recommended to use opinionated default sfdx-hardis delta deployment configuration, but if you want to tweak the config you can use the following variables:

### With dependencies (beta)

Delta mode must be activated and applicable to allow delta with dependencies to be activated.

You can either:

- Define `useDeltaDeploymentWithDependencies: true` in **config/.sfdx-hardis.yml**
- Define env var `USE_DELTA_DEPLOYMENT_WITH_DEPENDENCIES=true`

### Miscellaneous

> Standard sfdx-hardis pipeline does not recommend to use these modes, but if you really know what you're doing, like the artists of [BeyondTheCloud.dev](https://blog.beyondthecloud.dev/for-developers), you can use them :)

- USE_DELTA_DEPLOYMENT_AFTER_MERGE
  - By default, after a merge sfdx-hardis will try to use [QuickDeploy](salesforce-ci-cd-setup-integrations-home.md#git-providers). If not available, it will perform a full deployment. If you want to use a delta deployment anyway, define `USE_DELTA_DEPLOYMENT_AFTER_MERGE=true`

- ALWAYS_ENABLE_DELTA_DEPLOYMENT
  - By default, delta deployment is allowed only from minor to major branches. You can force it for PR/MRs between major branches by defining variable `ALWAYS_ENABLE_DELTA_DEPLOYMENT=true`

