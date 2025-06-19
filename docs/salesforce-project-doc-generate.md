---
title: Generate Salesforce Project Documentation
description: Learn how to generate Salesforce project documentation, including Flows Visual Differences in History
---
<!-- markdownlint-disable MD013 -->

## How To generate

- Use the Git repository containing your SFDX project, or create it easily using [sfdx-hardis Monitoring](salesforce-monitoring-home.md), or simply calling [BackUp command](hardis/org/monitor/backup.md)

- [Activate AI Integration](salesforce-ai-setup.md) (Optional but recommended)

- Call VsCode SFDX-Hardis command [**Documentation Generation > Generate Project Documentation (with history)**](hardis/doc/project2markdown.md)
  - Corresponding command line: `sf hardis:doc:project2markdown --with-history`

Here is a click by click tutorial to generate your documentation locally (but it's best to use sfdx-hardis monitoring once you are convinced ^^)

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/ZrVPN3jp1Ac" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

## Run Locally

- Run command **Documentation Generation > Run local HTML Doc Pages** (Note: you need  [Python](https://www.python.org/downloads/) on your computer)
  - Corresponding command lines: `pip install mkdocs-material mdx_truly_sane_lists`, then `mkdocs serve -v`
  - Alternative 1: `python -m pip install mkdocs-material mdx_truly_sane_lists`, then `python -m mkdocs serve -v`
  - Alternative 2: `py -m pip install mkdocs-material mdx_truly_sane_lists`, then `py -m mkdocs serve -v`

- Open <http://127.0.0.1:8000/> in your Web Browser