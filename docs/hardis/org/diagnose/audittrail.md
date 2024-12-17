<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:audittrail

## Description

Export Audit trail into a CSV file with selected criteria, and highlight suspect actions

Regular setup actions performed in major orgs are filtered.

- ""
  - createScratchOrg
  - changedsenderemail
  - deleteScratchOrg
  - loginasgrantedtopartnerbt
- Certificate and Key Management
  - insertCertificate
- Custom App Licenses
  - addeduserpackagelicense
  - granteduserpackagelicense
- Customer Portal
  - createdcustomersuccessuser
- Currency
  - updateddatedexchrate
- Data Management
  - queueMembership
- Email Administration
  - dkimRotationPreparationSuccessful
  - dkimRotationSuccessful
- Groups
  - groupMembership
- Holidays
  - holiday_insert
- Inbox mobile and legacy desktop apps
  - enableSIQUserNonEAC
- Manage Users
  - activateduser
  - createduser
  - changedcommunitynickname
  - changedemail
  - changedfederationid
  - changedpassword
  - changedinteractionuseroffon
  - changedinteractionuseronoff
  - changedmarketinguseroffon
  - changedmarketinguseronoff
  - changedprofileforuser
  - changedprofileforusercusttostd
  - changedprofileforuserstdtocust
  - changedroleforusertonone
  - changedroleforuser
  - changedroleforuserfromnone
  - changedUserEmailVerifiedStatusUnverified
  - changedUserEmailVerifiedStatusVerified
  - changedUserPhoneNumber
  - changedUserPhoneVerifiedStatusUnverified
  - deactivateduser
  - deleteAuthenticatorPairing
  - deleteTwoFactorInfo2
  - deleteTwoFactorTempCode
  - frozeuser
  - insertAuthenticatorPairing
  - insertTwoFactorInfo2
  - insertTwoFactorTempCode
  - lightningloginenroll
  - PermSetAssign
  - PermSetGroupAssign
  - PermSetGroupUnassign
  - PermSetLicenseAssign
  - PermSetUnassign
  - PermSetLicenseUnassign
  - registeredUserPhoneNumber
  - resetpassword
  - suOrgAdminLogin
  - suOrgAdminLogout
  - unfrozeuser
  - useremailchangesent
- Mobile Administration
  - assigneduserstomobileconfig
- Reporting Snapshots
  - createdReportJob
  - deletedReportJob
- Sandboxes
  - DeleteSandbox

By default, deployment user defined in .sfdx-hardis.yml targetUsername property will be excluded.

You can define additional users to exclude in .sfdx-hardis.yml **monitoringExcludeUsernames** property.

You can also add more sections / actions considered as not suspect using property **monitoringAllowedSectionsActions**

Example:

```yaml
monitoringExcludeUsernames:
  - deploymentuser@cloudity.com
  - marketingcloud@cloudity.com
  - integration-user@cloudity.com

monitoringAllowedSectionsActions:
  "Some section": [] // Will ignore all actions from such section
  "Some other section": ["actionType1","actionType2","actionType3"] // Will ignore only those 3 actions from section "Some other section". Other actions in the same section will be considered as suspect.
```

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-suspect-audit-trail/) and can output Grafana, Slack and MsTeams Notifications.


## Parameters

| Name                |  Type   | Description                                                       |           Default            | Required | Options |
|:--------------------|:-------:|:------------------------------------------------------------------|:----------------------------:|:--------:|:-------:|
| debug<br/>-d        | boolean | Activate debug mode (more logs)                                   |                              |          |         |
| excludeusers<br/>-e | option  | Comma-separated list of usernames to exclude                      |                              |          |         |
| flags-dir           | option  | undefined                                                         |                              |          |         |
| json                | boolean | Format output as json.                                            |                              |          |         |
| lastndays<br/>-t    | option  | Number of days to extract from today (included)                   |                              |          |         |
| outputfile<br/>-f   | option  | Force the path and name of output report file. Must end with .csv |                              |          |         |
| skipauth            | boolean | Skip authentication check when a default username is required     |                              |          |         |
| target-org<br/>-o   | option  | undefined                                                         | hardis@cityone.fr.intfluxne2 |          |         |
| websocket           | option  | Websocket host:port for VsCode SFDX Hardis UI integration         |                              |          |         |

## Examples

```shell
sf hardis:org:diagnose:audittrail
```

```shell
sf hardis:org:diagnose:audittrail --excludeusers baptiste@titi.com
```

```shell
sf hardis:org:diagnose:audittrail --excludeusers baptiste@titi.com,bertrand@titi.com
```

```shell
sf hardis:org:diagnose:audittrail --lastndays 5
```


