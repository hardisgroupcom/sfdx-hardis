export type NotifSeverity = "critical" | "error" | "warning" | "info" | "success" | "log";

export interface NotifButton {
  text: string;
  url?: string;
  style?: "primary" | "danger";
}

export interface NotifMessage {
  text: string;
  type:
  | "ACTIVE_USERS"
  | "ACTIVE_USERS_CRM_WEEKLY"
  | "ACTIVE_USERS_EXPERIENCE_MONTHLY"
  | "UNUSED_USERS"
  | "UNUSED_USERS_CRM_6_MONTHS"
  | "UNUSED_USERS_EXPERIENCE_6_MONTHS"
  | "AUDIT_TRAIL"
  | "APEX_TESTS"
  | "BACKUP"
  | "DEPLOYMENT"
  | "LEGACY_API"
  | "LICENSES"
  | "LINT_ACCESS"
  | "UNUSED_METADATAS"
  | "METADATA_STATUS"
  | "MISSING_ATTRIBUTES"
  | "SERVICENOW_REPORT"
  | "UNUSED_LICENSES"
  | "UNDERUSED_PERMSETS"
  | "MINIMAL_PERMSETS"
  | "UNUSED_APEX_CLASSES"
  | "APEX_API_VERSION"
  | "CONNECTED_APPS"
  | "UNSECURED_CONNECTED_APPS"
  | "ORG_HEALTH_CHECK"
  | "ORG_INFO"
  | "ORG_LIMITS"
  | "RELEASE_UPDATES"
  | "AGENTFORCE_CONVERSATIONS"
  | "AGENTFORCE_FEEDBACK"
  | "APEX_ERROR"
  | "FLOW_ERROR"
  | "DEPLOYMENTS";
  buttons?: NotifButton[];
  attachments?: any[];
  severity: NotifSeverity;
  sideImage?: string;
  attachedFiles?: string[];
  logElements: any[];
  metrics: any;
  data: any;
  alwaysSend?: boolean;
}
