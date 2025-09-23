### With IDE

You can install [Visual Studio Code](https://code.visualstudio.com/), then VSCode Extension [VsCode SFDX Hardis](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

Once installed, click on ![Hardis Group button](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/hardis-button.jpg) in VsCode left bar, click on **Install dependencies** and follow the additional installation instructions :)

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/install-dependencies-highlight.png)

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/install-dependencies-screenshot.png)

When you are all green, you are all good 😊

_You can also watch the video tutorial below_

[![Installation tutorial](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/play-install-tuto.png)](https://www.youtube.com/watch?v=LA8m-t7CjHA)

___

### As SFDX Plugin

#### Pre-requisites

- Install Node.js ([recommended version](https://nodejs.org/en/))
- Install Salesforce DX by running `npm install @salesforce/cli --global` command line

#### Plugin installation

```sh-session
sf plugins install sfdx-hardis
```

For advanced use, please also install dependencies

```sh-session
sf plugins install @salesforce/plugin-packaging
sf plugins install sfdx-git-delta
sf plugins install sfdmu
```

If you are using CI/CD scripts, use `echo y | sf plugins install ...` to bypass prompt.

___

### Docker

You can use sfdx-hardis docker images to run in CI.

> All our Docker images are checked for security issues with [MegaLinter by OX Security](https://megalinter.io/latest/)

- Linux **Alpine** based images (works on Gitlab)

  - Docker Hub

    - [**hardisgroupcom/sfdx-hardis:latest**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis) (with latest @salesforce/cli version)
    - [**hardisgroupcom/sfdx-hardis:latest-sfdx-recommended**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis) (with recommended @salesforce/cli version, in case the latest version of @salesforce/cli is buggy)

  - GitHub Packages (ghcr.io)

    - [**ghcr.io/hardisgroupcom/sfdx-hardis:latest**](https://github.com/hardisgroupcom/sfdx-hardis/pkgs/container/sfdx-hardis) (with latest @salesforce/cli version)
    - [**ghcr.io/hardisgroupcom/sfdx-hardis:latest-sfdx-recommended**](https://github.com/hardisgroupcom/sfdx-hardis/pkgs/container/sfdx-hardis) (with recommended @salesforce/cli version, in case the latest version of @salesforce/cli is buggy)

_See [Dockerfile](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/Dockerfile)_

- Linux **Ubuntu** based images (works on GitHub, Azure & Bitbucket)

    - [**hardisgroupcom/sfdx-hardis-ubuntu:latest**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis-ubuntu) (with latest @salesforce/cli version)
    - [**hardisgroupcom/sfdx-hardis-ubuntu:latest-sfdx-recommended**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis-ubuntu) (with recommended @salesforce/cli version, in case the latest version of @salesforce/cli is buggy)

  - GitHub Packages (ghcr.io)

    - [**ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:latest**](https://github.com/hardisgroupcom/sfdx-hardis/pkgs/container/sfdx-hardis-ubuntu) (with latest @salesforce/cli version)
    - [**ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:latest-sfdx-recommended**](https://github.com/hardisgroupcom/sfdx-hardis/pkgs/container/sfdx-hardis-ubuntu) (with recommended @salesforce/cli version, in case the latest version of @salesforce/cli is buggy)

_See [Dockerfile-ubuntu](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/Dockerfile-ubuntu)_
