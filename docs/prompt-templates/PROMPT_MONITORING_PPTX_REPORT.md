---
title: PROMPT_MONITORING_PPTX_REPORT
description: Prompt template for PROMPT_MONITORING_PPTX_REPORT
---

# PROMPT_MONITORING_PPTX_REPORT

## Variables
| Name                   | Description                                                                   | Example                                                                                       |
|:-----------------------|:------------------------------------------------------------------------------|:----------------------------------------------------------------------------------------------|
| **NOTIFICATIONS_JSON** | JSON array of all monitoring notification messages collected during this run. | `[{"type":"ORG_LIMITS","severity":"warning","text":"Org limits are approaching thresholds"}]` |
| **AI_SUMMARY**         | AI-generated executive summary of the monitoring findings (markdown).         | `The org is in good health overall, with a few warnings about approaching limits.`            |
| **ORG_URL**            | The Salesforce org instance URL being monitored.                              | `https://mycompany.my.salesforce.com`                                                         |
| **DATE**               | The date of the monitoring run (YYYY-MM-DD).                                  | `2026-04-22`                                                                                  |
| **OUTPUT_FILE_PATH**   | The absolute file path where the generated .pptx file must be written.        | `/workspace/hardis-report/MonitoringReport_2026-04-22.pptx`                                   |

## Prompt

```
You are a report generator. Your task is to create a PowerPoint (.pptx) file summarizing Salesforce org monitoring results.

## IMPORTANT RULES

- You MUST generate exactly one .pptx file at this path: {{OUTPUT_FILE_PATH}}
- Use the `pptxgenjs` npm package (already installed) to create the file
- Write a Node.js script, execute it, then delete the script
- Do NOT modify any other files in the project

## PRESENTATION STRUCTURE

The presentation MUST follow this exact structure:

### Slide 1 - Title
- Title: "Salesforce Org Monitoring Report"
- Subtitle: "{{ORG_URL}} - {{DATE}}"
- Use a dark blue background (#001135) with white text

### Slide 2 - Executive Summary
- Title: "Executive Summary"
- Body: the AI summary below, reformatted as concise bullet points (5-8 bullets max)
- Use blue header (#0053FF), dark text on white background

### Slide 3 - Critical & Error Findings
- Title: "Critical & Error Findings" (red header #D32F2F)
- A table with columns: Check Type | Severity | Finding
- Include all notifications with severity "critical" or "error"
- If none, display "No critical or error findings - great!"

### Slide 4 - Warnings
- Title: "Warnings" (orange header #F9A825)
- Same table format as Slide 3
- Include all notifications with severity "warning"
- If none, display "No warnings detected"

### Slide 5 - Info & Positive Findings
- Title: "Info & Positive Findings" (green header #2E7D32)
- Same table format
- Include all notifications with severity "info" or "success"
- If none, display "No additional findings"

### Slide 6 - Risk Assessment & Recommendations
- Title: "Risk Assessment & Recommendations"
- For each finding with severity critical/error/warning, write:
  - What was detected (1 line)
  - What can happen if not addressed (1 line, in bold or red)
  - Recommended action (1 line)
- Group by urgency: must fix now → should fix this week → can wait
- Limit to top 10 most important items

### Slide 7 - Summary Metrics
- Title: "Key Metrics"
- A table summarizing numeric data extracted from the notifications:
  - Org limits usage percentages
  - Error/warning counts
  - Unused licenses count
  - Any other numeric metrics found in the data
- If no numeric data is available, skip this slide

## STYLE GUIDELINES

- Font: use default system fonts (Arial or Calibri)
- Header font size: 24pt, bold
- Body font size: 11pt
- Table header: white text on colored background matching the section
- Keep text concise - max 300 characters per table cell
- Slide dimensions: standard 10x7.5 inches

## DATA

You are allowed to read report data found in the files mentioned in the following variables.

### AI Summary:
{{AI_SUMMARY}}

### Monitoring Notifications (JSON):
{{NOTIFICATIONS_JSON}}

{{VARIABLE_ADDITIONAL_INSTRUCTIONS}}

```

## How to override

To define your own prompt text, you can define a local file **config/prompt-templates/PROMPT_MONITORING_PPTX_REPORT.md**

> For backward compatibility, **config/prompt-templates/PROMPT_MONITORING_PPTX_REPORT.txt** is also supported, but **.md is preferred**.

You can also use the command `sf hardis:doc:override-prompts` to automatically create all override template files at once.

If you do so, please don't forget to use the replacement variables :)
