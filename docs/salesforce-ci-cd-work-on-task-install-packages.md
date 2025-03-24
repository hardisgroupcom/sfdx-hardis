---
title: Install packages on your org
description: Learn how to install a package
---
<!-- markdownlint-disable MD013 -->

## Install packages

> Packages (managed or not) must **never be directly installed in a major org** (integration, uat, preprod, production), it has to be done in dev sandbox / scratch orgs

If you can find the package id (starting by `04T`), use sfdx-hardis command ![Install package button](assets/images/btn-install-package.jpg) to install package instead of installing them directly with the URL

If you installed a package using an URL, use command ![Retrieve packages button](assets/images/btn-retrieve-packages.jpg) to retrieve package config **before creating your merge request** (be careful of what you commit in .sfdx-hardis.yml file !)

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/5-MgqoSLUls" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

> Once packages are referenced in `.sfdx-hardis.yml`, they will automatically be installed on major orgs during CI/CD deployments

> If you want packages to be installed during deployment check, see with your release manager to define `installPackagesDuringCheckDeploy: true` in your `.sfdx-hardis.yml` config file.
