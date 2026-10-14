<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:org:diagnose:audittrail

## Description

Export Audit trail into a CSV file with selected criteria, and highlight suspect actions

Also detects updates of Custom Settings values (disable by defining `SKIP_AUDIT_TRAIL_CUSTOM_SETTINGS=true`)

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
  - revokeduserpackagelicense
- Customer Portal
  - createdcustomersuccessuser
  - CSPUserDisabled
- Currency
  - updateddatedexchrate
- Data Management
  - queueMembership
- Email Administration
  - dkimRotationPreparationSuccessful
  - dkimRotationSuccessful
- External Objects
  - xdsEncryptedFieldChange
- Groups
  - groupMembership
- Holidays
  - holiday_insert
- Inbox mobile and legacy desktop apps
  - enableSIQUserNonEAC
  - siqUserAcceptedTOS
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
  - changedofflineuseroffon
  - changedprofileforuserstdtostd
  - changedprofileforuser
  - changedprofileforusercusttostd
  - changedprofileforuserstdtocust
  - changedroleforusertonone
  - changedroleforuser
  - changedroleforuserfromnone
  - changedUserAdminVerifiedStatusVerified
  - changedUserEmailVerifiedStatusUnverified
  - changedUserEmailVerifiedStatusVerified
  - changedknowledgeuseroffon
  - changedsfcontentuseroffon
  - changedsupportuseroffon
  - changedusername
  - changedUserPhoneNumber
  - changedUserPhoneVerifiedStatusUnverified
  - changedUserPhoneVerifiedStatusVerified
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
  - suNetworkAdminLogin
  - suNetworkAdminLogout
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

If a user is expected to perform some specific actions (for example an integration user whose portal user provisioning automatically creates account roles), you can allow those actions for that user only using property **monitoringAllowedUsersActions**: unlike **monitoringExcludeUsernames**, any other action performed by the same user is still flagged.

Example:

```yaml
monitoringExcludeUsernames:
  - deploymentuser@cloudity.com
  - marketingcloud@cloudity.com
  - integration-user@cloudity.com

monitoringAllowedSectionsActions:
  "Some section": [] // Will ignore all actions from such section
  "Some other section": ["actionType1","actionType2","actionType3"] // Will ignore only those 3 actions from section "Some other section". Other actions in the same section will be considered as suspect.

monitoringAllowedUsersActions:
  "provisioning-user@cloudity.com": ["createdrole"] // Will ignore only createdrole from provisioning-user@cloudity.com. Any other action from this user will still be considered as suspect.
  "another-integration@cloudity.com": [] // Will ignore all actions from this user (same as monitoringExcludeUsernames, but the records remain visible in the report as not suspect)
```

## Excel output example

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-monitoring-audittrail-excel.jpg)

## Local output example

![](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-monitoring-audittrail-local.jpg)

This command is part of [sfdx-hardis Monitoring](https://sfdx-hardis.cloudity.com/salesforce-monitoring-suspect-audit-trail/) and can output Grafana, Slack and MsTeams Notifications.


### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:org:diagnose:audittrail --agent --target-org myorg@example.com
```

In agent mode, the audit trail report is generated without interactive prompts, using the default number of days.

## Parameters

| Name                |  Type   | Description                                                                                                  | Default | Required | Options |
|:--------------------|:-------:|:-------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent               | boolean | Run in non-interactive mode for agents and automation                                                        |         |          |         |
| debug<br/>-d        | boolean | Activate debug mode (more logs)                                                                              |         |          |         |
| excludeusers<br/>-e | option  | Comma-separated list of usernames to exclude                                                                 |         |          |         |
| flags-dir           | option  | Import flag values from a directory.                                                                         |         |          |         |
| json                | boolean | Format output as json.                                                                                       |         |          |         |
| lastndays<br/>-t    | option  | Number of days to extract from today (included)                                                              |         |          |         |
| outputfile<br/>-f   | option  | Force the path and name of output report file. Must end with .csv                                            |         |          |         |
| skipauth            | boolean | Skip authentication check when a default username is required                                                |         |          |         |
| target-org<br/>-o   | option  | Username or alias of the target org. Not required if the `target-org` configuration variable is already set. |         |   true   |         |
| websocket           | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                    |         |          |         |

## Examples

```shell
$ sf hardis:org:diagnose:audittrail
```

```shell
$ sf hardis:org:diagnose:audittrail --excludeusers baptiste@titi.com
```

```shell
$ sf hardis:org:diagnose:audittrail --excludeusers baptiste@titi.com,bertrand@titi.com
```

```shell
$ sf hardis:org:diagnose:audittrail --lastndays 5
```

```shell
$ sf hardis:org:diagnose:audittrail --agent
```


