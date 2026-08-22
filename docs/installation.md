### Which installation do I need?

There are three ways to install sfdx-hardis, and you only need one of them.

| Your situation | What to install | Terminal needed |
|---|---|---|
| You want to use sfdx-hardis on your computer, with menus and buttons instead of commands. This is how most people use it. | [Visual Studio Code and the SFDX Hardis extension](#install-with-visual-studio-code-recommended) | No |
| You are at ease with a terminal and only want the commands. | [The sfdx-hardis plugin for Salesforce CLI](#install-as-a-salesforce-cli-plugin) | Yes |
| You are setting up a CI/CD pipeline (GitHub, GitLab, Azure, Bitbucket). | [A ready to use Docker image](#run-in-cicd-with-a-docker-image) | Yes |

Not sure? Take the first one: it also installs the command line version for you.

---

### Install with Visual Studio Code (recommended)

Visual Studio Code, usually shortened to **VS Code**, is a free application published by Microsoft. sfdx-hardis runs inside it and adds its own menus and buttons, so you can use every feature without typing a single command.

You do not need to know VS Code, or to write code, to follow the five steps below. Plan about 15 minutes, mostly waiting for downloads.

#### Step 1: Install Visual Studio Code

Go to [code.visualstudio.com](https://code.visualstudio.com/), download the version for your system (Windows, macOS or Linux), then run the downloaded file and keep the proposed options.

If VS Code is already on your computer, jump to step 2.

#### Step 2: Install the SFDX Hardis extension

- Start VS Code.
- In the vertical bar of icons on the left, called the Activity Bar, click the **Extensions** icon (the four small squares). Keyboard shortcut: `Ctrl+Shift+X`, or `Cmd+Shift+X` on macOS.
- Type `sfdx hardis` in the search box.
- Click **SFDX Hardis** in the results, then click **Install**.

You can also do it from your browser: open the [SFDX Hardis page on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis), click **Install**, and let the browser hand over to VS Code.

#### Step 3: Open the sfdx-hardis panel

Once the extension is installed, a new icon ![SFDX Hardis button](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/hardis-button.jpg) appears in the Activity Bar, on the left. Click it (arrow 1 below): the sfdx-hardis menus appear, and the **Welcome** page opens.

At the top of the Welcome page, click the **dependencies** button (arrow 2 below).

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/install-dependencies-highlight.png)

#### Step 4: Install the dependencies

To talk to Salesforce and to Git, sfdx-hardis needs a few other free tools. The setup page lists them all, with a green check on those you already have.

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/install-dependencies-screenshot.png)

- Click **Install** or **Upgrade** on every line that is not green, or click **Run pending installs** to handle them one after the other.
- **Node.js** and **Git** are the two you may have to install by yourself: download them from [nodejs.org](https://nodejs.org/en/) and [git-scm.com](https://git-scm.com/downloads), then click **Re-check** on the line.
- Close VS Code and open it again at the end, so it sees the newly installed tools.

When every line is green, the installation is over.

#### Step 5: Connect to your Salesforce org

Go back to the Welcome page and click **Connect** to log in to your first org. The same page then gives you access to all the features.

Where to go next:

- [What you can do from the VS Code extension](https://sfdx-hardis.cloudity.com/vscode-extension/)
- [Set up a Salesforce CI/CD project](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/)
- [Monitor a Salesforce org](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/)

#### Video tutorial

If you prefer to watch someone do it first, follow the video below.

[![Installation tutorial](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/play-install-tuto.png)](https://www.youtube.com/watch?v=LA8m-t7CjHA)

#### If something does not work

- A line stays red after you installed the tool: close VS Code, open it again, then click **Re-check** on that line.
- A command does nothing: open the setup page again, a dependency may still be missing or outdated.
- Still stuck? Open a [GitHub issue](https://github.com/hardisgroupcom/sfdx-hardis/issues), the maintainers and the community answer there.

#### Other VS Code compatible IDEs

The extension is published on both the Visual Studio Marketplace and the [Open VSX Registry](https://open-vsx.org/extension/NicolasVuillamy/vscode-sfdx-hardis), so the steps above also work in the IDEs built on VS Code, on desktop or in the browser.

|                                                                                                                                                                                                                                                                                                                                                                                                      | IDE                                                                                                                         | Install from                                                                                                        |
|:-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| <img src="https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/ide-vscode.png" alt="Visual Studio Code" height="48"/>                                                                                                                                                                                                                                                           | [Visual Studio Code](https://code.visualstudio.com/)                                                                        | [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis) |
| <img src="https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/ide-agentforce-vibes.png" alt="Agentforce Vibes IDE" height="48"/>                                                                                                                                                                                                                                               | [Agentforce Vibes IDE](https://www.salesforce.com/agentforce/developers/vibe-coding/ide/) and other browser IDEs            | [Open VSX](https://open-vsx.org/extension/NicolasVuillamy/vscode-sfdx-hardis)                                       |
| <img src="https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/ide-cursor.png" alt="Cursor" height="48"/> <img src="https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/ide-windsurf.png" alt="Windsurf" height="48"/> <img src="https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/ide-vscodium.png" alt="VSCodium" height="48"/> | [Cursor](https://cursor.com/), [Windsurf](https://windsurf.com/), [VSCodium](https://vscodium.com/) and other VS Code forks | [Open VSX](https://open-vsx.org/extension/NicolasVuillamy/vscode-sfdx-hardis)                                       |

The only requirement is the same as for VS Code: the IDE must be able to run the Salesforce CLI (Agentforce Vibes IDE ships it preinstalled).

---

### Install as a Salesforce CLI plugin

For those who prefer to type commands in a terminal. If you followed the VS Code steps above, this is already done.

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

---

### Run in CI/CD with a Docker image

For pipelines: the images already contain Node.js, the Salesforce CLI, sfdx-hardis and its plugins, so a job starts without installing anything.

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
