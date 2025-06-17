<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:work:new

## Description

Assisted menu to start working on a Salesforce task.

Advanced instructions in [Create New Task documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-create-new-task/)

At the end of the command, it will allow you to work on either a scratch org or a sandbox, depending on your choices.

Under the hood, it can:

- Make **git pull** to be up to date with target branch
- Create **new git branch** with formatted name (you can override the choices using .sfdx-hardis.yml property **branchPrefixChoices**)
- Create and initialize a scratch org or a source-tracked sandbox (config can be defined using `config/.sfdx-hardis.yml`):
- (and for scratch org only for now):
  - **Install packages**
      - Use property `installedPackages`
    - **Push sources**
    - **Assign permission sets**
      - Use property `initPermissionSets`
    - **Run apex initialization scripts**
      - Use property `scratchOrgInitApexScripts`
    - **Load data**
      - Use property `dataPackages`

## Override .sfdx-hardis.yml config

### availableTargetBranches

By default, there is only one target branch (value of property **developmentBranch**).

You can define multiple target branches (for the future Pull Request) by setting the property **availableTargetBranches** in your .sfdx-hardis.yml file.

The selected branch will checked out and be used as base to create the user new feature branch.

Examples:

```yaml
availableTargetBranches:
  - integration
  - preprod
```

```yaml
availableTargetBranches:
  - integration,Select this to work from the integration branch (project stream)
  - preprod,Select this to work from the preprod branch (run stream)
```

### availableProjects

You can add a first question "What is the project your task is for" if you define a property **availableProjects**

The select will be used as first part of the git branch name. (ex: france/features/dev/JIRA123-webservice-get-account)

Examples:

```yaml
availableProjects:
  - build
  - run
  - some-big-project
  - france
  - uk
```

```yaml
availableProjects:
  - build,Select this to work on the build project
  - run,Select this to work on the run project
  - some-big-project,Select this to work on the some big project
  - france,Select this to work on the France project
  - uk,Select this to work on the UK project
```

### newTaskNameRegex

If you want to force a specific format for the task name, you can define a property **newTaskNameRegex** in your .sfdx-hardis.yml file.

Please also define a property **newTaskNameRegexExample** to give an example to the user.

Example:

```yaml
newTaskNameRegex: '^[A-Z]+-[0-9]+ .*'
newTaskNameRegexExample: 'MYPROJECT-123 Update account status validation rule'
```

### sharedDevSandboxes

If contributors can share dev sandboxes, let's not ask them if they want to overwrite their colleagues' changes when creating a new task :)


## Parameters

|Name|Type|Description|Default|Required|Options|
|:---|:--:|:----------|:-----:|:------:|:-----:|
|debug<br/>-d|boolean|Activate debug mode (more logs)||||
|flags-dir|option|undefined||||
|json|boolean|Format output as json.||||
|skipauth|boolean|Skip authentication check when a default username is required||||
|target-dev-hub<br/>-v|option|undefined||||
|target-org<br/>-o|option|undefined|nicolas.vuillamy@cloudity.com.playnico|||
|websocket|option|Websocket host:port for VsCode SFDX Hardis UI integration||||

## Examples

```shell
$ sf hardis:work:new
```


