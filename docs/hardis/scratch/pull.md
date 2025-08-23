<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:pull

## Description


## Command Behavior

**Pulls metadata changes from your scratch org or source-tracked sandbox into your local project files.**

This command is essential for synchronizing your local development environment with the changes you've made directly in your Salesforce org. After pulling, you can then stage and commit the relevant files to your version control system.

Key features and considerations:

- **Underlying Command:** Internally, this command executes `sf project retrieve start` to fetch the metadata.
- **Error Handling:** If the pull operation encounters errors, it offers to automatically add the problematic items to your `.forceignore` file and then attempts to pull again, helping you resolve conflicts and ignore unwanted metadata.
- **Missing Updates:** If you don't see certain updated items in the pull results, you might need to manually retrieve them using the Salesforce Extension's **Org Browser** or the **Salesforce CLI** directly. Refer to the [Retrieve Metadatas documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-publish-task/#retrieve-metadatas) for more details.
- **Automatic Retrieval:** You can configure the `autoRetrieveWhenPull` property in your `.sfdx-hardis.yml` file to always retrieve specific metadata types (e.g., `CustomApplication`) that might not always be detected as updates by `project:retrieve:start`.

Example `.sfdx-hardis.yml` configuration for `autoRetrieveWhenPull`:
```yaml
autoRetrieveWhenPull:
  - CustomApplication:MyCustomApplication
  - CustomApplication:MyOtherCustomApplication
  - CustomApplication:MyThirdCustomApp
```

For a visual explanation of the process, watch this video:

<iframe width="560" height="315" src="https://www.youtube.com/embed/Ik6whtflmfY" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation focuses on robust metadata synchronization:

- **Salesforce CLI Wrapper:** It acts as a wrapper around the standard Salesforce CLI `sf project retrieve start` command, providing enhanced error handling and configuration options.
- **Force Source Pull Utility:** The core logic resides in the `forceSourcePull` utility function, which orchestrates the retrieval process, including handling `.forceignore` updates.
- **Configuration Integration:** It reads the `autoRetrieveWhenPull` setting from the project's `.sfdx-hardis.yml` to determine additional metadata to retrieve automatically.
- **User Feedback:** Provides clear messages to the user regarding the pull status and guidance for troubleshooting.
</details>


## Parameters

| Name              |  Type   | Description                                                   | Default | Required | Options |
|:------------------|:-------:|:--------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d      | boolean | Activate debug mode (more logs)                               |         |          |         |
| flags-dir         | option  | undefined                                                     |         |          |         |
| json              | boolean | Format output as json.                                        |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required |         |          |         |
| target-org<br/>-o | option  | undefined                                                     |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |         |          |         |

## Examples

```shell
$ sf hardis:scratch:pull
```


