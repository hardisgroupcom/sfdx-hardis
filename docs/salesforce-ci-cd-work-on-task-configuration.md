---
title: Configuration guidelines on a Salesforce CI/CD project
description: Guidelines to follow when you configure your dev sandbox or scratch org on a Salesforce CI/CD project
---
<!-- markdownlint-disable MD013 -->

- [Configuration guidelines](#configuration-guidelines)
  - [API names](#api-names)
  - [Access management](#access-management)
  - [Flows](#flows)
  - [Hardcoded Ids](#hardcoded-ids)
  - [Images](#images)
  - [User references](#user-references)

## Configuration guidelines

Follow these recommendations as much as possible when you work on a Salesforce CI/CD project. Each time one of them is not respected, the release manager has more manual work to do and the risk of regression grows.

### API names

- **Do not rename API names** (field names, picklist values, pages...). Git keeps the history of your updates, and a rename is seen as a deletion plus a creation.

- **Do not prefix API names with numbers**. Git keeps the history of the updates, so it is better to have elements sorted alphabetically than by order of creation.

- **Do not change the type of a custom field**. It forces the release manager to perform manual actions in every org.

### Access management

- Always **use Permission Sets** instead of Profiles. If you think you need a Profile, discuss it with your release manager first. See [Profiles and Permission Sets](salesforce-ci-cd-work-on-task-profiles.md).

- If you create a **custom Profile**, notify your release manager.
  - Before the first deployment, this Profile **must be created manually in the target org by cloning the "Minimum Access" Profile**.

### Flows

- If you need to update a Flow, check first that no other member of the team is updating the same Flow in another branch or org.
  - If it happens, the conflicts cannot be merged, so one of you will have to redo the updates later.

### Hardcoded Ids

- **Never use hardcoded Ids** in Flows, formulas, or anywhere else. Ids are different in every org.

### Images

- Store images in **static resources** or **content assets**, so they are deployed with your metadata.

### User references

- Do not reference users directly. Use [Public Groups](https://developer.salesforce.com/docs/atlas.en-us.securityImplGuide.meta/securityImplGuide/user_groups.htm) instead.

- Share your reports and email templates with public groups, not with named users.
