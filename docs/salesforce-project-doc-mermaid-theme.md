---
title: Override Mermaid Theme
description: Customize Mermaid colors and node styles used in sfdx-hardis generated Flow documentation and Flow diffs.
---
<!-- markdownlint-disable MD013 -->

## Override Mermaid theme

When sfdx-hardis generates Flow documentation or Flow history diffs, it now reads the `mermaidTheme` property from your project configuration.

This configuration only overrides the defaults shipped with sfdx-hardis. You can define just one color or one node type, and every property you do not provide keeps the built-in Mermaid rendering style.

The same configuration is also used in CI/CD pipelines when sfdx-hardis generates visual Flow diffs for monitoring, history pages, or pull request analysis. This means your local generated docs and your pipeline-generated Flow diffs stay visually consistent.

Define it in `config/.sfdx-hardis.yml`, then regenerate your documentation:

## Supported keys

Node overrides can be defined with the following keys:

- `actionCalls`
- `assignments`
- `collectionProcessors`
- `customErrors`
- `decisions`
- `loops`
- `recordCreates`
- `recordDeletes`
- `recordLookups`
- `recordRollbacks`
- `recordUpdates`
- `screens`
- `subflows`
- `startClass`
- `endClass`
- `transforms`

Diff overrides can be defined with:

- `added`
- `removed`
- `changed`

For node keys, supported properties are:

- `background`
- `color`
- `stroke`
- `strokeWidth`
- `mermaidOpen`
- `mermaidClose`

For diff keys, supported properties are:

- `background`
- `color`
- `lineColor`
- `strokeWidth`

## Flat aliases

If you prefer a flatter config, you can also use alias keys such as:

- `decisionColor`
- `decisionTextColor`
- `actionColor`
- `addedColor`
- `addedTextColor`
- `addedLinkColor`

Nested keys and flat aliases both merge with the built-in defaults. Any property you omit keeps the standard sfdx-hardis Mermaid style.

## Examples

### Flat Config override
```yaml
mermaidTheme:
  decisionColor: "#8ECAE6"
  decisionTextColor: "#023047"
  actionColor: "#FFB703"
  actionTextColor: "#3D2E00"
  screenColor: "#CDEAC0"
  screenTextColor: "#173B30"
  addedColor: "#2A9D8F"
  addedTextColor: "white"
  addedLinkColor: "#2A9D8F"
  removedColor: "#E63946"
  removedTextColor: "white"
  removedLinkColor: "#E63946"
```
### "Salesforce" Nested Config override
```yaml
mermaidTheme:
  actionCalls:
    background: "#0176D3"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"
    mermaidOpen: "("
    mermaidClose: ")"

  assignments:
    background: "#DD7A01"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"
    mermaidOpen: "[\\"
    mermaidClose: "/]"

  collectionProcessors:
    background: "#DD7A01"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"
    mermaidOpen: "{{"
    mermaidClose: "}}"

  customErrors:
    background: "#BA0517"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"
    mermaidOpen: "("
    mermaidClose: ")"

  decisions:
    background: "#DD7A01"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"
    mermaidOpen: "{"
    mermaidClose: "}"

  loops:
    background: "#DD7A01"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"
    mermaidOpen: "{{"
    mermaidClose: "}}"

  recordCreates:
    background: "#F22B8C"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"
    mermaidOpen: "[("
    mermaidClose: ")]"

  recordDeletes:
    background: "#F22B8C"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"
    mermaidOpen: "[("
    mermaidClose: ")]"

  recordLookups:
    background: "#F22B8C"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"
    mermaidOpen: "[("
    mermaidClose: ")]"

  recordUpdates:
    background: "#F22B8C"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"
    mermaidOpen: "[("
    mermaidClose: ")]"

  recordRollbacks:
    background: "#F22B8C"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"
    mermaidOpen: "[("
    mermaidClose: ")]"
    
  screens:
    background: "#0176D3"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"
    mermaidOpen: "(["
    mermaidClose: "])"

  subflows:
    background: "#0176D3"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"
    mermaidOpen: "[["
    mermaidClose: "]]"

  startClass:
    background: "#00855C"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"

  endClass:
    background: "#BA0517"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"

  transforms:
    background: "#DD7A01"
    color: "#FFFFFF"
    stroke: "#E5E5E5"
    strokeWidth: "1px"
    mermaidOpen: "{{"
    mermaidClose: "}}"
```

### Diff Color override

```yaml
mermaidTheme:
  added:
    background: "#2E7D32"
    color: "white"
    lineColor: "#43A047"
    strokeWidth: "5px"

  removed:
    background: "#C62828"
    color: "white"
    lineColor: "#E53935"
    strokeWidth: "5px"

  changed:
    background: "#EF6C00"
    color: "white"
    lineColor: "#FB8C00"
    strokeWidth: "5px"
```

## Regenerate docs

After updating `config/.sfdx-hardis.yml`, regenerate the relevant documentation:

```sh
sf hardis doc project2markdown
```

For a single Flow:

```sh
sf hardis doc flow2markdown --inputfile force-app/main/default/flows/MyFlow.flow-meta.xml
```

For Flow history diffs:

```sh
sf hardis project generate flow-git-diff --flow force-app/main/default/flows/MyFlow.flow-meta.xml --commit-before allStates
```

If you run these commands in CI, the same `mermaidTheme` overrides are applied automatically there as well.
