// Dependency-free constants module.
// IMPORTANT: keep this file free of any import: it is loaded by the
// WebSocket client before the command boots, so the VS Code extension
// gets feedback as early as possible. Importing anything heavy here
// would delay every sf hardis command startup.

const showBanner = true;

export const CONSTANTS = {
  DEFAULT_API_VERSION: '65.0',
  DOC_URL_ROOT: "https://sfdx-hardis.cloudity.com",
  WEBSITE_URL: "https://cloudity.com?ref=sfdxhardis",
  CONTACT_URL: "https://cloudity.com/contact-us/",
  BANNER_IMAGE_URL:
    showBanner
      ? "https://raw.githubusercontent.com/hardisgroupcom/sfdx-hardis/refs/heads/main/docs/assets/images/cloudity-banner.png"
      : false,
  PR_COMMENT_BANNER_BASE_URL:
    "https://raw.githubusercontent.com/hardisgroupcom/sfdx-hardis/refs/heads/main/docs/assets/images/",
  NOT_IMPACTING_METADATA_TYPES: process.env.NOT_IMPACTING_METADATA_TYPES
    ?.split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0) ?? [
      "ActionLinkGroupTemplate",
      "AnalyticSnapshot",
      "AppMenu",
      "Audience",
      "AuraDefinitionBundle",
      "Bot",
      "BotVersion",
      "BrandingSet",
      "ContentAsset",
      "CustomApplication",
      "CustomApplicationComponent",
      "CustomLabel",
      "CustomObjectTranslation",
      "CustomPageWebLink",
      "CustomSite",
      "CustomTab",
      "CustomValueSetTranslation",
      "Dashboard",
      "DashboardFolder",
      "Document",
      "EmailTemplate",
      "ExperienceBundle",
      "FlexiPage",
      "GlobalValueSetTranslation",
      "HomePageComponent",
      "HomePageLayout",
      "Layout",
      "Letterhead",
      "LightningExperienceTheme",
      "LightningComponentBundle",
      "LightningMessageChannel",
      "ListView",
      "NavigationMenu",
      "PathAssistant",
      "QuickAction",
      "ReportType",
      "Report",
      "ReportFolder",
      "SiteDotCom",
      "StandardValueSetTranslation",
      "StaticResource",
      "Translations",
      "WebLink",
      "CustomHelpMenuSection",
      "CustomFeedFilter"
    ]
};
