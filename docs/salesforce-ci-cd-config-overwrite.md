---
title: Configure overwrite management on a Salesforce CI/CD Project
description: Learn how to manage package-no-overwrite.xml and packageDeployOnChange.xml
---
<!-- markdownlint-disable MD013 -->

- [package-no-overwrite.xml](#packagenooverwritexml)
  - [Definition](#definition)
  - [Example](#example)
- [packageDeployOnChange.xml](#packagedeployonchangexml)

___

## package-no-overwrite.xml

### Definition

For different reasons, **many metadatas are maintained manually**, using **production Salesforce org Setup**

To avoid to overwrite manual updates in setup, you must define at least a [manifest/package-no-overwrite.xml](#package-no-overwritexml) file. _(formerly named `packageDeployOnce.xml)`_

The rule is simple and must be learnt by heart:

Every item which is **existing in package.xml** AND **matching package-no-overwrite.xml** AND **existing in the target deployment org** will **NOT be deployed**.

This means that **an item matching package-no-overwrite.xml** will be **deployed the first time**, but **never overwritten**, so has to be **manually maintained in org using Setup**.

- This file must be located at `manifest/package-no-overwrite.xml` (formerly packageDeployOnce.xml)
- It has the **same format than a package.xml**, but must be **written manually**
- It can contain named items, or wildcards `*`
- Theoretically, any metadata can be added in package-no-overwrite.xml, but here are the most commonly present:
  - Connected apps
  - Dashboards
  - Named Credentials
  - Profiles
  - Remote Site Settings
  - Reports
  - SAML SSO Configuration
  - Wave items (CRM Analytics)

### Example

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <!-- Approval processes can contain reference to usernames -->
  <types>
      <members>*</members>
      <name>ApprovalProcess</name>
  </types>
  <!-- Connected apps contain org unique auth info so must never be overwritten -->
  <types>
      <members>*</members>
      <name>ConnectedApp</name>
  </types>
  <types>
    <!-- Apps that contain hardcoded dashboard its must be managed directly in production -->
    <members>DeclareWork</members>
    <members>Facturation</members>
    <members>SomeApp2</members>
    <name>CustomApplication</name>
  </types>
  <types>
    <!-- Once a dashboard is published, it is always managed directly in production -->
    <members>*</members>
    <name>Dashboard</name>
  </types>
  <types>
    <!-- flexipages that contain Dashboard ids -->
    <members>Accueil_administrateur</members> 
    <members>Accueil_administratif</members>
    <members>Accueil_Commerciaux</members>
    <members>Accueil_Direction</members>
    <members>Accueil_Recrutement</members>
    <name>Flexipage</name>
  </types> 
  <types>
    <!-- Name Credentials can contain auth info that are different between dev, uat, preprod and prod: let's not overwrite them ! -->
    <members>*</members>
    <name>NamedCredential</name>
  </types>  
  <types>
    <!-- Use permission sets -->
    <members>*</members>
    <name>Profile</name>
  </types>
  <types>
    <!-- Remote site settings can be different between dev, uat, preprod and prod: let's not overwrite them ! -->
    <members>*</members>
    <name>RemoteSiteSetting</name>
  </types>  
  <types>
    <!-- Reports are maintained directly in production -->
    <members>*</members>
    <name>Report</name>
  </types>
    <!-- SSO Config must be performed directly in org setup -->  
  <types>
      <members>*</members>
      <name>SamlSsoConfig</name>
  </types>
  <!-- Wave items in case you want to manage them directly in production -->
  <types>
    <members>*</members>
    <name>WaveApplication</name>
  </types>
  <types>
    <members>*</members>
    <name>WaveDashboard</name>
  </types>
  <types>
    <members>*</members>
    <name>WaveDataflow</name>
  </types>
  <types>
    <members>*</members>
    <name>WaveDataset</name>
  </types>
  <types>
    <members>*</members>
    <name>WaveRecipe</name>
  </types>
  <types>
    <members>*</members>
    <name>WaveXmd</name>
  </types>
  <version>53.0</version>
</Package>
```

## packageDeployOnChange.xml

packageDeployOnChange.xml is slightly different from package-no-overwrite.xml: it will deploy only if the target metadata XML is different from the source metadata XML that we want to deploy

- This file must be located at `manifest/packageDeployOnChange.xml`
- It can contain named items, or wildcards `*`
- Is has much **lower performances than package-no-overwrite.xml**, so must be **used wisely**
- Theoretically, any metadata can be added in packageDeployOnChange.xml, but here are the most commonly present:
  - Sharing Rules
  - Sharing Owner Rules
