---
title: Clone git repository of a Salesforce project
description: Learn how to clone a Salesforce repository on your computer
---
<!-- markdownlint-disable MD013 -->

## Pré-requisites

You need to access to a Git repository and the url of the repository to clone.

The [release manager](salesforce-ci-cd-use.md#release-manager-guide) of the project can provide it.

It looks like the following: `https://github.com/trailheadapps/dreamhouse-lwc.git`

## Clone the repository

- In Visual Studio Code, hit **CTRL+Shirt+P** then look for command **Git clone** then click to select it.

![Git clone 1](assets/images/git-clone-1.jpg)

- Paste the **url of your git repository** then hit **ENTER**
  - If you are asked for a directory and you don't have one yet, create an empty directory at the root of your hard drive, and select it (examples: `C:/git` or `D:/git` )

![Git clone 2](assets/images/git-clone-2.jpg)

- Click on the `Open` notification in VsCode

![Git clone 3](assets/images/git-clone-3.jpg)

- You are now ready to [create a new task](salesforce-ci-cd-create-new-task.md) !

![Git clone 4](assets/images/git-clone-4.jpg)
