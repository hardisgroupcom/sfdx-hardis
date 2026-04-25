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

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:<topic>:<action> --agent --target-org myorg@example.com
\`\`\`

In agent mode, all interactive prompts are skipped and default values are applied.

<details markdown="1">
<summary>Technical explanations</summary>

Technical implementation details...
</details>
`;
```

## Agent Mode Documentation Requirements

When a command exposes an `--agent` flag, its `description` **must** include a `### Agent Mode` section explaining:

1. **How to invoke it**: a concrete shell example using `--agent` with all required flags.
2. **What flags are required** in agent mode (e.g., `--task-name`, `--target-branch`) vs. which are optional.
3. **What defaults are applied** when optional flags are omitted (e.g., "defaults to `daily` period", "skips metadata pull").
4. **What is skipped**: list interactive prompts or steps that are bypassed.

The `examples` array must also include at least one entry that uses `--agent`.

### Simple command (no required flags beyond `--target-org`)

```typescript
### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:diagnose:mycommand --agent --target-org myorg@example.com
\`\`\`

In agent mode, all interactive prompts are skipped and default values are used.
```

### Command with meaningful flag choices

```typescript
### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:diagnose:unusedusers --agent --days 180 --licensetypes all-crm --target-org myorg@example.com
\`\`\`

In agent mode:

- \`--days\` defaults to 180 when not provided.
- \`--licensetypes\` defaults to \`all-crm\` when not provided.
- Interactive deletion prompts are skipped.
```

### Do NOT use

- The single-line pattern `Supports non-interactive execution with \`--agent\` (uses default values and skips prompts).` — replace it with a proper `### Agent Mode` section.

## Project Documentation

- Main docs: https://sfdx-hardis.cloudity.com
- Auto-generated command docs: `yarn build:doc`
- Site generator: MkDocs
- AI-generated documentation features supported
