<!-- markdownlint-disable MD034 -->

[![sfdx-hardis by Cloudity Banner](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/sfdx-hardis-banner.png)](https://sfdx-hardis.cloudity.com)

_Presented at_ [_Dreamforce 23_](https://reg.salesforce.com/flow/plus/df23/sessioncatalog/page/catalog/session/1684196389783001OqEl) _and [_Dreamforce 24!_](https://reg.salesforce.com/flow/plus/df24/sessioncatalog/page/catalog/session/1718915808069001Q7HH)_

[![Version](https://img.shields.io/npm/v/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
[![Downloads/week](https://img.shields.io/npm/dw/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
[![Downloads/total](https://img.shields.io/npm/dt/sfdx-hardis.svg)](https://npmjs.org/package/sfdx-hardis)
[![Docker Pulls](https://img.shields.io/docker/pulls/hardisgroupcom/sfdx-hardis)](https://hub.docker.com/r/hardisgroupcom/sfdx-hardis/tags)
[![GitHub stars](https://img.shields.io/github/stars/hardisgroupcom/sfdx-hardis)](https://GitHub.com/hardisgroupcom/sfdx-hardis/stargazers/)
[![GitHub contributors](https://img.shields.io/github/contributors/hardisgroupcom/sfdx-hardis.svg)](https://gitHub.com/hardisgroupcom/sfdx-hardis/graphs/contributors/)
[![Mega-Linter](https://github.com/hardisgroupcom/sfdx-hardis/workflows/Mega-Linter/badge.svg?branch=main)](https://github.com/hardisgroupcom/sfdx-hardis/actions?query=workflow%3AMega-Linter+branch%3Amain)
[![Secured with Trivy](https://img.shields.io/badge/Trivy-secured-green?logo=docker)](https://github.com/aquasecurity/trivy)
[![License](https://img.shields.io/npm/l/sfdx-hardis.svg)](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

Sfdx-hardis is a **CLI and visual productivity tools suite for Salesforce**, by [**Cloudity**](https://cloudity.com/) & friends, natively compliant with most Git platforms, messaging tools, ticketing systems and AI providers (including Agentforce).

![Native Integrations](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/integrations.png)

It is free and Open-Source, and will allow you to simply:

- [Deliver your projects with **State of the art Salesforce DevOps**](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-home/)

![DevOps Pipeline UI](https://sfdx-hardis.cloudity.com/assets/images/sfdx-hardis-pipeline-view.gif)

- [**Backup Metadatas** and **Monitor your Salesforce orgs**](https://sfdx-hardis.cloudity.com/salesforce-monitoring-home/)

![Monitoring with Grafana](https://sfdx-hardis.cloudity.com/assets/images/grafana-screenshot.jpg)

- [Generate your **Project Documentation** with AI](https://sfdx-hardis.cloudity.com/salesforce-project-documentation/)

![Salesforce AI Generated Documentation](https://sfdx-hardis.cloudity.com/assets/images/screenshot-object-diagram.jpg)

- Enjoy many commands that will **save your minutes, hours or even days** in your daily **Admin or Developer** work.

![Productivity commands](https://sfdx-hardis.cloudity.com/assets/images/ProductivityCommands.png)

If you need guidance about how to leverage sfdx-hardis to bring more value to your business, Cloudity's international multi-cloud teams of business experts and technical experts can help: [contact us](https://cloudity.com/#form) !

[_See online documentation for a better navigation_](https://sfdx-hardis.cloudity.com)

___

**sfdx-hardis** commands and configuration are best used with an UI in [**SFDX Hardis Visual Studio Code Extension**](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

[![VsCode SFDX Hardis](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/extension-demo.gif)](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis)

___

_See Dreamforce presentation_

[![See Dreamforce presentation](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/play-dreamforce-session.png)](https://www.youtube.com/watch?v=o0Mm9F07UFs)

## Installation

<!-- installation.md start -->

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

<!-- installation.md end -->

## Usage

```sh-session
sf hardis:<COMMAND> <OPTIONS>
```

## Events

<!-- events.md start -->

### Coming soon: DevOps Dreamin '25, London

[Why you don't need DevOps vendors tools](https://devopsdreamin.com/agenda/)

<img width="1320" height="370" alt="image" src="https://github.com/user-attachments/assets/bc1e3831-9e89-4098-bedd-40cafbba3cfd" />

### Coming soon: French Touch Dreamin '25, Paris

[Refresh your full sandboxes without needing to reconfigure everything](https://frenchtouchdreamin.com/index.php/sessions/refresh-your-full-sandboxes-without-needing-to-reconfigure-everything/), with [Mehdi Abdennasser](https://www.linkedin.com/in/mehdi-abdennasser/)

<img width="1901" height="661" alt="image" src="https://github.com/user-attachments/assets/7b01704b-5dd5-463e-914b-71c867632ea5" />

### Trailblazer User Group '25, Casablanca

[Salesforce Org Documentation with Open-Source and Agentforce](https://trailblazercommunitygroups.com/events/details/salesforce-salesforce-developer-group-casablanca-morocco-presents-salesforce-org-documentation-with-open-source-and-agentforce-salesforce-integration-with-connected-app/), by [Taha Basri](https://www.linkedin.com/in/tahabasri/)

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/casa-user-group-docgen.png)

### Trailblazer Developer Group '25, Berlin (online)

[Summer of Docs – Auto-Document Your Salesforce Org Like a Pro](https://trailblazercommunitygroups.com/events/details/salesforce-salesforce-developer-group-berlin-germany-presents-summer-of-docs-auto-document-your-salesforce-org-like-a-pro/), by [Mariia Pyvovarchuk](https://www.linkedin.com/in/mpyvo/) (Aspect) and [Roman Hentschke](https://www.linkedin.com/in/derroman/)

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

- SFDX-HARDIS – A demo with Nicolas Vuillamy from Cloudity

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
Everyone is welcome to contribute to sfdx-hardis (even juniors: we'll assist you !)

### Salesforce CLI Plugin: sfdx-hardis

- Install Node.js ([recommended version](https://nodejs.org/en/))
- Install typescript by running `npm install typescript --global`
- Install yarn by running `npm install yarn --global`
- Install Salesforce DX by running `npm install @salesforce/cli --global` command line
- Fork <https://github.com/hardisgroupcom/sfdx-hardis> and clone it (or just clone if you are an internal contributor)
- At the root of the repository:
  - Run `yarn` to install dependencies
  - Run `sf plugins link` to link the local sfdx-hardis to SFDX CLI
  - Run `tsc --watch` to transpile typescript into js everytime you update a TS file
- Debug commands using `NODE_OPTIONS=--inspect-brk sf hardis:somecommand --someparameter somevalue` (you can also debug commands using VsCode Sfdx-Hardis setting)

### VsCode Extension: vscode-sfdx-hardis

- Install Node.js ([recommended version](https://nodejs.org/en/))
- Install typescript by running `npm install typescript --global`
- Install yarn by running `npm install yarn --global`
- Install Visual Studio Code Insiders ([download here](https://code.visualstudio.com/insiders/))
- Fork <https://github.com/hardisgroupcom/vscode-sfdx-hardis> and clone it (or just clone if you are an internal contributor)
- At the root of the repository:
  - Run `yarn` to install dependencies
- To test your code in the VsCode Extension:
  - Open the `vscode-sfdx-hardis` folder in VsCode Insiders
  - Press `F5` to open a new VsCode window with the extension loaded (or menu Run -> Start Debugging)
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

- [Roman Hentschke](https://www.linkedin.com/in/derroman/), for building the BitBucket CI/CD integration
- [Leo Jokinen](https://www.linkedin.com/in/leojokinen/), for building the GitHub CI/CD integration
- [Mariia Pyvovarchuk](https://www.linkedin.com/in/mpyvo/), for her work about generating automations documentation
- [Matheus Delazeri](https://www.linkedin.com/in/matheus-delazeri-souza/), for the PDF output of documentation
- [Taha Basri](https://www.linkedin.com/in/tahabasri/), for his work about generating documentation of LWC
- [Anush Poudel](https://www.linkedin.com/in/anushpoudel/), for integrating sfdx-hardis with multiple LLMs using langchainJs
- [Sebastien Colladon](https://www.linkedin.com/in/sebastien-colladon/), for providing sfdx-git-delta which is highly used within sfdx-hardis
- [Stepan Stepanov](https://www.linkedin.com/in/stepan-stepanov-79a48734/), for implementing the deployment mode _delta with dependencies_
- [Shamina Mossodeean](https://www.linkedin.com/in/shaminam/), for automating SF decomposed metadata
- [Michael Havrilla](https://www.linkedin.com/in/%F0%9F%92%BB-michael-havrilla-69063036/), for the integration with Vector.dev allowing to provide monitoring logs to external systems like DataDog

<!-- contributors.md end -->

## Commands

[**Read Online Documentation to see everything you can do with SFDX Hardis :)**](https://sfdx-hardis.cloudity.com)

<!-- commands -->