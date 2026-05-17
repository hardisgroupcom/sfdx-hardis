<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hello:world

## Description


## Command Behavior

**Says hello to the world or a specified person.**

This is a simple command used for demonstration purposes. It outputs a greeting message to the console.

Key functionalities:

- **Customizable Greeting:** You can specify a name using the `--name` flag to personalize the greeting.
- **Timestamp:** The greeting includes the current date.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Flag Parsing:** It parses the `--name` flag to get the recipient of the greeting.
- **Date Retrieval:** It gets the current date using `new Date().toDateString()`.
- **Console Output:** It constructs the greeting message using the provided name and the current date, and then logs it to the console using `this.log()`.
</details>


## Parameters

| Name        |  Type   | Description                             | Default | Required | Options |
|:------------|:-------:|:----------------------------------------|:-------:|:--------:|:-------:|
| flags-dir   | option  | undefined                               |         |          |         |
| json        | boolean | Format output as json.                  |         |          |         |
| name<br/>-n | option  | This person can be anyone in the world! |  World  |          |         |

## Examples

```shell
Say hello to the world:
<%= config.bin %> <%= command.id %>
```

```shell
Say hello to someone you know:
<%= config.bin %> <%= command.id %> --name Astro
```


