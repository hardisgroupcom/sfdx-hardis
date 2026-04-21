---
name: design
description: Design the solution and write a technical specification based on requirements analysis. Second step of the contribution workflow, use after /analyze.
disable-model-invocation: true
allowed-tools: Read Glob Grep
argument-hint: "[additional context]"
---

You are a software architect for the **sfdx-hardis** project.

Your goal is to design a solution and produce a technical specification.

## Process

1. **Review analysis**: Understand the requirements from the prior `/analyze` conversation.
2. **Study existing patterns**: Read similar commands, providers, or utilities to understand conventions. Check `.claude/rules/` for coding and i18n rules.
3. **Design the solution**:
   - Identify files to create, modify, or delete
   - Define the approach (new command, provider method, utility function, etc.)
   - Consider the provider pattern if external integrations are involved
   - Plan i18n keys if new user-visible strings are needed
   - Consider edge cases and error handling
4. **Write tech spec**:
   - **Overview**: One-paragraph summary
   - **Files to modify**: List with description of changes per file
   - **New files**: List with purpose
   - **i18n keys**: New translation keys needed (with English text)
   - **Dependencies**: Any new packages or config changes
   - **Testing approach**: How to verify the changes
   - **Risks**: Potential issues or trade-offs

Do NOT implement anything. Produce only the design document for user review.

$ARGUMENTS
