<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:create

## Description


## Command Behavior

**Creates and fully initializes a Salesforce scratch org with complete development environment setup.**

This command is a comprehensive scratch org provisioning tool that automates the entire process of creating, configuring, and initializing a Salesforce scratch org for development work. It handles everything from basic org creation to advanced configuration including package installation, metadata deployment, and data initialization.

Key functionalities:

- **Intelligent Org Management:** Automatically generates unique scratch org aliases based on username, git branch, and timestamp, with options to reuse existing orgs or force creation of new ones.
- **Scratch Org Pool Integration:** Supports fetching pre-configured scratch orgs from pools for faster development cycles and CI/CD optimization.
- **Custom Scratch Definition:** Dynamically builds project-scratch-def.json files with user-specific configurations including email, username patterns, and org shape settings (set variable **SCRATCH_ORG_SHAPE** to use org shapes).
- **Package Installation:** Automatically installs all configured packages defined in `installedPackages` configuration property.
- **Metadata Deployment:** Pushes source code and deploys metadata using optimized deployment strategies for scratch org environments.
- **Permission Set Assignment:** Assigns specified permission sets defined in `initPermissionSets` configuration to the scratch org user.
- **Apex Script Execution:** Runs custom Apex initialization scripts defined in `scratchOrgInitApexScripts` for org-specific setup.
- **Data Loading:** Loads initial data using SFDMU data packages from `dataPackages` configuration for realistic development environments.
- **User Configuration:** Automatically configures the scratch org admin user with proper names, email, country settings, and marketing user permissions.
- **Password Generation:** Creates and stores secure passwords for easy scratch org access during development.
- **CI/CD Integration:** Provides specialized handling for continuous integration environments including automated cleanup and pool management.
- **Error Handling:** Comprehensive error recovery including scratch org cleanup on failure and detailed troubleshooting messages.

The command configuration can be customized using:

- `config/.sfdx-hardis.yml` file with properties like `installedPackages`, `initPermissionSets`, `scratchOrgInitApexScripts`, and `dataPackages`.
- Environment variable **SCRATCH_ORG_SHAPE** with shape org id, if you want to use org shapes

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Configuration Management:** Loads hierarchical configuration from `.sfdx-hardis.yml`, branch-specific, and user-specific configuration files using `getConfig('user')`.
- **Alias Generation Logic:** Creates intelligent scratch org aliases using username, git branch, timestamp patterns with CI and pool prefixes for different environments.
- **Scratch Org Definition Building:** Dynamically constructs `project-scratch-def.json` with user email, custom usernames, org shapes, and feature flags like StateAndCountryPicklist and MarketingUser.
- **Pool Integration:** Implements scratch org pool fetching using `fetchScratchOrg` for rapid org provisioning in development and CI environments.
- **Salesforce CLI Integration:** Executes `sf org create scratch` commands with proper parameter handling including wait times, duration, and dev hub targeting.
- **Package Installation Pipeline:** Uses `installPackages` utility to install managed and unmanaged packages with dependency resolution and error handling.
- **Metadata Deployment:** Leverages `initOrgMetadatas` for optimized source pushing and metadata deployment specific to scratch org environments.
- **Permission Set Assignment:** Implements `initPermissionSetAssignments` for automated permission set assignment to scratch org users.
- **Apex Script Execution:** Runs custom Apex initialization scripts using `initApexScripts` for org-specific configuration and setup.
- **Data Loading Integration:** Uses SFDMU integration through `initOrgData` for comprehensive data loading from configured data packages.
- **User Management:** Performs SOQL queries and DML operations to configure scratch org users with proper names, emails, country codes, and permission flags.
- **Authentication Management:** Handles SFDX auth URL generation and storage for CI/CD environments and scratch org pool management.
- **Error Recovery:** Implements comprehensive error handling with scratch org cleanup, pool management, and detailed error messaging for troubleshooting.
- **WebSocket Integration:** Provides real-time status updates and file reporting through WebSocket connections for VS Code extension integration.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:scratch:create --agent --target-dev-hub mydevhub@example.com
```

In agent mode:

- The scratch org reuse confirmation prompt is skipped and a new org is always created.
- All other interactive prompts are skipped.


## Parameters

| Name                  |  Type   | Description                                                             | Default | Required | Options |
|:----------------------|:-------:|:------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent                 | boolean | Run in non-interactive mode for agents and automation                   |         |          |         |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                         |         |          |         |
| flags-dir             | option  | undefined                                                               |         |          |         |
| forcenew<br/>-n       | boolean | If an existing scratch org exists, do not reuse it but create a new one |         |          |         |
| json                  | boolean | Format output as json.                                                  |         |          |         |
| pool                  | boolean | Creates the scratch org for a scratch org pool                          |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required           |         |          |         |
| target-dev-hub<br/>-v | option  | undefined                                                               |         |          |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration               |         |          |         |

## Examples

```shell
$ sf hardis:scratch:create
```

```shell
$ sf hardis:scratch:create --agent
```


