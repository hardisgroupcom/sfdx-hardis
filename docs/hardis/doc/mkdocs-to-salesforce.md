<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:doc:mkdocs-to-salesforce

## Description


## Command Behavior
**Generates MkDocs HTML pages and deploys them to a Salesforce org as a static resource, Visualforce page, and Custom Tab.**

This command provides a convenient way to host your project's documentation directly within Salesforce, making it easily accessible to users. It automates the entire process of converting your MkDocs project into a deployable Salesforce package.

Key operations performed:

- **MkDocs HTML Generation:** Builds the MkDocs project into static HTML pages. It can use a locally installed `mkdocs-material` or a `mkdocs` Docker image.
- **Salesforce Metadata Creation:** Creates the necessary Salesforce metadata components:
  - A **Static Resource** to store the generated HTML, CSS, and JavaScript files.
  - A **Visualforce Page** that embeds the static resource, allowing it to be displayed within Salesforce.
  - A **Custom Tab** to provide a user-friendly entry point to the documentation from the Salesforce navigation.
  - A **Permission Set** to grant access to the Visualforce page and Custom Tab.
- **Metadata Deployment:** Deploys these newly created metadata components to the specified Salesforce org.
- **Permission Set Assignment:** Assigns the newly created permission set to the current user, ensuring immediate access to the documentation.
- **Browser Opening (Non-CI):** Opens the Custom Tab in your default browser if the command is not run in a CI/CD environment.

**Prerequisite:** The documentation must have been previously generated using `sf hardis:doc:project2markdown --with-history`.

**Customization:**

- You can specify the type of documentation to generate (e.g., `CICD` or `Monitoring`) using the `--type` flag. The default is `CICD`.
- You can override default styles by customizing your `mkdocs.yml` file.

More information can be found in the [Documentation section](${CONSTANTS.DOC_URL_ROOT}/salesforce-project-documentation/).
<details markdown="1">
<summary>Technical explanations</summary>

The command orchestrates interactions with MkDocs, Salesforce CLI, and file system operations:

- **MkDocs Integration:** It first modifies the `mkdocs.yml` file to ensure compatibility with Salesforce static resources (e.g., setting `use_directory_urls` to `false`). Then, it calls `generateMkDocsHTML()` to build the static HTML content.
- **Temporary SFDX Project:** It creates a temporary SFDX project using `createTempDir` and `createBlankSfdxProject` to stage the generated Salesforce metadata before deployment.
- **Metadata Generation:** It dynamically creates the XML metadata files for the Static Resource, Visualforce Page, Custom Tab, and Permission Set. The HTML content from the MkDocs build is moved into the static resource folder.
- **Salesforce CLI Deployment:** It constructs and executes a `sf project deploy start` command to deploy the generated metadata to the target Salesforce org. It intelligently adds `--test-level RunLocalTests` for production orgs and `--test-level NoTestRun` for sandboxes.
- **Permission Set Assignment:** After successful deployment, it calls `initPermissionSetAssignments` to assign the newly created permission set to the current user.
- **Browser Launch:** For non-CI environments, it uses `execCommand` to open the deployed Custom Tab in the user's default browser.
- **Error Handling and Cleanup:** It includes error handling for deployment failures (e.g., static resource size limits) and ensures that the `mkdocs.yml` file is restored to its original state after execution.
- **File System Operations:** It extensively uses `fs-extra` for file manipulation, including creating directories, moving files, and writing XML content.
</details>


## Parameters

| Name              |  Type   | Description                                                   | Default | Required |       Options       |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------------------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |                     |
| flags-dir         | option  | undefined                                                     |         |          |                     |
| json              | boolean | Format output as json.                                        |         |          |                     |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |                     |
| target-org<br/>-o | option  | undefined                                                     |         |          |                     |
| type<br/>-t       | option  | Type of the documentation to generate. Default is "all"       |  CICD   |          | CICD<br/>Monitoring |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |                     |

## Examples

```shell
$ sf hardis:doc:mkdocs-to-salesforce
```


