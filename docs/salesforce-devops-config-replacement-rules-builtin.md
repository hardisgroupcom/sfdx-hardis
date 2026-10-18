---
title: Built-in replacement rules (Beta)
description: The XML elements and user permissions sfdx-hardis removes before deploying, when the target org does not accept them
---

<!-- markdownlint-disable MD013 -->
<!-- Generated from src/common/replacementRules: run node --import tsx scripts/build-builtin-replacement-rules-doc.ts -->

## Built-in replacement rules (Beta)

Built-in [replacement rules](salesforce-devops-config-replacement-rules.md) ship with sfdx-hardis. Before each deployment, they remove what the target org would refuse: XML elements its API version does not know yet or does not accept anymore, and user permissions it does not have.

The deployment API version is the lowest of the connection version (the `org-api-version` sf config or `SF_ORG_API_VERSION` when set, otherwise the maximum API version of the target org), the `sourceApiVersion` of `sfdx-project.json` and the version of the deployed package.xml.

Turn a rule on or off in `config/.sfdx-hardis.yml`, a branch config file or the replacement rules issue, or from the **Built-in rules** tab of the VS Code panel:

```yaml
replacementRules:
  - id: builtin-flow-get-records-limit
    enabled: true
  - id: builtin-unknown-user-permissions
    enabled: false
```

### Rules on by default

| Rule                                         | What it removes                                                                                                        | Elements                                                                                                                                               | Removed when the API is       |
|----------------------------------------------|------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------|
| `builtin-flow-ends`                          | End elements saved by Flow Builder from Winter '27, and the connectors pointing to them (the flow ends the same way)   | `Flow/ends`                                                                                                                                            | below 68.0                    |
| `builtin-flow-groups`                        | Canvas groups of Flow elements, visual only                                                                            | `Flow/groups`, `Flow/*/group`                                                                                                                          | below 68.0                    |
| `builtin-flow-schedule-day-of-month`         | Day of month of a scheduled flow (monthly schedules)                                                                   | `Flow/start/schedule/dayOfMonthToRun`                                                                                                                  | below 66.0                    |
| `builtin-flow-schedule-frequency-number`     | Frequency number of a segment-triggered flow schedule                                                                  | `Flow/start/schedule/frequencyNumber`                                                                                                                  | below 66.0                    |
| `builtin-flow-screen-style-settings`         | Style settings of a screen, visual only                                                                                | `Flow/screens/styleSettings`                                                                                                                           | below 66.0                    |
| `builtin-flow-screen-field-style`            | Width and alignment of screen fields, visual only                                                                      | `Flow/screens//fields/styleProperties`                                                                                                                 | below 64.0                    |
| `builtin-flow-choice-icon`                   | Icon of a choice, visual only                                                                                          | `Flow/choices/choiceIcon`                                                                                                                              | below 64.0                    |
| `builtin-flow-metrics-data-cloud`            | Flow metrics sent to Data Cloud                                                                                        | `Flow/areMetricsLoggedToDataCloud`                                                                                                                     | below 63.0                    |
| `builtin-flow-custom-properties`             | Custom properties of a flow (screen progress indicator), visual only                                                   | `Flow/customProperties`                                                                                                                                | below 63.0                    |
| `builtin-view-all-fields-false`              | View All Fields object permission when it is false                                                                     | `Profile/objectPermissions/viewAllFields[.=false]`, `PermissionSet/objectPermissions/viewAllFields[.=false]`                                           | below 63.0                    |
| `builtin-agent-accesses`                     | Agentforce agent accesses, no agent exists in older orgs                                                               | `Profile/agentAccesses`, `PermissionSet/agentAccesses`                                                                                                 | below 63.0                    |
| `builtin-email-routing-address-accesses`     | Email routing address accesses of a permission set                                                                     | `PermissionSet/emailRoutingAddressAccesses`                                                                                                            | below 62.0                    |
| `builtin-service-presence-status-accesses`   | Service presence status accesses                                                                                       | `Profile/servicePresenceStatusAccesses`, `PermissionSet/servicePresenceStatusAccesses`                                                                 | below 64.0                    |
| `builtin-gen-computing-summary-def-accesses` | Generative computing summary definition accesses                                                                       | `Profile/genComputingSummaryDefAccesses`, `PermissionSet/genComputingSummaryDefAccesses`                                                               | below 66.0                    |
| `builtin-unknown-user-permissions`           | User permissions the target org does not have: unknown to its API version, or not enabled by its licenses and features | `Profile/userPermissions`, `PermissionSet/userPermissions`                                                                                             | any version (the org decides) |
| `builtin-aura-static-res-pref`               | Lightning Experience setting of a cancelled release update                                                             | `LightningExperienceSettings/enableAuraSecStaticResCRUCPref`                                                                                           | 68.0 or above                 |
| `builtin-analytics-incremental-upsert`       | Analytics incremental upsert setting                                                                                   | `AnalyticsSettings/incrementalUpsertEnabled`                                                                                                           | 68.0 or above                 |
| `builtin-help-menu-settings`                 | Help menu settings of User Engagement                                                                                  | `UserEngagementSettings/enableHelpMenuShowHelp`, `UserEngagementSettings/enableHelpMenuShowNewUser`, `UserEngagementSettings/enableHelpMenuShowSearch` | 65.0 or above                 |
| `builtin-enhanced-sites-pref`                | Enhanced sites and content platform setting                                                                            | `SiteSettings/enableEnhancedSitesAndContentPlatform`                                                                                                   | 63.0 or above                 |
| `builtin-voice-whatsapp-pref`                | Service Cloud Voice WhatsApp setting                                                                                   | `ServiceCloudVoiceSettings/enableDigitalVoiceWhatsapp`                                                                                                 | 65.0 or above                 |

### Rules off by default

These elements change what a component does: without `limit`, a Get Records element returns every record. They are not removed unless you turn the rule on. When one is found in a deployed file, the Pull Request comment says the deployment will fail and names the rule that removes it.

| Rule                                     | What it removes                                                                                          | Elements                                                                                                                                                          | Removed when the API is |
|------------------------------------------|----------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------|
| `builtin-view-all-fields-true`           | View All Fields object permission when it is true: removing it removes the access                        | `Profile/objectPermissions/viewAllFields[.=true]`, `PermissionSet/objectPermissions/viewAllFields[.=true]`                                                        | below 63.0              |
| `builtin-flow-schedule-days-of-week`     | Days of week of a scheduled flow: without them, a weekly flow runs on the weekday of its start date only | `Flow/start/schedule/daysOfWeekToRun`                                                                                                                             | below 66.0              |
| `builtin-flow-get-records-limit`         | Number of records of a Get Records element: without it, every matching record is returned                | `Flow/recordLookups/limit`                                                                                                                                        | below 63.0              |
| `builtin-flow-upsert`                    | Upsert options of a Create Records element: without them, the element always creates                     | `Flow/recordCreates/doesUpsert`, `Flow/recordCreates/doesUpsertAllOrNone`, `Flow/recordCreates/upsertExternalIdField`, `Flow/recordCreates/upsertStandardIdField` | below 62.0              |
| `builtin-flow-create-matching-records`   | Matching record filters of a Create Records element                                                      | `Flow/recordCreates/filters`, `Flow/recordCreates/filterLogic`                                                                                                    | below 61.0              |
| `builtin-flow-action-wait`               | Wait options of an action: without them, the flow does not wait for the action to complete               | `Flow/actionCalls/isWaitUntilCompleted`, `Flow/actionCalls/offset`, `Flow/actionCalls/offsetUnit`                                                                 | below 61.0              |
| `builtin-flow-action-timeout`            | Timeout path of an action                                                                                | `Flow/actionCalls/timeoutConnector`                                                                                                                               | below 62.0              |
| `builtin-flow-action-timeout-path-usage` | Timeout path usage of an action                                                                          | `Flow/actionCalls/timeoutPathUsage`                                                                                                                               | below 66.0              |
| `builtin-flow-decision-attributes`       | Attributes of a decision (AI descriptions and prompts used to decide)                                    | `Flow/decisions/attributes`, `Flow/decisions/rules/attributes`                                                                                                    | below 65.0              |

### User permissions

The rule `builtin-unknown-user-permissions` removes each `userPermissions` entry of a Profile or a Permission Set that the target org does not have.

- **With a connection to the target org** (deployments, scratch orgs, backpromote): sfdx-hardis reads the `Permissions<Name>` fields of the `PermissionSet` object of the org. That list follows the API version of the org, and also its licenses and enabled features: a permission of a cloud the org does not have is removed too.
- **Without a connection** (`hardis:project:replacement:preview` without `--target-org`): sfdx-hardis uses the list below, by deployment API version. It comes from the describe of an Enterprise Edition sandbox and a Developer Edition org, so it cannot hold the permissions of every cloud.

<!-- cspell:disable -->

<details><summary>New in API 58.0: removed when the API is below 58.0 (28)</summary>

`AccessCdpProfileExplorer`, `AccessToComplaintMgmt`, `ActivateDeactivateNonSetupFlow`, `AuthorizePayments`, `BREAlertsUserAccess`, `CanUpdateEmailMessage`, `CaptureAndReversePayments`, `CdcReportingCreateReports`, `CdcReportingManageFolders`, `CdcReportingViewReports`, `CombAuthAndCapPayments`, `CreateEditNonSetupFlow`, `DeleteNonSetupFlow`, `EmbeddedMessagingAgent`, `ExternalClientAppAdmin`, `ExternalClientAppDeveloper`, `ExternalClientAppViewer`, `MakePayments`, `ManageForecastingCustomData`, `OrgPerformanceAccess`, `PerformanceAnalysisAccess`, `RefundPayments`, `RunDecisionMatrix`, `RunExpressionSet`, `UmaQueryCMSEmailContent`, `VideoConferenceMeetUser`, `ViewNonSetupFlow`, `ViewPayments`

</details>

<details><summary>New in API 59.0: removed when the API is below 59.0 (23)</summary>

`AccessToDisputeManagement`, `AddCreaRecElmntToNonSetupFlow`, `AddDecisionElmntNonSetupFlow`, `AddWaitToNonSetupFlow`, `CanInitiateMessagingSessions`, `CodeBuilderUser`, `CreateModFormTrigNonSetupFlow`, `CreateModSgmtTrigNonSetupFlow`, `DeleteCrMemoAndInvoice`, `DigitalLendingUser`, `DownloadPackageVersionZips`, `ExecutePromptTemplates`, `ManageDataMaskPolicies`, `ManageEmailMessagingSetup`, `ManageNamedCredentials`, `ManagePromptTemplates`, `OmnichannelInventoryBasic`, `PreviewTestSendEmail`, `SegmentIntelligenceUser`, `SendEmail`, `UMAStandaloneUserPerm`, `UseOMAnalytics`, `ViewEmailMessagingSetup`

</details>

<details><summary>New in API 60.0: removed when the API is below 60.0 (29)</summary>

`AccessDisputePrompts`, `ActivateSystemModeFlows`, `AddUpdtRecElmntToNonSetupFlow`, `AdvancedCsvDataImportUser`, `ConsentBannerSettingsSetup`, `ContactInspectorUser`, `DigitalLendingAdminUser`, `EinsteinCopilotBuilder`, `EinsteinCopilotUser`, `GetRecordDetailsUserAccess`, `GlobalCbPQueryAccess`, `LeadInspectorUser`, `LobbyManagementUserAccess`, `ManageContentTaxonomy`, `ManageOrchestrationRuns`, `McScoringRulesConfig`, `PRMChannelMgmtConsoleUser`, `PersonalizationPlatform`, `PersonalizedFinanceUserAccess`, `ReassignOrchestrationWorkItems`, `SimpleCsvDataImportUser`, `StageManagementDesignUser`, `UmaEditConsentSettings`, `UseExchangesAPIs`, `UsePartnerMessagingChannels`, `UseRegisterGuestBuyerAPI`, `ViewAllNonSetupFlows`, `ViewContentTaxonomy`, `ViewEnablementAnalytics`

</details>

<details><summary>New in API 61.0: removed when the API is below 61.0 (56)</summary>

`AccessServiceEinstein`, `AddAsgntElmntToNonSetupFlow`, `AddCollFltrElmntToNonSetupFlow`, `AddCollSrtElmntToNonSetupFlow`, `AddDelRecElmntToNonSetupFlow`, `AddGetRecElmntToNonSetupFlow`, `AddLoopElmntToNonSetupFlow`, `AddSubflowElmntToNonSetupFlow`, `AttributionModelUser`, `CosellAuthSetupUser`, `CosellExportUser`, `DigitalLendingEditReadOnly`, `DigitalLendingWorkbench`, `EditAccountScoreFields`, `EnhancedSalesMobileExp`, `FreezeUsers`, `GetConversationTranscripts`, `HeadlessPublishNudges`, `ManageAccessPolicies`, `ManageBriefs`, `ManageCdpMlModels`, `ManageCertificatesExpiration`, `ManageCustomDomains`, `ManageDevSandboxes`, `MetadataStudioUser`, `ModifyAllDataGovClassif`, `ModifyAllDataGovClsfTax`, `ModifyAllDataGovPolicies`, `ModifyAllDataGovTagAssign`, `ModifyAllDataGovTags`, `ModifyAllDataGovTax`, `MonitorLoginHistory`, `PersonalizationIntelUser`, `PrismPlaygroundUser`, `RunCatalogItemsOnBehalfOf`, `SlackElevate`, `SvcInnovationsEinsteinFeatr`, `TableauCreateDashboard`, `TableauViewDashboard`, `TriggerDataGovAutoTagging`, `UMAWebTrackingSetup`, `UseAddAdjustment`, `UseAddOrderItemSummary`, `UseCreateCreditMemo`, `UseCreateOrderSummary`, `UseEnsureFunds`, `UseOrderItemSummaryCancel`, `UseOrderItemSummaryReturn`, `UseRouting`, `UseServiceCatalogForGuest`, `ViewAllCalls`, `ViewAllDataGovPolicies`, `ViewAllDataGovTags`, `ViewConsumption`, `ViewDataGovTab`, `YourAccountCDAPublishEvents`

</details>

<details><summary>New in API 62.0: removed when the API is below 62.0 (47)</summary>

`AccessSfDrive`, `AddPathExprmElmntNonSetupFlow`, `AddTrfmElmntToNonSetupFlow`, `AgentforceServiceAgentUser`, `AppFrameworkManageApp`, `AppFrameworkViewApp`, `ApprovalAdmin`, `ApprovalDesigner`, `CanMarketingUserDebugFlow`, `CanSendInitialSMSToIndividual`, `CanViewDataPrepRecipe`, `CitrixVDIPlatform`, `ConfigureCCTarget`, `ConfigureCommunicationCapping`, `CreateModAutEvtNonSetupFlow`, `EMIAdmin`, `EMIMarketingDataSpecialist`, `EMIMarketingManager`, `EinsteinSalesCoachAgent`, `EinsteinSdrAAPerm`, `EinsteinSdrAccessPerm`, `EinsteinSdrConfigPerm`, `EinsteinSdrWorkerPerm`, `EngagementConfigUser`, `MCGSetupUserPerm`, `ManageAgentforceServiceAgent`, `ManageEinsteinSalesCoach`, `ManageFilesAndAttachments`, `ManageIntegrationConnections`, `MobileMessagingAgent`, `ModifyAllPolicyCenterPolicies`, `OpportunityInfluence`, `PrmExtIntPrtnrAdminUser`, `QueryNonVetoedFiles`, `TableauCreateVisualization`, `TableauCreateWorkspace`, `TableauMetricCards`, `TableauViewVisualization`, `TableauViewWorkspace`, `UseAdvancedDeliveryEstimationAPI`, `UseDeliveryEstimationAPIs`, `UseEinsteinSalesCoach`, `UseServicePartReturn`, `ViewAccessPolicies`, `ViewAllPolicyCenterPolicies`, `ViewOrchestrationsInAutomApp`, `ViewRecommendations`

</details>

<details><summary>New in API 63.0: removed when the API is below 63.0 (23)</summary>

`AccessEinsteinAutofill`, `AppFrameworkManageTemplate`, `AutomatedDealTracking`, `CampDesignerSettingsSetup`, `CanDoActAsUser`, `CreateModDGTrigNonSetupFlow`, `DigitalAgentUser`, `EinsteinAgentPlatformBuilder`, `EinsteinMCDesignerUser`, `ManageMyExternalUsers`, `ModifyAccessAllowPolicies`, `ModifyAccessDenyPolicies`, `PersonalizationDecisioningUser`, `RecommendedActions`, `SalesActionPlansUserAccess`, `SalesforceForecastingUser`, `SlackFromTableau`, `TableauShareSnapshot`, `TerritoryOperations`, `UseCanCancelInProgressChange`, `ViewAllFieldsGlobal`, `ViewPublicCapstoneFolders`, `ViewUMACalendar`

</details>

<details><summary>New in API 64.0: removed when the API is below 64.0 (27)</summary>

`AIWorkbenchUser`, `AccessBankingRelationshipAssistance`, `AccessBankingServiceAgent`, `AccessPolicyAgent`, `AccessWealthAdvisorAgent`, `CdpConnectionManagementUser`, `CreateModActTrigNonSetupFlow`, `DataCleanRoomQueryAccess`, `DataCleanRoomReadAccess`, `DataCleanRoomSetupAccess`, `DataCleanRoomWriteAccess`, `HydratePromptTemplateIA`, `MCPMetadataApi`, `ManageApiNamedQueries`, `ManageBusinessUnit`, `ManageHerokuAppLink`, `MngBenVerfForAssistiveAgnt`, `OmniAssistiveActionUser`, `PrismBackofficeUser`, `PrmEnhancedPortalUser`, `SetupAgentBuilder`, `SetupAgentUser`, `UseInboxSchedulingOnBehalfOf`, `UserCanDeployStore`, `UserHasSendToListFilterAccess`, `ViewApiNamedQueries`, `ViewBusinessUnit`

</details>

<details><summary>New in API 65.0: removed when the API is below 65.0 (53)</summary>

`AITestingUser`, `AcceptRiskForProblems`, `AccessKnowledgeSpace`, `AccessOrchestrationObjects`, `ActivateTenantSchemaChanges`, `AgentforceSalesChatGPT`, `AllowOCIAvailabilityAPIs`, `AssocChgRqstAndProb`, `AssocIncAndChgRqst`, `AssocIncAndProb`, `AssocRelAndChgRqst`, `AssocRelAndInc`, `AssocRelAndProb`, `CanApproveUninstalledApps`, `DelegatedContactCenterAdmin`, `DeleteChangeRequest`, `DeleteIncident`, `DeleteProblem`, `FetchTenantSchemaChanges`, `ManageCustomerDataOptOut`, `ManageDataAnalyticsGroups`, `ManageJourneys`, `ManageOCIRecords`, `ManageSMSDomainSetup`, `ModifyAllDataGovTagPropagation`, `ProposeMajorIncidents`, `QrCodeGeneratorMobilePublisherPlayground`, `ReadConfigurationItemInformation`, `ReopenProblems`, `ResolveChgRqstAssoc`, `ResolveIncAssoc`, `ResolveProbAssoc`, `UseOrderSummaryChangeAPIs`, `UsePaymentCreditAPIs`, `UseSetupWithAgentforce`, `UseTeamsForItSrvcs`, `UserInteractionInsights`, `ViewAgtfrceAnlytDshbrd`, `ViewCaseAnlytDshbrd`, `ViewChangeRequestAnlytDshbrd`, `ViewChangeRequestDshbrd`, `ViewIncidentAnlytDshbrd`, `ViewIncidentFulfrDshbrd`, `ViewIncidentMgrDshbrd`, `ViewItLeaderAnlytDshbrd`, `ViewItsmConsoleAsFulfr`, `ViewItsmConsoleHmpg`, `ViewKnwlgAnlytDshbrd`, `ViewLicenseUtilization`, `ViewOmnichnlAnlytDshbrd`, `ViewProblemFulfrDshbrd`, `ViewProblemMgrDshbrd`, `ViewShieldApp`

</details>

<details><summary>New in API 66.0: removed when the API is below 66.0 (18)</summary>

`AccessToComplaintAgent`, `ActivationWrite`, `BillingInvoiceSuperUser`, `CanExitFlowViaAPI`, `ClaimUnclaimNumber`, `CreateModIndRecNonSetupFlow`, `CreateModOnDemandNonSetupFlow`, `DeleteSalesforceFiles`, `DownloadMaliciousFiles`, `IntegrationIntelligenceUser`, `IntelligentDocumentProcessing`, `ManageIntegrationPortals`, `ManageMCEEmails`, `ManageMaliciousFiles`, `UnifiedEHDViewer`, `UseFulfillmentRoutingAPIs`, `UseRestrictedTheme`, `UseTeamsForEmployee`

</details>

<details><summary>New in API 67.0: removed when the API is below 67.0 (36)</summary>

`AcceptInboundBundling`, `AccessBuilderCentral`, `AccessCommandCenter`, `AddSendToFlowElmntToNonSetupFlow`, `BatchManagementUser`, `BreakGlassLoginAllowed`, `BuildAgentWithSimplifiedAgentConfig`, `CanQueryForeignTables`, `CdpPerUserConnectionManagement`, `CreateModCampaignMemberTrigNonSetupFlow`, `CreateModListTrigNonSetupFlow`, `CreateModRecordQueryFlow`, `EasySuitesInvoicingUser`, `GrantOutboundBundling`, `ManageCoreGovernance`, `ManageHealthAssessments`, `ManageMarketingObjects`, `ManageQuickAttributes`, `ManageSharedListViews`, `ManageSocialPosting`, `MarketingActionableListUser`, `MeetingEngagementUser`, `ModifyAllMarketingObjectRecords`, `ModifyTransactionSecurityPolicies`, `MustUseSso`, `RunMyDayUser`, `SCVVoicemailDropUser`, `SCVVoicemailGreetingUser`, `SlackbotUi`, `SuitesAgentEscalationPerm`, `UseAnyApiAuth`, `UseOMSDROInteropAPIs`, `ViewAllMarketingObjectRecords`, `ViewCoreGovernance`, `ViewHealthAssessments`, `ViewProductLimits`

</details>

<details><summary>New in API 68.0: removed when the API is below 68.0 (80)</summary>

`AIWorkbenchViewer`, `AccessSubscriber`, `AddToActionableList`, `AddToCampaign`, `ConvertProspect`, `CreateConsent`, `CreateModCadenceNonSetupFlow`, `CreateTask`, `DataCloudIngestionApi`, `DecodePreferenceCenterToken`, `DetermineCrmRecordForIndv`, `EinsteinDecidePath`, `EnteredJourneyBuilder`, `ExitedJourneyBuilder`, `ForwardToBotOrAgent`, `HeadlessPlatformInteractions`, `ManageChannelMarketingEligibility`, `ManageSubscriber`, `MetJourneyBuilderGoal`, `PartnerEACUser`, `PlatformWebIdeUser`, `ProcessWebStoreUserRgstr`, `RemoveFromActionableList`, `SendDistMktgMessageEvent`, `SendMobileAppInAppMessage`, `SendMobileAppMessage`, `SendMobileAppNewsflashMessage`, `SkillManager`, `SkillUser`, `TrgrOnAbandonedBrowse`, `TrgrOnAbandonedPage`, `TrgrOnAbandonedShoppingCart`, `TrgrOnBackInStock`, `TrgrOnBirthday`, `TrgrOnCustomEvent`, `TrgrOnEmailBounceEngagement`, `TrgrOnEmailLinkClickEngagement`, `TrgrOnEmailOpenEngagement`, `TrgrOnEmailResponseEngagement`, `TrgrOnEmailSubscription`, `TrgrOnFirstPurchaseAnniversary`, `TrgrOnFormSubmission`, `TrgrOnLowInventory`, `TrgrOnMngEventPtcpAtnd`, `TrgrOnMngEventPtcpResp`, `TrgrOnMngEventPtcpRgst`, `TrgrOnMngEventSessPtcpRgst`, `TrgrOnMngEventStatusChg`, `TrgrOnNewProdtInHighEngmtCatg`, `TrgrOnOrderPlacement`, `TrgrOnOrderReturn`, `TrgrOnOrderShipment`, `TrgrOnOrderStatusChange`, `TrgrOnPaymentTransaction`, `TrgrOnPriceDrop`, `TrgrOnRcsDeliveredEngagement`, `TrgrOnRcsDlvrFailureEngmt`, `TrgrOnRcsReadEngagement`, `TrgrOnRcsResponseEngagement`, `TrgrOnRcsSubscription`, `TrgrOnReengagement`, `TrgrOnReferralEventSubmission`, `TrgrOnReplenishment`, `TrgrOnSmsDeliveryFailureEngagement`, `TrgrOnSmsLinkClickEngagement`, `TrgrOnSmsResponseEngagement`, `TrgrOnSmsSubscription`, `TrgrOnVisitorConversion`, `TrgrOnVoucherStsChgOtbdEngmt`, `TrgrOnWebCartAbandoned`, `TrgrOnWhatsAppDeliveredEngagement`, `TrgrOnWhatsAppDlvrFailureEngmt`, `TrgrOnWhatsAppLinkClickEngmt`, `TrgrOnWhatsAppReadEngagement`, `TrgrOnWhatsAppResponseEngmt`, `TrgrOnWhatsAppSubscription`, `UseOrderManagementSetupAPIs`, `ViewArchivedFiles`, `ViewChannelMarketingEligibility`, `ViewServiceGroundingConfig`

</details>

Removed by Salesforce, so removed when the API is at that version or above:

- API 51.0: `ViewFlowUsageAndFlowEventData`
- API 59.0: `AllowObjectDetection`, `AllowObjectDetectionTraining`
- API 65.0: `AutomatedDealTracking`

<!-- cspell:enable -->
