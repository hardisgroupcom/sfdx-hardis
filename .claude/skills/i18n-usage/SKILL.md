---
name: i18n-usage
description: Code examples and patterns for using i18n translations in sfdx-hardis source code (uxLog, uxLogTable, prompts, markers). Use when adding or modifying user-visible strings.
user-invocable: false
---

# i18n Usage Patterns

## Import

```typescript
import { t } from "../../../common/utils/i18n.js";
```

## uxLog

```typescript
// Correct
uxLog("action", this, c.cyan(t("deployingMetadata", { metadata: name })));

// Wrong -- hardcoded English string
uxLog("action", this, c.cyan(`Deploying metadata ${name}...`));
```

## uxLogTable

```typescript
import { uxLogTable } from "../../../common/utils/uxLog.js";

uxLogTable(
  this,
  [{ name: "My Flow", type: "Flow", status: "Active" }],
  [
    { key: "name", label: t("name") },
    { key: "type", label: t("type") },
    { key: "status", label: t("status") },
  ]
);
```

## prompts()

```typescript
const res = await prompts({
  type: "select",
  name: "value",
  message: t("selectEnvironment"),
  description: t("selectEnvironmentDescription"),
  choices: [
    { title: t("choiceProduction"), value: "prod" },
    { title: t("choiceSandbox"), value: "sandbox" },
  ],
});
```

## sendReportFileMessage

```typescript
WebSocketClient.sendReportFileMessage(url, t("slackIntegration"), "docUrl");
```

## sendProgressStartMessage

```typescript
WebSocketClient.sendProgressStartMessage(t("collectingData"), items.length);
```

## Markdown Table Headers

Translate column names individually, not the whole header:

```typescript
const header = `| ${t("name")} | ${t("type")} | ${t("description")} |`;
```

## Markers

Do NOT translate `[]` markers. Keep them as hardcoded literals and concatenate:

```typescript
uxLog("action", this, c.cyan("[MyMarker] " + t("someMessage")));
```
