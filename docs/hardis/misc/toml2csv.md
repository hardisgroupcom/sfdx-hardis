<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:misc:toml2csv

## Description


## Command Behavior

**Splits a TOML (Tom's Obvious, Minimal Language) file into multiple CSV files, applying transformations and filters based on a JSON configuration.**

This command is designed for data processing workflows where data is initially stored in a TOML-like format and needs to be converted into structured CSV files for import into Salesforce or other systems. It offers powerful capabilities for data manipulation and cleansing during the conversion process.

Key functionalities:

- **TOML Parsing:** Reads an input TOML file, identifying sections (e.g., `[COMPTES]`) and processing data lines within each section.
- **Configurable Transformations:** Applies transformations to individual data fields based on a JSON configuration file (`transfoConfig.json`). This can include:
  - **Date Formatting:** Reformatting date strings to a desired output format.
  - **Enum Transcoding:** Mapping input values to predefined output values using lookup tables (enums).
  - **Concatenation:** Combining multiple input fields into a single output field.
  - **Record Type ID Resolution:** Dynamically retrieving Salesforce Record Type IDs.
- **Data Filtering:** Filters data lines based on specified criteria (e.g., date ranges, parent ID existence, column values), allowing you to exclude irrelevant data from the output.
- **Duplicate Removal:** Optionally removes duplicate lines from the output CSV files.
- **Error Handling and Reporting:** Catches transformation errors, logs them, and can output problematic lines to separate error CSV files for review.
- **CSV Output:** Generates one or more CSV files, with configurable separators and headers, ready for Salesforce Data Loader or other import tools.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **File I/O:** Uses `fs-extra` for file system operations (reading TOML, writing CSVs, creating directories) and `readline` for efficient line-by-line processing of large TOML files.
- **Configuration Loading:** Reads and parses the `transfoConfig.json` file, which defines the mapping rules, transformations, and filters. It also loads external enum files if specified in the configuration.
- **Data Processing Pipeline:** Iterates through each line of the TOML file:
  - Identifies section headers to determine the current data context.
  - Parses data lines based on the input separator.
  - Applies filters defined in `transfoConfig` to decide whether to process or skip a line.
  - Performs data transformations (date formatting, enum lookups, concatenations) as specified in the `transfoConfig`.
  - Resolves Salesforce Record Type IDs by querying the target org using `getRecordTypeId`.
  - Formats the output CSV cells, handling special characters and separators.
  - Writes the transformed data to the appropriate CSV output stream.
- **Error Management:** Catches exceptions during transformation and logs detailed error messages, including the problematic line and the reason for the error.
- **Progress Indication:** Uses `ora` for a command-line spinner to provide visual feedback on the processing progress.
- **Statistics Collection:** Tracks various statistics, such as the number of processed lines, successful lines, error lines, and filtered lines, providing a summary at the end.
- **File Copying:** Optionally copies generated CSV files to other specified locations.
</details>


## Parameters

| Name                  |  Type   | Description                                                              | Default | Required | Options |
|:----------------------|:-------:|:-------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                          |         |          |         |
| filtersections<br/>-l | option  | List of sections to process (if not set, all sections will be processed) |         |          |         |
| flags-dir             | option  | undefined                                                                |         |          |         |
| json                  | boolean | Format output as json.                                                   |         |          |         |
| outputdir<br/>-z      | option  | Output directory                                                         |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required            |         |          |         |
| skiptransfo<br/>-s    | boolean | Do not apply transformation to input data                                |         |          |         |
| target-org<br/>-o     | option  | undefined                                                                |         |          |         |
| tomlfile<br/>-f       | option  | Input TOML file path                                                     |         |          |         |
| transfoconfig<br/>-t  | option  | Path to JSON config file for mapping and transformation                  |         |          |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration                |         |          |         |

## Examples

```shell
$ sf hardis:misc:toml2csv --tomlfile 'D:/clients/toto/V1_full.txt' 
```

```shell
$ sf hardis:misc:toml2csv --skiptransfo --tomlfile 'D:/clients/toto/V1_full.txt' 
```

```shell
$ sf hardis:misc:toml2csv --skiptransfo --tomlfile 'D:/clients/toto/V1_full.txt' --outputdir 'C:/tmp/rrrr'
```

```shell
$ NODE_OPTIONS=--max_old_space_size=9096 sf hardis:misc:toml2csv --skiptransfo --tomlfile './input/V1.txt' --outputdir './output' --filtersections 'COMPTES,SOUS'
```


