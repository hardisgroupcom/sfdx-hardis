import { WhatWillBreakCheckKey } from './whatWillBreakTypes.js';

// Release updates sfdx-hardis knows, by the DeveloperName of their ReleaseUpdate record.
// Each one has two texts in src/i18n (whatWillBreakRu<DeveloperName>Impact and ...Todo, in the 9 languages): what stops
// working, in words a non-developer admin understands, and the steps that avoid it. A release update of the org that is
// not listed here shows the description Salesforce gives in the org, and the Release Updates page of the org.
//
// To add one: read its official page (release notes or knowledge article), add an entry here, its two texts in every
// locale, and a row in the "Release updates due" section of docs/salesforce-monitoring-what-will-break.md (a test checks it).
export interface ReleaseUpdateCatalogEntry {
  developerName: string;
  // Title shown in Setup > Release Updates, in English
  title: string;
  // Official Salesforce page that explains the change
  articleUrl: string;
  // false when the update cannot break anything (accessibility, performance, automatic migration): an information row
  impacting: boolean;
  // Check of the report that covers the same change: the release update is merged into its rows
  relatedCheck?: WhatWillBreakCheckKey;
  // Text the Details of the related check rows must contain, when that check covers several release updates (login type)
  relatedRowsMatch?: string;
}

export const RELEASE_UPDATES_CATALOG: ReleaseUpdateCatalogEntry[] = [
  {
    developerName: 'SoapLoginUserPermEnforcementReleaseUpdate',
    title: 'Require Use Any API Auth for SOAP API login()',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_api_soap_login.htm&release=264&type=5',
    impacting: true,
    relatedCheck: 'soapLoginPermission',
  },
  {
    developerName: 'OAuthDeviceFlowRestrictionReleaseUpdate',
    title: 'Restrict the OAuth 2.0 Device Flow to Local External Client Apps',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_security_oauth_device.htm&release=264&type=5',
    impacting: true,
    relatedCheck: 'deviceFlow',
  },
  {
    developerName: 'GuardianMustUseSsoRU',
    title: 'Migrate to an Easier Way to Require Single Sign-On',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_security_require_sso.htm&release=264&type=5',
    impacting: false,
  },
  {
    developerName: 'ViewSetupAuditTrailRequiredReleaseUpdate',
    title: 'Grant the View Setup Audit Trail Permission to Access the Setup Audit Trail',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_setup_audit_trail.htm&release=264&type=5',
    impacting: true,
  },
  {
    developerName: 'A11yResizeReflowPhase3',
    title: 'Enable Accessibility Enhancements for To Do Lists, and Lightning Dual List-boxes When Zoom is Greater Than 200%',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_general_accessibility_todo_listboxes_ru_262.htm&release=264&type=5',
    impacting: false,
  },
  {
    developerName: 'ApexAsyncLargeTxnReleaseUpdate',
    title: 'Update Apex Code and Flows for Changed Sharing Recalculation Behavior',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_sharing_apex_recalc.htm&release=264&type=5',
    impacting: true,
  },
  {
    developerName: 'PlatformEventTriggerRollbackOnExceptionReleaseUpdate',
    title: 'Roll Back Platform Event Trigger Transactions on Unhandled Exceptions',
    articleUrl:
      'https://help.salesforce.com/s/articleView?id=release-notes.rn_roll_back_platform_event_trigger_transactions_on_unhandled_exceptions.htm&release=264&type=5',
    impacting: true,
  },
  {
    developerName: 'AuraSObjectJsonFilter',
    title: 'Remove Non-Public Fields from Custom Object Data in Aura Action Responses',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_lc_rus_remove_nonpublic_fields_ru.htm&release=264&type=5',
    impacting: true,
  },
  {
    developerName: 'EnhancedUserFieldMaskingForGuestReleaseUpdate',
    title: 'Conceal Personal Information Fields from Guest Users',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_experiences_conceal_pii_guests.htm&release=264&type=5',
    impacting: false,
  },
  {
    developerName: 'RenderVisualforceAsAccessiblePdf',
    title: 'Render Visualforce Pages as Accessible (Tagged) PDFs (Beta)',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_vf_accessible_pdf_ru.htm&release=264&type=5',
    impacting: true,
  },
  {
    developerName: 'SalesforceToSalesforceRetirement',
    title: 'Salesforce to Salesforce Retirement',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_sales_salesforce_to_salesforce_retiring_ru.htm&release=264&type=5',
    impacting: true,
  },
  {
    developerName: 'OAuthUsrPassFlowEOLReleaseUpdate',
    title: 'Retirement of OAuth 2.0 Username-Password Flow for Connected Apps',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_security_oauth_unpw.htm&release=264&type=5',
    impacting: true,
    relatedCheck: 'usernamePasswordFlow',
    relatedRowsMatch: 'Username-Password',
  },
  {
    developerName: 'OAuthUsrAgtFlowsEOLReleaseUpdate',
    title: 'OAuth User-Agent and Hybrid User-Agent Flows Retirement',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_security_oauth_useragent.htm&release=264&type=5',
    impacting: true,
    relatedCheck: 'usernamePasswordFlow',
    relatedRowsMatch: 'User-Agent',
  },
  {
    developerName: 'SoapLoginRetirementNoTestFeatureReleaseUpdate',
    title: 'SOAP API login() Retirement',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_api_soap_login_retirement.htm&release=264&type=5',
    impacting: true,
    relatedCheck: 'soapLoginRetirement',
  },
  {
    developerName: 'ApexBlockPackagedExecAnon',
    title: 'Block Apex Anonymous Code Execution from Managed Packages',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_apex_block_exec_anon_ru.htm&release=264&type=5',
    impacting: true,
  },
  {
    developerName: 'RevenueManagementOptimized',
    title: 'Optimize Performance for Revenue Management',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_product_configurator_optimize_performance.htm&release=264&type=5',
    impacting: false,
  },
  {
    developerName: 'ConnectedAppHardBlockEOLReleaseUpdate',
    title: 'Migrate All Connected Apps to External Client Apps',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_security_migrate_all_connected_apps.htm&release=264&type=5',
    impacting: true,
    relatedCheck: 'connectedAppsToEca',
  },
  {
    developerName: 'ApiVersions31to40Retirement',
    title: 'Salesforce Platform API Versions 31.0 through 40.0 Retirement',
    articleUrl: 'https://help.salesforce.com/s/articleView?id=release-notes.rn_api_retirement.htm&release=264&type=5',
    impacting: true,
    relatedCheck: 'legacyApiVersions',
  },
];

export function getReleaseUpdateCatalogEntry(developerName: string): ReleaseUpdateCatalogEntry | undefined {
  return RELEASE_UPDATES_CATALOG.find((entry) => entry.developerName === developerName);
}
