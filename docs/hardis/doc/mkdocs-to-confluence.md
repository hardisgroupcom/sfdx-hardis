<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:mkdocs-to-confluence

## Description

## Command Behavior

**Reads MkDocs markdown pages and navigation structure, converts them into Confluence-compatible format, and publishes them to a Confluence space.**

This command automates the deployment of your project's MkDocs documentation to Atlassian Confluence, preserving the navigation hierarchy as nested Confluence pages. Links between pages and embedded images are automatically converted to work in Confluence.

Key operations performed:

- **MkDocs Navigation Parsing:** Reads the `mkdocs.yml` file to extract the navigation structure (`nav` key), which defines the page hierarchy.
- **Markdown to Confluence Conversion:** Converts each Markdown file into Confluence Storage Format (XHTML), handling:
  - **Internal links:** Rewrites `[text](page.md)` links into Confluence page links using `<ac:link>` macros.
  - **Images:** Uploads images as attachments to the corresponding Confluence page and replaces Markdown image references with `<ac:image>` macros.
  - **Code blocks:** Converts fenced code blocks into Confluence `<ac:structured-macro>` code blocks.
  - **Standard Markdown:** Converts headings, lists, tables, bold, italic, and other formatting to Confluence-compatible XHTML.
- **Page Hierarchy:** Creates Confluence pages mirroring the MkDocs navigation tree, with parent-child relationships matching the nav structure.
- **Incremental Updates:** If a page already exists in Confluence, it is updated (with an incremented version number) rather than duplicated.

**Environment Variables for Confluence Configuration:**

Two authentication methods are supported: **Basic Auth** (username + API token) or **OAuth2 service account** (client credentials).

| Variable                          | Description                                                               | Default              |
| :-------------------------------- | :------------------------------------------------------------------------ | :------------------: |
| `CONFLUENCE_SPACE_KEY`           | Confluence space key where pages will be published                        | _Required_           |
| `CONFLUENCE_PARENT_PAGE_ID`      | ID of the parent page under which all doc pages will be created           | Space root           |
| `CONFLUENCE_PAGE_PREFIX`         | Prefix added to all page titles to avoid name collisions                  | `[Doc] `            |
| `CONFLUENCE_PAGE_SUFFIX`         | Suffix added to all page titles to avoid name collisions                  | _Empty_              |
| **Basic Auth**                    |                                                                           |                      |
| `CONFLUENCE_BASE_URL`            | Confluence instance base URL (e.g. `https://mycompany.atlassian.net`)    | _Required for Basic_ |
| `CONFLUENCE_USERNAME`            | Confluence username (email for Confluence Cloud)                          | _Required for Basic_ |
| `CONFLUENCE_TOKEN`               | Confluence API token (personal access token)                              | _Required for Basic_ |
| **OAuth2 (service account)**      |                                                                           |                      |
| `CONFLUENCE_CLIENT_ID`           | Atlassian OAuth2 client ID                                                | _Required for OAuth_ |
| `CONFLUENCE_CLIENT_SECRET`       | Atlassian OAuth2 client secret                                            | _Required for OAuth_ |
| `CONFLUENCE_BASE_URL`            | Confluence instance base URL, used to match the right Atlassian resource  | First available      |

For `CONFLUENCE_SPACE_KEY`, `CONFLUENCE_PARENT_PAGE_ID`, `CONFLUENCE_PAGE_PREFIX`, and `CONFLUENCE_PAGE_SUFFIX`,
the command first checks a language-scoped variable for the current i18n locale, then falls back to the default one.
Examples: `CONFLUENCE_SPACE_KEY_FR`, `CONFLUENCE_PARENT_PAGE_ID_NL`, `CONFLUENCE_PAGE_SUFFIX_PT_BR`.

**Prerequisite:** The documentation must have been previously generated using `sf hardis:doc:project2markdown`.

More information can be found in the [Documentation section](https://sfdx-hardis.cloudity.com/salesforce-project-documentation/).

<details markdown="1">
<summary>Technical explanations</summary>

The command orchestrates interactions with MkDocs configuration, Markdown conversion, and the Confluence REST API:

- **MkDocs Navigation Parsing:** Uses `readMkDocsFile()` to load and parse `mkdocs.yml`, then recursively traverses the `nav` structure to build a flat list of pages with their hierarchy (parent-child relationships).
- **Markdown to Confluence Storage Format:** Each Markdown file is read from the `docs/` folder and converted to Confluence Storage Format (a subset of XHTML). The conversion handles:
  - Fenced code blocks (```) → `<ac:structured-macro ac:name="code">` with language parameter.
  - Internal page links `[text](file.md)` → `<ac:link><ri:page ri:content-title="..." /><ac:plain-text-link-body><![CDATA[text]]></ac:plain-text-link-body></ac:link>`.
  - Images `![alt](path)` → uploaded as attachments, then referenced with `<ac:image><ri:attachment ri:filename="..." /></ac:image>`.
  - Tables, headings, lists, bold, italic → standard HTML equivalents compatible with Confluence storage format.
- **Confluence REST API v2:** Uses the Confluence Cloud REST API (`/wiki/api/v2/`) for page operations (create/update) and v1 API (`/wiki/rest/api/`) for attachment uploads:
  - Searches for existing pages by title within the target space.
  - Creates new pages or updates existing ones with the converted content and correct parent-child relationships.
  - Uploads image files as attachments to their respective pages.
- **Authentication:** Supports two modes:
  - **Basic Auth:** Uses HTTP Basic Auth with `CONFLUENCE_USERNAME` and `CONFLUENCE_TOKEN`.
  - **OAuth2 (service account):** Exchanges `CONFLUENCE_CLIENT_ID` / `CONFLUENCE_CLIENT_SECRET` for a Bearer token via the Atlassian OAuth2 client-credentials endpoint (`https://api.atlassian.com/oauth/token`). The Atlassian Cloud ID is resolved from the accessible-resources endpoint and the base URL is automatically set to `https://api.atlassian.com/ex/confluence/{cloudId}`.
- **Error Handling:** Reports per-page errors without stopping the entire process, allowing partial deployments. A summary of failed pages is shown at the end.
</details>


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|confluencePagePrefix|option|Confluence page title prefix. Overrides CONFLUENCE_PAGE_PREFIX[_<LANG>] env vars||||
|confluencePageSuffix|option|Confluence page title suffix. Overrides CONFLUENCE_PAGE_SUFFIX[_<LANG>] env vars||||
|confluenceParentPageId|option|Confluence parent page ID. Overrides CONFLUENCE_PARENT_PAGE_ID[_<LANG>] env vars||||
|confluenceSpaceKey|option|Confluence space key. Overrides CONFLUENCE_SPACE_KEY[_<LANG>] env vars||||
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:doc:mkdocs-to-confluence
```


