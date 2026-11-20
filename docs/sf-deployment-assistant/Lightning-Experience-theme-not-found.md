---
title: "Lightning Experience theme not found (Deployment assistant)"
description: "How to solve Salesforce deployment error \"/no LightningExperienceTheme named (.*) found\""
---
<!-- markdownlint-disable MD013 -->
# Lightning Experience theme not found

## Detection

- RegExp: `no LightningExperienceTheme named (.*) found`

## Resolution

```shell
Lightning Experience theme {1} is not in the target org
- If {1} is a custom theme, add LightningExperienceTheme:{1} to your sources
- If {1} is a standard theme (Lightning, LightningBlue...), the Metadata API can not activate it: remove activeThemeName from LightningExperience.settings-meta.xml in your sources, then activate the theme in Setup -> Themes and Branding, or with a deployment action
```

## Deployment action

A deployment action can solve this error. Create it on the Pull Request of the current branch:

```shell
sf hardis:project:action:create --agent --scope pr --pr-id current --when pre-deploy --type browser --label "Activate Lightning Experience theme {1}" --browser-setting lightningExperienceSettings --browser-config '{"activeThemeName":"{1}"}'
```

A deployment check only simulates a browser action. If this check still fails on this error once the action is created, apply the setting once in the target org with the Run in another org button of the VS Code Deployment Actions tab, or with sf hardis:project:action:run --select-org, then run the check again.

Documentation: https://amtrack.github.io/sfdx-browserforce-plugin/settings/lightningExperienceSettings/
