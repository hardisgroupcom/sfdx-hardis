<!-- This file has been generated with command 'sfdx hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
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
  

## Parameters

| Name                  |  Type   | Description                                                         | Default | Required |                        Options                        |
|:----------------------|:-------:|:--------------------------------------------------------------------|:-------:|:--------:|:-----------------------------------------------------:|
| apiversion            | option  | override the api version used for api requests made by this command |         |          |                                                       |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                     |         |          |                                                       |
| excludeusers<br/>-e   | option  | Comma-separated list of usernames to exclude                        |         |          |                                                       |
| json                  | boolean | format output as json                                               |         |          |                                                       |
| lastndays<br/>-t      | option  | Number of days to extract from today (included)                     |         |          |                                                       |
| loglevel              | option  | logging level for this command invocation                           |  warn   |          | trace<br/>debug<br/>info<br/>warn<br/>error<br/>fatal |
| outputfile<br/>-o     | option  | Force the path and name of output report file. Must end with .csv   |         |          |                                                       |
| skipauth              | boolean | Skip authentication check when a default username is required       |         |          |                                                       |
| targetusername<br/>-u | option  | username or alias for the target org; overrides default target org  |         |          |                                                       |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration           |         |          |                                                       |

## Examples

```shell
sfdx hardis:org:diagnose:audittrail
```

```shell
sfdx hardis:org:diagnose:audittrail --excludeusers baptiste@titi.com
```

```shell
sfdx hardis:org:diagnose:audittrail --excludeusers baptiste@titi.com,bertrand@titi.com
```

```shell
sfdx hardis:org:diagnose:audittrail --lastndays 5
```


