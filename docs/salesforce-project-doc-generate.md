---
title: Generate Salesforce Project Documentation
description: Learn how to generate Salesforce project documentation, including Flows Visual Differences in History
---
<!-- markdownlint-disable MD013 -->

## How to generate

- Use the git repository containing your SFDX project, or create it easily with [sfdx-hardis Monitoring](salesforce-monitoring-home.md), or simply by calling the [Backup command](hardis/org/monitor/backup.md)

- [Activate AI integration](salesforce-ai-setup.md) (optional but recommended)

- In the VS Code SFDX Hardis extension, run the command [**Documentation Generation > Generate Project Documentation (with history)**](hardis/doc/project2markdown.md)
  - Corresponding command line: `sf hardis:doc:project2markdown --with-history`

Here is a click-by-click tutorial to generate your documentation locally (once you are convinced, the best option is to let sfdx-hardis Monitoring generate it for you):

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/ZrVPN3jp1Ac" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

## Run Locally

- Run command **Documentation Generation > Run local HTML Doc Pages** (Note: you need [Python](https://www.python.org/downloads/) on your computer)
  - Corresponding command lines: `pip install zensical mdx_truly_sane_lists`, then `zensical serve`
  - Alternative 1: `python -m pip install zensical mdx_truly_sane_lists`, then `python -m zensical serve`
  - Alternative 2: `py -m pip install zensical mdx_truly_sane_lists`, then `py -m zensical serve`

- Open <http://127.0.0.1:8000/> in your web browser