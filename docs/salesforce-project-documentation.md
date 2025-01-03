---
title: Generate Salesforce Project Documentation
description: Learn how to generate Salesforce project documentation, including Flows Visual Differences in History
---
<!-- markdownlint-disable MD013 -->

## Salesforce Project Documentation

With a single command, you can generate a Web Site documenting your Salesforce metadatas (like Flows)

![](assets/images/project-documentation.gif)

## How To

- Use the Git repository containing your SFDX project, or create it easily using [sfdx-hardis Monitoring](salesforce-monitoring-home.md), or simply calling [BackUp command](hardis/org/monitor/backup.md)

- Call VsCode SFDX-Hardis command [**Documentation Generation > Generate Project Documentation (with history)**](hardis/doc/project2markdown.md)
  - Corresponding command line: `sf hardis:doc:project2markdown --with-history`

- Run command **Documentation Generation > Run local HTML Doc Pages** (Note: you need  [Python](https://www.python.org/downloads/) on your computer)
  - Corresponding command lines: `pip install mkdocs-material mdx_truly_sane_lists`, then `mkdocs serve`

- Open <http://127.0.0.1:8000/> in your Web Browser

