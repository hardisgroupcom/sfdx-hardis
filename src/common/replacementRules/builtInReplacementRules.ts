// Built-in replacement rules: XML elements a deployment fails on when the deployment API version of
// the target org does not know them (a preview sandbox deploying to production on the previous
// release), or no longer accepts them.
//
// Sources: Metadata API Developer Guide v60 to v68 ("Available in API version N and later",
// "Removed in API version N"), forcedotcom/code-analyzer#2098 on <ends>.
// To refresh: skill replacement-rules-builtin-update (diff of describeValueType between two API
// versions, then the guide of the new release for these two sentences).
//
// Elements whose removal changes what a component does are disabled by default: when one of them
// is found, a warning says the deployment will fail and which rule removes it.

import { BuiltInReplacementRule } from './types.js';

const MDAPI = 'Metadata API Developer Guide';
const FLOWS = ['**/*.flow-meta.xml'];
const PROFILES_AND_PERMISSION_SETS = ['**/*.profile-meta.xml', '**/*.permissionset-meta.xml'];

export const BUILT_IN_REPLACEMENT_RULES: BuiltInReplacementRule[] = [
  // Flows: safe removals (visual, or metadata of features an older org does not have)
  {
    id: 'builtin-flow-ends',
    description: 'End elements saved by Flow Builder from Winter \'27, and the connectors pointing to them (the flow ends the same way)',
    files: FLOWS,
    xmlPaths: ['Flow/ends'],
    introducedIn: 68,
    defaultEnabled: true,
    handler: 'flowEnds',
    source: 'Winter \'27 release notes (End elements saved to metadata), forcedotcom/code-analyzer#2098',
  },
  {
    id: 'builtin-flow-groups',
    description: 'Canvas groups of Flow elements, visual only',
    files: FLOWS,
    xmlPaths: ['Flow/groups', 'Flow/*/group'],
    introducedIn: 68,
    defaultEnabled: true,
    source: `${MDAPI} v68 (Flow, FlowNode)`,
  },
  {
    id: 'builtin-flow-schedule-day-of-month',
    description: 'Day of month of a scheduled flow (monthly schedules)',
    files: FLOWS,
    xmlPaths: ['Flow/start/schedule/dayOfMonthToRun'],
    introducedIn: 66,
    defaultEnabled: true,
    source: `${MDAPI} v66 (FlowSchedule)`,
  },
  {
    id: 'builtin-flow-schedule-frequency-number',
    description: 'Frequency number of a segment-triggered flow schedule',
    files: FLOWS,
    xmlPaths: ['Flow/start/schedule/frequencyNumber'],
    introducedIn: 66,
    defaultEnabled: true,
    source: `${MDAPI} v66 (FlowSchedule)`,
  },
  {
    id: 'builtin-flow-screen-style-settings',
    description: 'Style settings of a screen, visual only',
    files: FLOWS,
    xmlPaths: ['Flow/screens/styleSettings'],
    introducedIn: 66,
    defaultEnabled: true,
    source: `${MDAPI} v66 (FlowScreen)`,
  },
  {
    id: 'builtin-flow-screen-field-style',
    description: 'Width and alignment of screen fields, visual only',
    files: FLOWS,
    xmlPaths: ['Flow/screens//fields/styleProperties'],
    introducedIn: 64,
    defaultEnabled: true,
    source: `${MDAPI} v64 (FlowScreenField)`,
  },
  {
    id: 'builtin-flow-choice-icon',
    description: 'Icon of a choice, visual only',
    files: FLOWS,
    xmlPaths: ['Flow/choices/choiceIcon'],
    introducedIn: 64,
    defaultEnabled: true,
    source: `${MDAPI} v64 (FlowChoice)`,
  },
  {
    id: 'builtin-flow-metrics-data-cloud',
    description: 'Flow metrics sent to Data Cloud',
    files: FLOWS,
    xmlPaths: ['Flow/areMetricsLoggedToDataCloud'],
    introducedIn: 63,
    defaultEnabled: true,
    source: `${MDAPI} v63 (Flow)`,
  },
  {
    id: 'builtin-flow-custom-properties',
    description: 'Custom properties of a flow (screen progress indicator), visual only',
    files: FLOWS,
    xmlPaths: ['Flow/customProperties'],
    introducedIn: 63,
    defaultEnabled: true,
    source: `${MDAPI} v63 (Flow)`,
  },
  // Profiles and permission sets
  {
    id: 'builtin-view-all-fields-false',
    description: 'View All Fields object permission when it is false',
    files: PROFILES_AND_PERMISSION_SETS,
    xmlPaths: ['Profile/objectPermissions/viewAllFields[.=false]', 'PermissionSet/objectPermissions/viewAllFields[.=false]'],
    introducedIn: 63,
    defaultEnabled: true,
    source: `${MDAPI} v63 (Profile, PermissionSet)`,
  },
  {
    id: 'builtin-agent-accesses',
    description: 'Agentforce agent accesses, no agent exists in older orgs',
    files: PROFILES_AND_PERMISSION_SETS,
    xmlPaths: ['Profile/agentAccesses', 'PermissionSet/agentAccesses'],
    introducedIn: 63,
    defaultEnabled: true,
    source: `${MDAPI} v63 (Profile, PermissionSet)`,
  },
  {
    id: 'builtin-email-routing-address-accesses',
    description: 'Email routing address accesses of a permission set',
    files: ['**/*.permissionset-meta.xml'],
    xmlPaths: ['PermissionSet/emailRoutingAddressAccesses'],
    introducedIn: 62,
    defaultEnabled: true,
    source: `${MDAPI} v62 (PermissionSet)`,
  },
  {
    id: 'builtin-service-presence-status-accesses',
    description: 'Service presence status accesses',
    files: PROFILES_AND_PERMISSION_SETS,
    xmlPaths: ['Profile/servicePresenceStatusAccesses', 'PermissionSet/servicePresenceStatusAccesses'],
    introducedIn: 64,
    defaultEnabled: true,
    source: `${MDAPI} v64 (Profile, PermissionSet)`,
  },
  {
    id: 'builtin-gen-computing-summary-def-accesses',
    description: 'Generative computing summary definition accesses',
    files: PROFILES_AND_PERMISSION_SETS,
    xmlPaths: ['Profile/genComputingSummaryDefAccesses', 'PermissionSet/genComputingSummaryDefAccesses'],
    introducedIn: 66,
    defaultEnabled: true,
    source: `${MDAPI} v66 (Profile, PermissionSet)`,
  },
  {
    id: 'builtin-unknown-user-permissions',
    description: 'User permissions the target org does not have: unknown to its API version, or not enabled by its licenses and features',
    files: PROFILES_AND_PERMISSION_SETS,
    xmlPaths: ['Profile/userPermissions', 'PermissionSet/userPermissions'],
    anyApiVersion: true,
    defaultEnabled: true,
    handler: 'unknownUserPermissions',
    source: 'PermissionSet describe of the target org (Permissions<Name> fields), else the list of userPermissionsByApiVersion.ts',
  },
  // Settings no longer accepted
  {
    id: 'builtin-aura-static-res-pref',
    description: 'Lightning Experience setting of a cancelled release update',
    files: ['**/LightningExperience.settings-meta.xml'],
    xmlPaths: ['LightningExperienceSettings/enableAuraSecStaticResCRUCPref'],
    removedIn: 68,
    defaultEnabled: true,
    source: `${MDAPI} v68 (LightningExperienceSettings)`,
  },
  {
    id: 'builtin-analytics-incremental-upsert',
    description: 'Analytics incremental upsert setting',
    files: ['**/Analytics.settings-meta.xml'],
    xmlPaths: ['AnalyticsSettings/incrementalUpsertEnabled'],
    removedIn: 68,
    defaultEnabled: true,
    source: `${MDAPI} v68 (AnalyticsSettings)`,
  },
  {
    id: 'builtin-help-menu-settings',
    description: 'Help menu settings of User Engagement',
    files: ['**/UserEngagement.settings-meta.xml'],
    xmlPaths: [
      'UserEngagementSettings/enableHelpMenuShowHelp',
      'UserEngagementSettings/enableHelpMenuShowNewUser',
      'UserEngagementSettings/enableHelpMenuShowSearch',
    ],
    removedIn: 65,
    defaultEnabled: true,
    source: `${MDAPI} v65 (UserEngagementSettings)`,
  },
  {
    id: 'builtin-enhanced-sites-pref',
    description: 'Enhanced sites and content platform setting',
    files: ['**/Site.settings-meta.xml'],
    xmlPaths: ['SiteSettings/enableEnhancedSitesAndContentPlatform'],
    removedIn: 63,
    defaultEnabled: true,
    source: `${MDAPI} v63 (SiteSettings)`,
  },
  {
    id: 'builtin-voice-whatsapp-pref',
    description: 'Service Cloud Voice WhatsApp setting',
    files: ['**/ServiceCloudVoice.settings-meta.xml'],
    xmlPaths: ['ServiceCloudVoiceSettings/enableDigitalVoiceWhatsapp'],
    removedIn: 65,
    defaultEnabled: true,
    source: `${MDAPI} v65 (ServiceCloudVoiceSettings)`,
  },
  // Disabled by default: the component would behave differently without the element
  {
    id: 'builtin-view-all-fields-true',
    description: 'View All Fields object permission when it is true: removing it removes the access',
    files: PROFILES_AND_PERMISSION_SETS,
    xmlPaths: ['Profile/objectPermissions/viewAllFields[.=true]', 'PermissionSet/objectPermissions/viewAllFields[.=true]'],
    introducedIn: 63,
    defaultEnabled: false,
    warnWhenDisabled: true,
    source: `${MDAPI} v63 (Profile, PermissionSet)`,
  },
  {
    id: 'builtin-flow-schedule-days-of-week',
    description: 'Days of week of a scheduled flow: without them, a weekly flow runs on the weekday of its start date only',
    files: FLOWS,
    xmlPaths: ['Flow/start/schedule/daysOfWeekToRun'],
    introducedIn: 66,
    defaultEnabled: false,
    warnWhenDisabled: true,
    source: `${MDAPI} v66 (FlowSchedule)`,
  },
  {
    id: 'builtin-flow-get-records-limit',
    description: 'Number of records of a Get Records element: without it, every matching record is returned',
    files: FLOWS,
    xmlPaths: ['Flow/recordLookups/limit'],
    introducedIn: 63,
    defaultEnabled: false,
    warnWhenDisabled: true,
    source: `${MDAPI} v63 (FlowRecordLookup)`,
  },
  {
    id: 'builtin-flow-upsert',
    description: 'Upsert options of a Create Records element: without them, the element always creates',
    files: FLOWS,
    xmlPaths: [
      'Flow/recordCreates/doesUpsert',
      'Flow/recordCreates/doesUpsertAllOrNone',
      'Flow/recordCreates/upsertExternalIdField',
      'Flow/recordCreates/upsertStandardIdField',
    ],
    introducedIn: 62,
    defaultEnabled: false,
    warnWhenDisabled: true,
    source: `${MDAPI} v62 (FlowRecordCreate)`,
  },
  {
    id: 'builtin-flow-create-matching-records',
    description: 'Matching record filters of a Create Records element',
    files: FLOWS,
    xmlPaths: ['Flow/recordCreates/filters', 'Flow/recordCreates/filterLogic'],
    introducedIn: 61,
    defaultEnabled: false,
    warnWhenDisabled: true,
    source: `${MDAPI} v61 (FlowRecordCreate)`,
  },
  {
    id: 'builtin-flow-action-wait',
    description: 'Wait options of an action: without them, the flow does not wait for the action to complete',
    files: FLOWS,
    xmlPaths: ['Flow/actionCalls/isWaitUntilCompleted', 'Flow/actionCalls/offset', 'Flow/actionCalls/offsetUnit'],
    introducedIn: 61,
    defaultEnabled: false,
    warnWhenDisabled: true,
    source: `${MDAPI} v61 (FlowActionCall)`,
  },
  {
    id: 'builtin-flow-action-timeout',
    description: 'Timeout path of an action',
    files: FLOWS,
    xmlPaths: ['Flow/actionCalls/timeoutConnector'],
    introducedIn: 62,
    defaultEnabled: false,
    warnWhenDisabled: true,
    source: `${MDAPI} v62 (FlowActionCall)`,
  },
  {
    id: 'builtin-flow-action-timeout-path-usage',
    description: 'Timeout path usage of an action',
    files: FLOWS,
    xmlPaths: ['Flow/actionCalls/timeoutPathUsage'],
    introducedIn: 66,
    defaultEnabled: false,
    warnWhenDisabled: true,
    source: `${MDAPI} v66 (FlowActionCall)`,
  },
  {
    id: 'builtin-flow-decision-attributes',
    description: 'Attributes of a decision (AI descriptions and prompts used to decide)',
    files: FLOWS,
    xmlPaths: ['Flow/decisions/attributes', 'Flow/decisions/rules/attributes'],
    introducedIn: 65,
    defaultEnabled: false,
    warnWhenDisabled: true,
    source: `${MDAPI} v65 (FlowDecision, FlowRule)`,
  },
];

/** True when the built-in rule concerns this deployment API version */
export function builtInRuleAppliesToApiVersion(rule: BuiltInReplacementRule, apiVersion: number | null): boolean {
  if (rule.anyApiVersion) {
    return true;
  }
  if (apiVersion == null) {
    return false;
  }
  if (rule.introducedIn != null && apiVersion < rule.introducedIn) {
    return true;
  }
  if (rule.removedIn != null && apiVersion >= rule.removedIn) {
    return true;
  }
  return false;
}

export function findBuiltInReplacementRule(id: string): BuiltInReplacementRule | undefined {
  return BUILT_IN_REPLACEMENT_RULES.find((rule) => rule.id === id);
}
