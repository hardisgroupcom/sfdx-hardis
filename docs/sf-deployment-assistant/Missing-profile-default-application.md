---
title: : Missing profile default application (Deployment assistant)
description: How to solve Salesforce deployment error You can't remove the only default app from the profile.
---
<!-- markdownlint-disable MD013 -->
# Missing profile default application

## Detection

- String: `You can't remove the only default app from the profile.`

## Resolution

```shell
You must have a default application for a profile. You can:
 - Update it in UI
 - Update the XML of the profile to set "true" in the <default> tag of one of the applicationVisibilities item.
 Ex:
 <applicationVisibilities>
    <application>standard__LightningSales</application>
    <default>true</default>
    <visible>true</visible>
</applicationVisibilities>
```
