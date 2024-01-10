---
title: Configure Integrations between sfdx-hardis and any ticketing system
description: Enrich pull requests & notifications with ticketing info
---
<!-- markdownlint-disable MD013 -->

## Generic ticketing integration

If you use a ticketing system on your project, sfdx-hardis can use it to enrich its integrations

Sfdx-hardis will automatically analyze commits and PR/MR descriptions to collect tickets and build their urls !

![](assets/images/screenshot-generic-ticketing.jpg)

## Configuration

You need to define 2 environment variables in your CI/CD configuration

### GENERIC_TICKETING_PROVIDER_REGEX

Regular expression allowing to detect your ticketing system identifiers in the commits / PR texts.

You can use https://regex101.com/ to check your Regular Expression.

Example: `([R|I][0-9]+-[0-9]+)` to detect EasyVista references, that can look like `I240103-0133` or
`R230904-0026`

### GENERIC_TICKETING_PROVIDER_URL_BUILDER

Template string allowing to build a hyperlink from a ticket identifier.

Must contain a **{REF}** segment that will be replaced by the ticket identifier.

Example: `https://instance.easyvista.com/index.php?ticket={REF}`

## Technical notes

This integration use the following variables, that must be available from the pipelines:

- GENERIC_TICKETING_PROVIDER_REGEX
- GENERIC_TICKETING_PROVIDER_URL_BUILDER
