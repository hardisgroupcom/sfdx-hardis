---
title: Perform configuration in your Salesforce org
description: Learn how to perform configuration on a CI/CD project with a tracked sandbox or a scratch org
---
<!-- markdownlint-disable MD013 -->

- [Configuration](#configuration)
  - [Api names](#api-names)
  - [Access management](#access-management)
  - [Flows](#flows)
  - [Hardcoded Ids](#hardcoded-ids)
  - [Images](#images)
  - [User references](#user-references)

## Configuration

Please follow as much as possible these recommendations when you work on a CI/CD Salesforce project, otherwise it will generate more release management charges and risks of regressions.

### Api names

- **Do not rename API names** (field names, picklist values, pages...)

- **Do not prefix API Names with numbers**: Git provides historization of updates, so it's better to have elements sorted by alphabetical order than by order of creation

- **Do not change the type of custom fields**: It forces the release manager to perform manual actions

### Access management

- Always **use Permission Sets** instead of Profiles. If you need profiles, discuss with your release manager.

- If you create a **Custom Profile**, please notify your release manager.
  - Before the first deployment, this Profile **must be created manually in the target org by cloning "Minimum access" Profile**

### Flows

- If you need to update Flows, discuss to make sure that no other member of the team is updating the same Flow in another branch/org
  - _If it happens, conflicts are not manageable so one of you will later need to perform the updates again_

### Hardcoded Ids

- **Never use hardcoded Ids** in Flows and Formulas (or anywhere else)

### Images

- Use **static resources** or **content assets** to store images

### User references

- Do not use direct references to users, use [Public Groups](https://developer.salesforce.com/docs/atlas.en-us.securityImplGuide.meta/securityImplGuide/user_groups.htm) instead

- Share your reports and email templates with public groups, not named users.