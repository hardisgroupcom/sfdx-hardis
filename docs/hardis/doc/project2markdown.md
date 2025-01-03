<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:project2markdown

## Description

Generates a markdown documentation from a SFDX project

- Package.xml files
- Source Packages
- sfdx-hardis configuration
- Installed packages

Can work on any sfdx project, no need for it to be a sfdx-hardis flavored one.

Generates markdown files will be written in **docs** folder (except README.md where a link to doc index is added)

To read Flow documentations if your markdown reader doesn't handle MermaidJS syntax, this command could require @mermaid-js/mermaid-cli

- Run `npm install @mermaid-js/mermaid-cli --global` if puppeteer works in your environment
- It can also be run as a docker image

Both modes will be tried by default, but you can also force one of them by defining environment variable `MERMAID_MODES=docker` or `MERMAID_MODES=cli`

_sfdx-hardis docker image is alpine-based and does not succeed to run mermaid/puppeteer: if you can help, please submit a PR !_

If Flow history doc always display a single state, you probably need to update your workflow configuration:

- on Gitlab: Env variable [`GIT_FETCH_EXTRA_FLAGS: --depth 10000`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/.gitlab-ci.yml#L11)
- on GitHub: [`fetch-depth: 0`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/.github/workflows/org-monitoring.yml#L58)
- on Azure: [`fetchDepth: "0"`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/azure-pipelines.yml#L39)
- on Bitbucket: [`step: clone: depth: full`](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/monitoring/bitbucket-pipelines.yml#L18)

![Screenshot flow doc](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-flow-doc.jpg)

![Screenshot project documentation](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-project-doc.jpg)

![Screenshot project documentation](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-project-doc-2.jpg)

## Doc HTML Pages

To read the documentation as HTML pages, run the following code (you need python on your computer)

```python
pip install mkdocs-material mdx_truly_sane_lists
mkdocs serve
```

To just generate HTML pages that you can host anywhere, run `mkdocs build`



## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|diff-only|boolean|Generate documentation only for changed files (used for monitoring)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||
|with-history|boolean|Generate a markdown file with the history diff of the Flow||||

## Examples

```shell
$ sf hardis:doc:project2markdown
```

```shell
$ sf hardis:doc:project2markdown --with-history
```


