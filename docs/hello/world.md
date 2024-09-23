<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hello:world

## Description

Say hello either to the world or someone you know.

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


