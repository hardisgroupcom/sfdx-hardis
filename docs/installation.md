### With IDE

You can install [Visual Studio Code](https://code.visualstudio.com/), then the VS Code extension [SFDX Hardis](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

The extension is published on both the Visual Studio Marketplace and the [Open VSX Registry](https://open-vsx.org/extension/NicolasVuillamy/vscode-sfdx-hardis), so it is fully compatible with every VS Code-based IDE, on desktop or in the browser:

|                                                                                                                                                                                                                                                                                                                                                                       | IDE                                                                                                              | Install from                                                                                                        |
|:---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| <img src="https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/ide-vscode.png" alt="Visual Studio Code" height="32"/>                                                                                                                                                                                                                             | [Visual Studio Code](https://code.visualstudio.com/)                                                             | [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis) |
| <img src="https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/ide-agentforce-vibes.png" alt="Agentforce Vibes IDE" height="32"/>                                                                                                                                                                                                                 | [Agentforce Vibes IDE](https://www.salesforce.com/agentforce/developers/vibe-coding/ide/) and other browser IDEs | [Open VSX](https://open-vsx.org/extension/NicolasVuillamy/vscode-sfdx-hardis)                                       |
| <img src="https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/ide-cursor.png" alt="Cursor" height="32"/> <img src="https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/ide-windsurf.png" alt="Windsurf" height="32"/> <img src="https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/ide-vscodium.png" alt="VSCodium" height="32"/> | [Cursor](https://cursor.com/), [Windsurf](https://windsurf.com/), [VSCodium](https://vscodium.com/) and other VS Code forks | [Open VSX](https://open-vsx.org/extension/NicolasVuillamy/vscode-sfdx-hardis)                                       |

The only requirement is the same as for VS Code: the IDE must be able to run the Salesforce CLI (Agentforce Vibes IDE ships it preinstalled).

Once installed, click on ![SFDX Hardis button](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/hardis-button.jpg) in the VS Code left bar, click on **Install dependencies** and follow the installation instructions.

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/install-dependencies-highlight.png)

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/install-dependencies-screenshot.png)

When everything is green, you are all set.

_You can also watch the video tutorial below_

[![Installation tutorial](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/play-install-tuto.png)](https://www.youtube.com/watch?v=LA8m-t7CjHA)

___

### As SFDX Plugin

#### Pre-requisites

- Install Node.js ([recommended version](https://nodejs.org/en/))
- Install the Salesforce CLI by running `npm install @salesforce/cli --global`

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

> Images are published on both **GitHub Container Registry (ghcr.io)** and **Docker Hub**. Prefer the **ghcr.io** images: their publication does not rely on any long-lived token (it is secured with the workflow's ephemeral credentials), so they have the most secure supply chain. Use the Docker Hub mirror images when your infrastructure can only pull from `docker.io`.

Two image flavors are available:

- **Standard images** (`sfdx-hardis`, `sfdx-hardis-ubuntu`): Salesforce CI/CD tooling without coding agent CLIs. Use these for standard deployments.

- **With-agents images** (`sfdx-hardis-with-agents`, `sfdx-hardis-ubuntu-with-agents`): Same as standard + coding agent CLIs pre-installed (Claude, Codex, Gemini, GitHub Copilot). Use these for [AI-powered auto-fix](https://sfdx-hardis.cloudity.com/salesforce-ai-setup/) scenarios.

---

#### Standard images (without coding agent CLIs)

- Linux **Alpine** based images (works on GitLab)

  - GitHub Container Registry (recommended)

    - [**ghcr.io/hardisgroupcom/sfdx-hardis:latest**](https://github.com/hardisgroupcom/sfdx-hardis/pkgs/container/sfdx-hardis) (with latest @salesforce/cli version)
    - [**ghcr.io/hardisgroupcom/sfdx-hardis:latest-sfdx-recommended**](https://github.com/hardisgroupcom/sfdx-hardis/pkgs/container/sfdx-hardis) (with recommended @salesforce/cli version, in case the latest version of @salesforce/cli is buggy)

  - Docker Hub (mirror)

    - [**hardisgroupcom/sfdx-hardis:latest**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis) (with latest @salesforce/cli version)
    - [**hardisgroupcom/sfdx-hardis:latest-sfdx-recommended**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis) (with recommended @salesforce/cli version, in case the latest version of @salesforce/cli is buggy)

_See [Dockerfile](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/Dockerfile)_

- Linux **Ubuntu** based images (works on GitHub, Azure & Bitbucket)

  - GitHub Container Registry (recommended)

    - [**ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:latest**](https://github.com/hardisgroupcom/sfdx-hardis/pkgs/container/sfdx-hardis-ubuntu) (with latest @salesforce/cli version)
    - [**ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu:latest-sfdx-recommended**](https://github.com/hardisgroupcom/sfdx-hardis/pkgs/container/sfdx-hardis-ubuntu) (with recommended @salesforce/cli version, in case the latest version of @salesforce/cli is buggy)

  - Docker Hub (mirror)

    - [**hardisgroupcom/sfdx-hardis-ubuntu:latest**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis-ubuntu) (with latest @salesforce/cli version)
    - [**hardisgroupcom/sfdx-hardis-ubuntu:latest-sfdx-recommended**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis-ubuntu) (with recommended @salesforce/cli version, in case the latest version of @salesforce/cli is buggy)

_See [Dockerfile-ubuntu](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/Dockerfile-ubuntu)_

---

#### With-agents images (includes coding agent CLIs)

These images include Claude Code, OpenAI Codex, Gemini CLI, and GitHub Copilot pre-installed and are required for the [AI coding agent auto-fix feature](https://sfdx-hardis.cloudity.com/salesforce-ai-setup/).

> Note: Alpine-based with-agents images may have limitations with some agent CLIs at runtime due to musl libc. Use Ubuntu-based images for full agent compatibility.

- Linux **Alpine** based images (works on GitLab)

  - GitHub Container Registry (recommended): [**ghcr.io/hardisgroupcom/sfdx-hardis-with-agents:latest**](https://github.com/hardisgroupcom/sfdx-hardis/pkgs/container/sfdx-hardis-with-agents)
  - Docker Hub (mirror): [**hardisgroupcom/sfdx-hardis-with-agents:latest**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis-with-agents)

_See [Dockerfile](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/Dockerfile)_

- Linux **Ubuntu** based images (works on GitHub, Azure & Bitbucket - recommended for coding agents)

  - GitHub Container Registry (recommended): [**ghcr.io/hardisgroupcom/sfdx-hardis-ubuntu-with-agents:latest**](https://github.com/hardisgroupcom/sfdx-hardis/pkgs/container/sfdx-hardis-ubuntu-with-agents)
  - Docker Hub (mirror): [**hardisgroupcom/sfdx-hardis-ubuntu-with-agents:latest**](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis-ubuntu-with-agents)

_See [Dockerfile-ubuntu](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/Dockerfile-ubuntu)_
