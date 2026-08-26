<!-- markdownlint-disable MD034 -->

[![sfdx-hardis by Cloudity Banner](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/sfdx-hardis-banner.png)](https://sfdx-hardis.cloudity.com)

**New:** [**What's new in sfdx-hardis v8**](https://sfdx-hardis.cloudity.com/sfdx-hardis-v8/) - Deployment Actions are generally available, Pull Request comments are redesigned, and the VS Code extension is rebuilt.

[![Version](https://img.shields.io/npm/v/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
[![Downloads/week](https://img.shields.io/npm/dw/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
[![Downloads/total](https://img.shields.io/npm/dt/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
[![Docker Pulls](https://img.shields.io/badge/Docker%20Pulls-201.1k-blue)](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis/tags)
[![GitHub stars](https://img.shields.io/github/stars/hardisgroupcom/sfdx-hardis)](https://GitHub.com/hardisgroupcom/sfdx-hardis/stargazers/)
[![GitHub contributors](https://img.shields.io/github/contributors/hardisgroupcom/sfdx-hardis.svg)](https://gitHub.com/hardisgroupcom/sfdx-hardis/graphs/contributors/)
[![MegaLinter](https://github.com/hardisgroupcom/sfdx-hardis/actions/workflows/mega-linter.yml/badge.svg?branch=main)](https://github.com/hardisgroupcom/sfdx-hardis/actions/workflows/mega-linter.yml?query=branch%3Amain)
[![Secured with Trivy](https://img.shields.io/badge/Trivy-secured-green?logo=docker)](https://github.com/aquasecurity/trivy)
[![License](https://img.shields.io/npm/l/sfdx-hardis.svg)](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

Sfdx-hardis is a **CLI and visual productivity tools suite for Salesforce**, by [**Cloudity**](https://cloudity.com/) & friends, natively compliant with most Git platforms, messaging tools, ticketing systems and AI providers (including Agentforce).

![Native Integrations](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/integrations.png)

It is free and open-source, and lets you:

- [Deliver your projects with **State of the art Salesforce DevOps**](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/)

![DevOps Pipeline UI](https://sfdx-hardis.cloudity.com/assets/images/sfdx-hardis-pipeline-view.gif)

- [**Backup Metadatas** and **Monitor your Salesforce orgs**](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/)

![Monitoring with Grafana](https://sfdx-hardis.cloudity.com/assets/images/grafana-v2-fleet.png)

- [Generate your **Project Documentation** with AI](https://sfdx-hardis.cloudity.com/salesforce-project-documentation/)

![Salesforce AI Generated Documentation](https://sfdx-hardis.cloudity.com/assets/images/screenshot-object-diagram.jpg)

- Use many commands that **save minutes, hours or even days** of your daily **admin or developer** work.

![Productivity commands](https://sfdx-hardis.cloudity.com/assets/images/ProductivityCommands.png)

If you need help to get the most out of sfdx-hardis, Cloudity's international teams of business and technical experts can help: [contact us](https://cloudity.com/contact-us/).

[![Cloudity](https://sfdx-hardis.cloudity.com/assets/images/cloudity-banner.png)](https://cloudity.com/contact-us/)

[_See online documentation for a better navigation_](https://sfdx-hardis.cloudity.com)

---

**sfdx-hardis** commands and configuration are best used from the [**SFDX Hardis Visual Studio Code extension**](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

---

_Featured on SalesforceBen_

[![SalesforceBen Interview](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/sfben-sfdx-hardis.jpg)](https://www.youtube.com/watch?v=vtWx_IWoL9k)

_See Dreamforce presentation_

[![See Dreamforce presentation](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/play-dreamforce-session.png)](https://www.youtube.com/watch?v=o0Mm9F07UFs)

## Installation

<!-- installation.md start -->

### Which installation do I need?

There are three ways to install sfdx-hardis, and you only need one of them.

| Your situation                                                                                                            | What to install                                                                                  | Terminal needed |
|---------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|-----------------|
| You want to use sfdx-hardis on your computer, with menus and buttons instead of commands. This is how most people use it. | [Visual Studio Code and the SFDX Hardis extension](#install-with-visual-studio-code-recommended) | No              |
| You are at ease with a terminal and only want the commands.                                                               | [The sfdx-hardis plugin for Salesforce CLI](#install-as-a-salesforce-cli-plugin)                 | Yes             |
| You are setting up a CI/CD pipeline (GitHub, GitLab, Azure, Bitbucket).                                                   | [A ready to use Docker image](#run-in-cicd-with-a-docker-image)                                  | Yes             |

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
- In the vertical bar of icons on the left, called the Activity Bar, click the **Extensions** icon <img src="https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/vscode-extensions-icon.png" alt="VS Code Extensions icon" height="22"/> (four small squares, the top right one tilted). Keyboard shortcut: `Ctrl+Shift+X`, or `Cmd+Shift+X` on macOS.
- Type `sfdx hardis` in the search box.
- Click **SFDX Hardis** in the results, then click **Install**.
- If VS Code asks whether you trust the publisher, accept: the extension is published by **NicolasVuillamy**, the author of sfdx-hardis.

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

<!-- installation.md end -->

## Usage

```sh-session
sf hardis:<COMMAND> <OPTIONS>
```

## Events

<!-- events.md start -->

### North Africa Dreamin' 2026, Casablanca (upcoming)

[Non-deterministic + deterministic Agentic Engineering: Delegate your Salesforce job to Agents but ensure their reliability with CI/CD](https://www.linkedin.com/posts/nad2026-trailblazercommunity-salesforce-share-7488021542417821696-f-Yd/)

Casablanca, Morocco - 24/10/2026

<img width="800" height="800" alt="North Africa Dreamin' 2026" src="https://github.com/user-attachments/assets/c5ff790c-48c3-4673-8c19-f1db63ff8971" />

### Czech Dreamin '26, Prague

[Refresh your full sandboxes without needing to reconfigure everything](https://czechdreamin.com/)

Prague, Czechia - 29/05/2026

<img width="1280" height="591" alt="Czech Dreamin 2026" src="https://github.com/user-attachments/assets/fe84473e-508c-4e3d-a2b5-5eaaae24a575" />

### Wir Sind Ohana '26, Berlin

[When was the last time you refreshed your sandboxes to have fresh data?](https://wirsindohana.de/)

Berlin, Germany - 08/05/2026

<img width="1217" height="913" alt="Wir Sind Ohana 2026" src="https://github.com/user-attachments/assets/a2aaf53d-4b33-4370-a225-2453fdf766e6" />

### Dream Ole '26, Valencia

Refresh your full sandboxes without needing to reconfigure everything, with [Louise Lockie](https://www.linkedin.com/in/louise-lockie/)

Valencia, Spain - 27/03/2026

<img width="1216" height="913" alt="Dream Ole 2026" src="https://github.com/user-attachments/assets/50c6fec2-4061-4ec4-b9f8-c9e4a8f2d7d1" />

### Polish Dreamin '26, Wroclaw

[Refresh your full sandboxes without needing to reconfigure everything](https://coffeeforce.pl/dreamin/speaker/nicolas-vuillamy/)

Wroclaw, Poland - 20/03/2026

<img width="951" height="753" alt="Polish Dreamin 2026" src="https://github.com/user-attachments/assets/4cebe084-f7b6-4d6e-aa22-c3cb305222ea" />

### Irish Dreamin '26, Dublin

No-Cost DevOps: Enterprise-Grade CI/CD with SFDX-HARDIS, by Abdeslam Loukili

Dublin, Ireland - 19/03/2026

![Irish Dreamin 2026 - Abdeslam Loukili](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/irish-dreamin-abdeslam-loukili.jpg)

### French Touch Dreamin '25

Refresh your full sandboxes without needing to reconfigure everything - with [Mehdi Abdennasser](https://www.linkedin.com/in/mehdi-abdennasser/)

Paris, France - 02/12/2025

<img width="1920" height="1080" alt="Untitled design (14)" src="https://github.com/user-attachments/assets/853b9d66-973e-43ef-bfcf-fe044d1d4d94" />

### DevOps Dreamin

Why you don't need DevOps vendors tools

London, UK - 20/11/2025

<img width="1920" height="1080" alt="Untitled design (13)" src="https://github.com/user-attachments/assets/d626363c-64af-43fb-b0a0-d2f0afcb9c1d" />

### Trailblazer User Group '25, Casablanca

[Salesforce Org Documentation with Open-Source and Agentforce](https://trailblazercommunitygroups.com/events/details/salesforce-salesforce-developer-group-casablanca-morocco-presents-salesforce-org-documentation-with-open-source-and-agentforce-salesforce-integration-with-connected-app/), by [Taha Basri](https://www.linkedin.com/in/tahabasri/)

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/casa-user-group-docgen.png)

### Trailblazer Developer Group '25, Berlin (online)

[Summer of Docs: Auto-Document Your Salesforce Org Like a Pro](https://trailblazercommunitygroups.com/events/details/salesforce-salesforce-developer-group-berlin-germany-presents-summer-of-docs-auto-document-your-salesforce-org-like-a-pro/), by [Mariia Pyvovarchuk](https://www.linkedin.com/in/mpyvo/) (Aspect) and [Roman Hentschke](https://www.linkedin.com/in/derroman/)

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/berlin-user-group-docgen.png)

### London's Calling '25, London

[Auto-generate your SF project Documentation site with open-source and Agentforce](https://www.londonscalling.net/sessions/auto-generate-your-sf-project-documentation-site-with-open-source-and-agentforce/)

![image](https://github.com/user-attachments/assets/9b99120c-b660-4f67-b734-793148ac9d00)

### Czech Dreamin '25, Prague

[Auto-generate your SF project Documentation site with open-source and Agentforce](https://czechdreamin.com/2025/), with [Mariia Pyvovarchuk](https://www.linkedin.com/in/mpyvo/)

![Czech Dreamin 2025](https://github.com/user-attachments/assets/fa7b7f12-6d6a-437c-badd-20a626bb2163)

### Trailblazer Admin Group '25, Lyon

[Techs for Admins: Afterwork Salesforce Inspector Reloaded & sfdx-hardis](https://trailblazercommunitygroups.com/events/details/salesforce-salesforce-admin-group-lyon-france-presents-afterwork-salesforce-inspector-reloaded-et-sfdx-hardis-avec-cloudity/), with [Thomas Prouvot](https://www.linkedin.com/in/thomasprouvot/)

![](https://github.com/user-attachments/assets/90621fe0-6527-4a34-8a0b-c14bd6d21cbd)

### Dreamforce 2024, San Francisco

[Save the Day by Monitoring Your Org with Open-Source Tools](https://reg.salesforce.com/flow/plus/df24/sessioncatalog/page/catalog/session/1718915808069001Q7HH), with [Olga Shirikova](https://www.linkedin.com/in/olga-shirokova/)

[![Dreamforce 2024 Video](https://img.youtube.com/vi/NxiLiYeo11A/0.jpg)](https://www.youtube.com/watch?v=NxiLiYeo11A)

### Wir Sind Ohana '24, Berlin

[Automate the Monitoring of your Salesforce orgs with open-source tools only!](https://wirsindohana.wordpress.com/), with [Yosra Saidani](https://www.linkedin.com/in/yosra-saidani-mvp/)

[![Wir Sind Ohana Video](https://img.youtube.com/vi/xGbT6at7RZ0/0.jpg)](https://www.youtube.com/watch?v=xGbT6at7RZ0)

### Polish Dreamin '24, Wroclaw, Poland

[Easy and complete Salesforce CI/CD with open-source only!](https://coffeeforce.pl/dreamin/speaker/nicolas-vuillamy/), with [Wojciech Suwiński](https://www.linkedin.com/in/wsuwinski/)

![Polish Dreamin 2024](https://github.com/nvuillam/nvuillam/assets/17500430/e843cc08-bf8a-452d-b7f0-c64a314f1b60)

### French Touch Dreamin '23, Paris

[Automate the Monitoring of your Salesforce orgs with open-source tools only!](https://frenchtouchdreamin.com/index.php/french-touch-dreamin-2023/), with [Maxime Guenego](https://www.linkedin.com/in/maxime-guenego/)

![French Touch Dreamin 2023](https://github.com/nvuillam/nvuillam/assets/17500430/8a2e1bbf-3402-4929-966d-5f99cb13cd29)

### Dreamforce 2023, San Francisco

[Easy Salesforce CI/CD with open-source and clicks only thanks to sfdx-hardis!](https://reg.salesforce.com/flow/plus/df23/sessioncatalog/page/catalog/session/1684196389783001OqEl), with [Jean-Pierre Rizzi](https://www.linkedin.com/in/jprizzi/)

[![Dreamforce 2023 Video](https://img.youtube.com/vi/o0Mm9F07UFs/0.jpg)](https://www.youtube.com/watch?v=o0Mm9F07UFs)

### Yeur Dreamin' 2023, Brussels

[An easy and complete Salesforce CI/CD release management with open-source only !](https://www.yeurdreamin.eu/2023-sessions/), with [Angélique Picoreau](https://www.linkedin.com/in/ang%C3%A9lique-picoreau-35328b36/)

[![image](https://github.com/nvuillam/nvuillam/assets/17500430/6470df20-7449-444b-a0a5-7dc22f5f6188)](https://www.linkedin.com/posts/nicolas-vuillamy_cicd-opensource-trailblazercommunity-activity-7076859027321704448-F1g-?utm_source=share&utm_medium=member_desktop)

<!-- events.md end -->

## Articles & Videos

<!-- articles-videos.md start -->

### Web Articles

Here are some articles about [sfdx-hardis](https://sfdx-hardis.cloudity.com/)

- English

[![Conga Deployment Cheat Sheet](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-conga-banner.jpg)](https://nicolas.vuillamy.fr/how-to-deploy-conga-composer-configuration-using-salesforce-cli-plugins-c2899641f36b)
[![Questions/Answers](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-questions-answers.jpg)](https://nicolas.vuillamy.fr/what-devops-experts-want-to-know-about-salesforce-ci-cd-with-sfdx-hardis-q-a-1f412db34476)
[![Salesforce Developers Podcast](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-sfdev.jpg)](https://developer.salesforce.com/podcast/2023/06/sfdx)
[![sfdx-hardis: A release management tool for open-source](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-cicd-salesforcedevopsnet.jpg)](https://salesforcedevops.net/index.php/2023/03/01/sfdx-hardis-open-source-salesforce-release-management/)
[![Assisted solving of Salesforce deployments errors](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deployment-errors.jpg)](https://nicolas.vuillamy.fr/assisted-solving-of-salesforce-deployments-errors-47f3666a9ed0)
[![Handle Salesforce API versions Deprecation like a pro](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-deprecated-api.jpg)](https://nicolas.vuillamy.fr/handle-salesforce-api-versions-deprecation-like-a-pro-335065f52238)
[![How to mass download notes and attachments files from a Salesforce org](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-mass-download.jpg)](https://nicolas.vuillamy.fr/how-to-mass-download-notes-and-attachments-files-from-a-salesforce-org-83a028824afd)
[![How to freeze / unfreeze users during a Salesforce deployment](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-freeze.jpg)](https://medium.com/@dimitrimonge/freeze-unfreeze-users-during-salesforce-deployment-8a1488bf8dd3)
[![How to detect bad words in Salesforce records using SFDX Data Loader and sfdx-hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-badwords.jpg)](https://nicolas.vuillamy.fr/how-to-detect-bad-words-in-salesforce-records-using-sfdx-data-loader-and-sfdx-hardis-171db40a9bac)
[![Reactivate all the sandbox users with .invalid emails in 3 clicks](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-invalid-email.jpg)](https://nicolas.vuillamy.fr/reactivate-all-the-sandbox-users-with-invalid-emails-in-3-clicks-2265af4e3a3d)
[![Invalid scope:Mine, not allowed ? Deploy your ListViews anyway !](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-invalid-scope-mine.jpg)](https://nicolas.vuillamy.fr/invalid-scope-mine-not-allowed-deploy-your-listviews-anyway-443aceca8ac7)

- French
  - [Versions d'API Salesforce décommissionnées: Que faire ?](https://leblog.hardis-group.com/portfolio/versions-dapi-salesforce-decommissionnees-que-faire/)
  - [Exporter en masse les fichiers d’une org Salesforce](https://leblog.hardis-group.com/portfolio/exporter-en-masse-les-fichiers-dune-org-salesforce/)
  - [Suspendre l’accès aux utilisateurs lors d’une mise en production Salesforce](https://leblog.hardis-group.com/portfolio/suspendre-lacces-aux-utilisateurs-lors-dune-mise-en-production-salesforce/)

### Recorded Conferences

#### Dreamforce Sessions

- Dreamforce 2024 - Save the Day by Monitoring Your Org with Open-Source Tools (with Olga Shirikova)

[![Dreamforce 2024: Save the Day by Monitoring Your Org with Open-Source Tools](https://img.youtube.com/vi/NxiLiYeo11A/0.jpg)](https://www.youtube.com/watch?v=NxiLiYeo11A){target=blank}

- Dreamforce 2023 - Easy Salesforce CI/CD with open-source and clicks only thanks to sfdx-hardis! (with Jean-Pierre Rizzi)

[![Dreamforce 2023: Easy Salesforce CI/CD with open-source](https://img.youtube.com/vi/o0Mm9F07UFs/0.jpg)](https://www.youtube.com/watch?v=o0Mm9F07UFs){target=blank}

#### Community Events

- Wir Sind Ohana 2024 - Automate the Monitoring of your Salesforce orgs with open-source tools only! (with Yosra Saidani)

[![Wir Sind Ohana 2024: Automate Monitoring with Open-Source](https://img.youtube.com/vi/xGbT6at7RZ0/0.jpg)](https://www.youtube.com/watch?v=xGbT6at7RZ0){target=blank}

### Podcasts

- SalesforceBen Deep Dives with Peter Chittum, 2025: _**Simplify Salesforce Deployment with SFDX Hardis**_

[![Video](https://github.com/user-attachments/assets/383f6e9a-8102-42bc-be24-42663e9959d4)](https://www.youtube.com/watch?v=vtWx_IWoL9k)

- Apex Hours 2025 - Org monitoring with Grafana + AI generated doc

[![Apex Hours 2025: Org monitoring with Grafana + AI generated doc](https://img.youtube.com/vi/oDaCh66pRcI/0.jpg)](https://www.youtube.com/watch?v=oDaCh66pRcI){target=blank}

- Salesforce Way Podcast #102 - Sfdx-hardis with Nicolas Vuillamy

[![Salesforce Way Podcast: Sfdx-hardis](https://img.youtube.com/vi/sfdx-hardis/0.jpg)](https://salesforceway.com/podcast/sfdx-hardis/){target=blank}

- Salesforce Developers Podcast Episode 182: SFDX-Hardis with Nicolas Vuillamy

[![Salesforce Developers Podcast](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/article-sfdev.jpg)](https://developer.salesforce.com/podcast/2023/06/sfdx){target=blank}

### sfdx-hardis Usage

#### Features Overview

- sfdx-hardis 2025 new features overview

[![sfdx-hardis 2025 new features](https://img.youtube.com/vi/JRKH5COUVQ0/0.jpg)](https://youtu.be/JRKH5COUVQ0){target=blank}

- SFDX-HARDIS: A demo with Nicolas Vuillamy from Cloudity

[![SalesforceDevOps.net Demo](https://img.youtube.com/vi/qP6MaZUGzik/0.jpg)](https://www.youtube.com/watch?v=qP6MaZUGzik){target=blank}

#### Installation & Setup

- Complete installation tutorial for sfdx-hardis - [📖 Documentation](https://sfdx-hardis.cloudity.com/installation/)

[![Installation Tutorial](https://img.youtube.com/vi/LA8m-t7CjHA/0.jpg)](https://www.youtube.com/watch?v=LA8m-t7CjHA){target=blank}

#### CI/CD Workflows

- Complete CI/CD workflow for Salesforce projects - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/)

[![Dreamforce demo video: Easy Salesforce CI/CD with sfdx-hardis and open-source only !](https://img.youtube.com/vi/zEYqTd2txU4/0.jpg)](https://www.youtube.com/watch?v=zEYqTd2txU4){target=blank}

- How to start a new User Story in sandbox - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-create-new-task/)

[![Create New User Story](https://img.youtube.com/vi/WOqssZwjPhw/0.jpg)](https://www.youtube.com/watch?v=WOqssZwjPhw){target=blank}

- How to commit updates and create merge requests - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-publish-task/)

[![Publish User Story Tutorial](https://img.youtube.com/vi/Ik6whtflmfY/0.jpg)](https://www.youtube.com/watch?v=Ik6whtflmfY){target=blank}

- How to resolve git merge conflicts in Visual Studio Code - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-validate-merge-request/)

[![Merge Conflicts Resolution](https://img.youtube.com/vi/lz5OuKzvadQ/0.jpg)](https://www.youtube.com/watch?v=lz5OuKzvadQ){target=blank}

- How to install packages in your org - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-work-on-task-install-packages/)

[![Install Packages Tutorial](https://img.youtube.com/vi/5-MgqoSLUls/0.jpg)](https://www.youtube.com/watch?v=5-MgqoSLUls){target=blank}

- Configure CI server authentication to Salesforce orgs - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-auth/)

[![Configure CI Authentication](https://img.youtube.com/vi/OzREUu5utVI/0.jpg)](https://www.youtube.com/watch?v=OzREUu5utVI){target=blank}

#### Monitoring

- How to configure monitoring for your Salesforce org - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-monitoring-config-home/)

[![Org Monitoring Setup](https://img.youtube.com/vi/bcVdN0XItSc/0.jpg)](https://www.youtube.com/watch?v=bcVdN0XItSc){target=blank}

#### Integrations

- Configure Slack integration for deployment notifications - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-slack/)

[![Slack Integration](https://img.youtube.com/vi/se292ABGUmI/0.jpg)](https://www.youtube.com/watch?v=se292ABGUmI){target=blank}

- How to create a Personal Access Token in GitLab - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-clone-repository/)

[![GitLab Personal Access Token](https://img.youtube.com/vi/9y5VmmYHuIg/0.jpg)](https://www.youtube.com/watch?v=9y5VmmYHuIg){target=blank}

#### Documentation

- How to generate AI-enhanced Salesforce project documentation - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-project-doc-generate/)

[![Generate Project Documentation](https://img.youtube.com/vi/ZrVPN3jp1Ac/0.jpg)](https://www.youtube.com/watch?v=ZrVPN3jp1Ac){target=blank}

- Host your documentation on Cloudflare free tier - [📖 Documentation](https://sfdx-hardis.cloudity.com/salesforce-project-doc-cloudflare/)

[![Cloudflare Doc Hosting Setup](https://img.youtube.com/vi/AUipbKjgsDI/0.jpg)](https://www.youtube.com/watch?v=AUipbKjgsDI){target=blank}

<!-- articles-videos.md end -->

## Contributing

<!-- contributing.md start -->

Everyone is welcome to contribute to sfdx-hardis (even juniors: we will help you).

### Salesforce CLI Plugin: sfdx-hardis

- Install Node.js ([recommended version](https://nodejs.org/en/))
- Install TypeScript by running `npm install typescript --global`
- Install yarn by running `npm install yarn --global`
- Install the Salesforce CLI by running `npm install @salesforce/cli --global`
- Fork <https://github.com/hardisgroupcom/sfdx-hardis> and clone it (or just clone if you are an internal contributor)
- At the root of the repository:
  - Run `yarn` to install dependencies
  - Run `sf plugins link` to link the local sfdx-hardis to the Salesforce CLI
  - Run `tsc --watch` to transpile TypeScript into JavaScript every time you update a TS file
  - Optional, recommended on Windows: export `NODE_OPTIONS="--import file:///<path-to-your-clone>/scripts/disable-auto-transpile.mjs"` in your shell profile or VS Code terminal environment. A linked plugin is normally re-transpiled from TypeScript at every command (about 3 extra seconds per run): since `tsc --watch` already keeps `lib/` fresh, this preload makes commands start from the compiled sources instead, as fast as an installed plugin. Remove the variable to run live TypeScript again.
- Debug commands using `NODE_OPTIONS=--inspect-brk sf hardis:somecommand --someparameter somevalue` (you can also debug commands with the VS Code SFDX Hardis extension debug setting)

Note: To test a feature from CI, you can add the following code in your workflow before running sfdx-hardis commands:

```sh
REPO_URL="https://github.com/hardisgroupcom/sfdx-hardis.git" # or your forked repo URL
GIT_BRANCH="fixes/my-git-branch" # or the branch you want to test

TEMP_DIR=$(mktemp -d)
git clone "$REPO_URL" "$TEMP_DIR"
cd "$TEMP_DIR"
git checkout "$GIT_BRANCH"
yarn
npm install typescript --global
tsc
sf plugins link
cd -
```

### VS Code Extension: vscode-sfdx-hardis

- Install Node.js ([recommended version](https://nodejs.org/en/))
- Install TypeScript by running `npm install typescript --global`
- Install yarn by running `npm install yarn --global`
- Install Visual Studio Code Insiders ([download here](https://code.visualstudio.com/insiders/))
- Fork <https://github.com/hardisgroupcom/vscode-sfdx-hardis> and clone it (or just clone if you are an internal contributor)
- At the root of the repository:
  - Run `yarn` to install dependencies
- To test your code in the VS Code extension:
  - Open the `vscode-sfdx-hardis` folder in VS Code Insiders
  - Press `F5` to open a new VS Code window with the extension loaded (or menu Run > Start Debugging)
  - In the new window, open a Salesforce DX project
  - Run commands from the command palette (Ctrl+Shift+P) or use the buttons in the panel or webviews

<!-- contributing.md end -->

## Dependencies

**sfdx-hardis** partially relies on the following SFDX Open-Source packages

- [SFDX Git Delta](https://github.com/scolladon/sfdx-git-delta)
- [Salesforce Data Move Utility](https://github.com/forcedotcom/SFDX-Data-Move-Utility)

## Contributors

<!-- contributors.md start -->

### Organization

sfdx-hardis is primarily led by Nicolas Vuillamy & [Cloudity](https://www.cloudity.com/), but has many external contributors that we cant thank enough !

### Pull Requests Authors

<a href="https://github.com/hardisgroupcom/sfdx-hardis/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hardisgroupcom/sfdx-hardis" />
</a>

### Special Thanks

- [Roman Hentschke](https://www.linkedin.com/in/derroman/), for building the BitBucket CI/CD integration and german translation
- [Leo Jokinen](https://www.linkedin.com/in/leojokinen/), for building the GitHub CI/CD integration
- [Mariia Pyvovarchuk](https://www.linkedin.com/in/mpyvo/), for her work about generating automations documentation
- [Matheus Delazeri](https://www.linkedin.com/in/matheus-delazeri-souza/), for the PDF output of documentation and brazilian-portuguese translation
- [Taha Basri](https://www.linkedin.com/in/tahabasri/), for his work about generating documentation of LWC
- [Anush Poudel](https://www.linkedin.com/in/anushpoudel/), for integrating sfdx-hardis with multiple LLMs using langchainJs
- [Sebastien Colladon](https://www.linkedin.com/in/sebastien-colladon/), for providing sfdx-git-delta which is highly used within sfdx-hardis
- [Stepan Stepanov](https://www.linkedin.com/in/stepan-stepanov-79a48734/), for implementing the deployment mode _delta with dependencies_
- [Shamina Mossodeean](https://www.linkedin.com/in/shaminam/), for automating SF decomposed metadata
- [Michael Havrilla](https://www.linkedin.com/in/%F0%9F%92%BB-michael-havrilla-69063036/), for the integration with Vector.dev allowing to provide monitoring logs to external systems like DataDog
- [Teoman Sertcelik](https://www.linkedin.com/in/teoman-sertcelik/), for allowing to configure authentication using External Client App
- [Fernando Fernandez](https://www.linkedin.com/in/fernandofernandez1/), for the great command that [detects objects fields usage](https://sfdx-hardis.cloudity.com/hardis/doc/object-field-usage/)
- [Yamilet Oliva](https://www.linkedin.com/in/yamiletoliva/), for sfdx-hardis spanish translation and the enriched Flow error monitoring notifications
- [Shinnosuke Takakura](https://www.linkedin.com/in/shinnosuke-takakura-9041ba217/), for sfdx-hardis japanese translation
- [Dagmara Ryborz](https://www.linkedin.com/in/dagmara-ryborz-7618b991/), for Polish translation
- [Matt Carvin](https://www.linkedin.com/in/matthew-carvin/), for the [underused permission sets command](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/underusedpermsets/) and the real deployment metrics of [smart deploy](https://sfdx-hardis.cloudity.com/hardis/project/deploy/smart/)
- [Salik Lennert Pedersen](https://www.linkedin.com/in/saliklp/), for his numerous bug fixes, the [hardis:mdapi:read](https://sfdx-hardis.cloudity.com/hardis/mdapi/read/) and [hardis:mdapi:upsert](https://sfdx-hardis.cloudity.com/hardis/mdapi/upsert/) commands, git worktrees support and Flow deletion in destructive changes
- [Ryad Meguimi](https://www.linkedin.com/in/ryad-meguimi/), for the Light & Dark modes and the whole refactoring of CSS
- [Nicholas Fiorendi](https://www.linkedin.com/in/nicholas-fiorendi/), for Italian translation
- [Timo Pouw](https://www.linkedin.com/in/timopouw/), for Dutch translation
- [Quentin Tiercelin](https://github.com/TiercelinQ), for the commands to [detect unsecure permissions](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unsecure-permissions/) and [generate a data dictionary](https://sfdx-hardis.cloudity.com/hardis/doc/data-dictionary/)
- [Pranay Jaiswal](https://github.com/pranayjswl007), for smarter [audit trail monitoring](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/audittrail/) with allowed actions per user
- [Maciej Ptak](https://github.com/0ptaq0), for fixing Flow git diff on projects with custom package directories
- [Eric Mulder](https://github.com/ericmulder-welisa), for revising the [sandbox setup and best practices documentation](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-activate-org/)
- [Maxime Guenego](https://github.com/maximeg44), for the metadata lint commands: [unused metadata](https://sfdx-hardis.cloudity.com/hardis/lint/unusedmetadatas/), [inactive metadata](https://sfdx-hardis.cloudity.com/hardis/lint/metadatastatus/) and [missing descriptions](https://sfdx-hardis.cloudity.com/hardis/lint/missingattributes/)
- [Meric Asaner](https://github.com/masaner), for the [unused users detection](https://sfdx-hardis.cloudity.com/hardis/org/diagnose/unusedusers/) and bulkified Flow deletions
- [Brahim Laissaoui](https://github.com/laissaouibrahim), for major [files export](https://sfdx-hardis.cloudity.com/hardis/org/files/export/) improvements (batched processing, Attachments support)
- [Dimitri Monge](https://github.com/dimitrimonge), for the [user freeze/unfreeze](https://sfdx-hardis.cloudity.com/hardis/org/user/freeze/) commands and the Jenkins and GitHub Actions pipeline templates
- [zzyviolette](https://github.com/zzyviolette), for restoring Connected Apps after a [sandbox refresh](https://sfdx-hardis.cloudity.com/hardis/org/refresh/after-refresh/)
- [Yan Imensar](https://github.com/yan-imensar), for the [MS Teams notifications integration](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-ms-teams/)
- [Maksym Petrov](https://github.com/maksym-petrov-ct), for Apex Trigger support in [project documentation generation](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/) and CI runner cost savings
- [Manoel Calixto](https://github.com/manoelcalixto), for robustness fixes on sources cleaning and Flow documentation
- [Piotr](https://github.com/piotrekkr), for the [files export](https://sfdx-hardis.cloudity.com/hardis/org/files/export/) filename format options
- [Thomas Prouvot](https://github.com/tprouvot), for the [Experience Cloud communities activation command](https://sfdx-hardis.cloudity.com/hardis/org/community/update/)
- [JMMlw](https://github.com/JMMlw), for the [profile purge command](https://sfdx-hardis.cloudity.com/hardis/org/purge/profile/)
- [mbobard](https://github.com/mbobard), for the [System.debug cleaning command](https://sfdx-hardis.cloudity.com/hardis/project/clean/systemdebug/)
- [Juliano de Medeiros Machado](https://github.com/JulianoMedeirosMachado), for keeping original translations in [custom label translations](https://sfdx-hardis.cloudity.com/hardis/misc/custom-label-translations/)
- [Alain Bates](https://github.com/Alainbates), for the Bitbucket Git provider support
- [Theodoor van Donge](https://github.com/thvd), for switching [Apex logs purge](https://sfdx-hardis.cloudity.com/hardis/org/purge/apexlog/) to the Tooling API
- [Kris Goncalves](https://github.com/kg345), for the option to hide Apex code in [generated project documentation](https://sfdx-hardis.cloudity.com/hardis/doc/project2markdown/)
- [Clément Fernandez](https://github.com/clemfernandez), for the [metadata duplicates detection command](https://sfdx-hardis.cloudity.com/hardis/project/metadata/findduplicates/) and many early improvements
- [Mehdi](https://github.com/Mehdi-Cloudity), for the [bypass generation command](https://sfdx-hardis.cloudity.com/hardis/project/generate/bypass/) and its application to Flows, Validation Rules and Triggers
- [Mathieu Rodrigues](https://github.com/MathieuRodriguesCloudity), for the SFDMU configuration for CPQ projects
- [Hasnioui-Ysf](https://github.com/Hasnioui-Ysf), for the work on Permission Sets management

> Translations have been performed by GitHub Copilot with Claude Sonnet 4.6, then reviewed and arranged by real humans !

- English: [Nicolas Vuillamy](https://www.linkedin.com/in/nicolas-vuillamy/) (if someone is interested to make better english, please contact me !)
- French: [Nicolas Vuillamy](https://www.linkedin.com/in/nicolas-vuillamy/)
- Spanish: [Yamilet Oliva](https://www.linkedin.com/in/yamiletoliva/)
- German: [Roman Hentschke](https://www.linkedin.com/in/derroman/)
- Polish: [Dagmara Ryborz](https://www.linkedin.com/in/dagmara-ryborz-7618b991/)
- Japanese: [Shinnosuke Takakura](https://www.linkedin.com/in/shinnosuke-takakura-9041ba217/)
- Brazilian-portuguese: [Matheus Delazeri](https://www.linkedin.com/in/matheus-delazeri-souza/)
- Italian: [Nicholas Fiorendi](https://www.linkedin.com/in/nicholas-fiorendi/)
- Dutch: [Timo Pouw](https://www.linkedin.com/in/timopouw/)

<!-- contributors.md end -->

## Commands

[**Read Online Documentation to see everything you can do with SFDX Hardis :)**](https://sfdx-hardis.cloudity.com)

<!-- commands -->