<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:clean:systemdebug

## Description


## Command Behavior

**Removes or comments out `System.debug()` statements from Apex classes and triggers in your Salesforce DX project.**

This command helps maintain clean and optimized Apex code by eliminating debug statements that are often left in production code. While `System.debug()` is invaluable during development, it can impact performance and expose sensitive information if left in deployed code.

Key functionalities:

- **Targeted File Scan:** Scans all Apex class (.cls) and trigger (.trigger) files within the specified root folder (defaults to `force-app`).
- **Conditional Action:**
  - **Comment Out (default):** By default, it comments out `System.debug()` lines by prepending // to them.
  - **Delete (`--delete` flag):** If the `--delete` flag is used, it completely removes the lines containing `System.debug()`.
- **Exclusion:** Lines containing `NOPMD` are ignored, allowing developers to intentionally keep specific debug statements.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File Discovery:** Uses `glob` to find all Apex class and trigger files.
- **Content Reading:** Reads the content of each Apex file line by line.
- **Pattern Matching:** Checks each line for the presence of `System.debug` (case-insensitive).
- **Line Modification:**
  - If `System.debug` is found and the `--delete` flag is not used, it modifies the line to comment out the debug statement.
  - If `System.debug` is found and the `--delete` flag is used, it removes the line entirely.
- **File Writing:** If any changes are made to a file, the modified content is written back to the file using `fs.writeFile`.
- **Logging:** Provides a summary of how many files were cleaned.
</details>


## Parameters

| Name          |  Type   | Description                                                   |  Default  | Required | Options |
|:--------------|:-------:|:--------------------------------------------------------------|:---------:|:--------:|:-------:|
| delete<br/>-d | boolean | Delete lines with System.debug                                |           |          |         |
| flags-dir     | option  | undefined                                                     |           |          |         |
| folder<br/>-f | option  | Root folder                                                   | force-app |          |         |
| json          | boolean | Format output as json.                                        |           |          |         |
| skipauth      | boolean | Skip authentication check when a default username is required |           |          |         |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration     |           |          |         |

## Examples

```shell
$ sf hardis:project:clean:systemdebug
```


