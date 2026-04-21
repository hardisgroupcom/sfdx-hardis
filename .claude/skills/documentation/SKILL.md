---
name: documentation
description: Documentation standards for sfdx-hardis commands (description format with Command Behavior and Technical explanations sections, MkDocs site, build:doc). Use when creating or modifying commands.
user-invocable: false
---

# Documentation Standards

## Command Descriptions

Every command must have a static `description` with `## Command Behavior` and `<details>` sections:

```typescript
public static description = `
## Command Behavior

**Brief description of what this command does.**

Key functionalities:

- **Feature 1:** Description
- **Feature 2:** Description

This command is part of [sfdx-hardis Feature](${CONSTANTS.DOC_URL_ROOT}/path/).

<details markdown="1">
<summary>Technical explanations</summary>

Technical implementation details...
</details>
`;
```

## Project Documentation

- Main docs: https://sfdx-hardis.cloudity.com
- Auto-generated command docs: `yarn build:doc`
- Site generator: MkDocs
- AI-generated documentation features supported
