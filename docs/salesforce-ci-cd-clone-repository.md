---
title: Clone git repository of a Salesforce project
description: Learn how to clone a Salesforce repository on your computer
---
<!-- markdownlint-disable MD013 -->

- [Pre-requisites](#pre-requisites)
- [Clone the repository](#clone-the-repository)
  - [From the Git server UI](#from-the-git-server-ui)
  - [From Visual Studio Code](#from-visual-studio-code)
___

## Pre-requisites

You need to access to a Git repository and the url of the repository to clone.

The [release manager](salesforce-ci-cd-release-home.md) of the project can provide it.

It looks like the following: `https://github.com/trailheadapps/dreamhouse-lwc.git`

___

## Clone the repository

> If you don't have a folder for your git repositories, create a **C:\git** folder and use it as destination for your git clones !

### From the Git server UI

Git providers UIs sometimes have a button **Clone -> Open In VsCode**

If you can use it, use it :)

#### Gitlab

![](assets/images/open-vs-code-gitlab.jpg)

If later you are prompted for username and password, you might need to create a Personal Access Token ([video tuto here](https://www.youtube.com/watch?v=9y5VmmYHuIg)) and use it as password.

If later, it prompts several times the same password in VsCode, run the following command line

`git config --global credential.helper store`

#### Azure

![](assets/images/open-vs-code-azure.jpg)



### From Visual Studio Code

- In Visual Studio Code, hit **CTRL+Shirt+P** then look for command **Git clone** then click to select it.

![](assets/images/git-clone-1.jpg){ align=center }

- Paste the **url of your git repository** then hit **ENTER**
  - If you are asked for a directory and you don't have one yet, create an empty directory at the root of your hard drive, and select it (examples: `C:/git` or `D:/git` )

![](assets/images/git-clone-2.jpg){ align=center }

- Click on the `Open` notification in VsCode

![](assets/images/git-clone-3.jpg){ align=center }

- You are now ready to [create a new task](salesforce-ci-cd-create-new-task.md) !

![](assets/images/git-clone-4.jpg){ align=center }

