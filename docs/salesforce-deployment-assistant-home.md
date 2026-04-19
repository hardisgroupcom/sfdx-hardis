---
title: Sfdx-hardis deployment assistant
description: Learn how to sfdx-hardis deployment assistant can help you !
---

<!-- markdownlint-disable MD013 -->

# sfdx-hardis Deployment Assistant

## Salesforce DevOps AI Integration

Deployment errors are common and quite boring, right ?

Sfdx-hardis deployment assistant will help you to solve them, even if you are not using sfdx-hardis CI/CD pipelines !

The assistant contain core rules and can optionally be integrated with AI to provide you the best guidance :)

![](assets/images/AI-Assistant.gif)

## Coding Agent Auto-Fix (Beta)

When a deployment fails, sfdx-hardis can go one step further and **automatically fix the errors** using a coding agent CLI (Claude, Codex, Gemini, or GitHub Copilot).

The agent analyzes deployment errors, modifies local metadata files, and creates a Pull Request with the proposed fixes — all without deploying anything.

> **Use with caution:** AI coding agents can make mistakes. All auto-fix Pull Requests must be **carefully reviewed by an expert** before merging.

Supported agents:

- [Claude](https://www.npmjs.com/package/@anthropic-ai/claude-code) (Anthropic)
- [Codex](https://www.npmjs.com/package/@openai/codex) (OpenAI)
- [Gemini CLI](https://www.npmjs.com/package/@google/gemini-cli) (Google)
- [GitHub Copilot CLI](https://www.npmjs.com/package/@github/copilot) (GitHub)

See [Coding Agent Auto-Fix setup](salesforce-deployment-assistant-autofix.md) for configuration instructions.

## Flow Visual Git Diff

In addition to deployment tips, comments will be posted on PRs with Visual Git Diff for Flows, that will:

- Visually show you the differences on a diagram
- Display the update details without having to open any XML !

🟩 = added

🟥 = removed

🟧 = updated

![](assets/images/flow-visual-git-diff.jpg)

![](assets/images/flow-visual-git-diff-2.jpg)

## Integrations

Deployment assistant will provide tips in Pull Request comments (GitHub, Gitlab, Azure, Bitbucket).

It will also provide tips in console log.

![](assets/images/AI-deployment-assistant-console.png)

## Setup

Just follow the instructions to be ready in a few minutes

- [sfdx-hardis deployment assistant setup instructions](salesforce-deployment-assistant-setup.md)
- [Coding Agent Auto-Fix setup](salesforce-deployment-assistant-autofix.md)
- [sfdx-hardis AI setup instructions](salesforce-ai-setup.md) (requires an Openai API key)
