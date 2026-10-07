---
title: Flow Visual Git Diff
description: With sfdx-hardis, visual Flow diffs in deployment comments
---

<!-- markdownlint-disable MD013 -->

# Flow Visual Git Diff

In addition to deployment tips, Deployment Agent can post **Flow Visual Git Diff** in Pull Request comments.

This helps reviewers:

- Visually inspect Flow differences in a Mermaid diagram
- Understand updates without opening raw XML metadata

Each changed Flow gets a comment of its own: the properties that changed, with their value before and after, then the diagram. The full property tables of the Flow are folded below it.

![Visual git diff comment of a Flow](assets/images/screenshot-pr-comment-flow-diff.png)

A Flow whose only change is its status (activated or deactivated) gets no comment: the folded **Flows** section of the validation comment names it, with its status before and after.

## Legend

- 🟩 = added
- 🟥 = removed
- 🟧 = updated

![](assets/images/flow-visual-git-diff.jpg)

![](assets/images/flow-visual-git-diff-2.jpg)

## Disable if needed

To disable Flow Visual Git Diff in Pull Request comments, set:

```bash
SFDX_DISABLE_FLOW_DIFF=true
```

## Related pages

- [Deployment Agent](salesforce-deployment-agent-home.md)
- [Agent deployment Hints](salesforce-deployment-agent-hints.md)
- [Setup Deployment Agent](salesforce-deployment-agent-setup.md)
