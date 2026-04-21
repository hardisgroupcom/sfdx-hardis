# Language-Specific Translation Rules

When translating, look at other translations in the same language file for consistency in terminology and style.

## French (fr)

- Use the official Salesforce French translations (e.g. `Permission Set` -> `Ensemble d'autorisations`, `Record Type` -> `Type d'enregistrement`, `Flow` -> `Flux`, `Object` -> `Objet`, `Field` -> `Champ`, `Profile` -> `Profil`).

## German (de)

- Use formal German ("Sie" not "du") for all user-facing text.
- Use official Salesforce German translations.
- Keep English technical terms: merge, commit, branch, scratch org, package.xml, DevHub, SOQL, DML, CSV, REST, Bulk API, upsert, mock data.
- Standard IT terminology: "Datensatz" for record, "Org" stays as "Org", "Workspace" stays as "Workspace".

## Spanish (es)

- Use neutral European Spanish (Spain), not Latin American variants.
- Use terminology common among Salesforce developers in Spain, not always the official UI translation.
- Keep developer-facing terms in English: Flow, Permission Set, Custom Setting, Connected App, Scratch Org.
- Translate generic wording naturally: "metadatos", "despliegue".
- Keep Git/CLI terms in English: merge, commit, branch, package.xml, DevHub.

## Japanese (ja)

- Use polite professional Japanese (Desu/Masu form -- です/ます調).
- Use official Salesforce Japanese translations (e.g. `Account` -> `取引先`, `Object` -> `オブジェクト`, `Flow` -> `フロー`, `Permission Set` -> `権限セット`, `Field` -> `項目`, `Deployment` -> `デプロイ`, `Production` -> `本番環境`, `Scratch Org` -> `スクラッチ組織`).

## Polish (pl)

- Use neutral formal Polish -- avoid personal address ("ty", "Pan", "Pani"). Use impersonal constructs or third-person verbs.
- Keep English technical terms: merge, commit, branch, Scratch Org, package.xml, DevHub, SOQL, DML, CSV, REST, Bulk API, upsert, mock data, org, sandbox.
- Keep Salesforce metadata names in English: Flow, Permission Set, Permission Set Group, Profile, Custom Setting, Custom Label, Custom Permission, Connected App, External Client App, Validation Rule, Workflow Rule, Approval Process, Assignment Rule, Escalation Rule, Record Type, Lightning Page, Lightning Web Component, Static Resource, Visualforce, sObject, Flexipage.
- Consistent translations: "deployment" -> "wdrozenie", "deploy" -> "wdrozyc", "retrieve" -> "pobrac"/"pobieranie", "metadata" -> "metadane", "error" -> "blad", "warning" -> "ostrzezenie", "repository" -> "repozytorium".

## Italian (it)

- Use informal Italian ("tu" register) matching standard Italian software products.
- Keep English technical terms: merge, commit, branch, scratch org, package.xml, DevHub, SOQL, sandbox, pull request, merge request.
- Keep Salesforce metadata names in English: Flow, Permission Set, Permission Set Group, Profile, Custom Setting, Custom Label, Custom Permission, Connected App, External Client App, Validation Rule, Workflow Rule, Approval Process, Assignment Rule, Escalation Rule, Record Type, Lightning Page, Lightning Web Component, Static Resource, Visualforce, sObject, Flexipage.
- Consistent translations: "deployment" -> "distribuzione", "configuration" -> "configurazione", "settings" -> "impostazioni", "metadata" -> "metadati", "package" -> "pacchetto".

## Dutch (nl)

- Use informal Dutch ("je/jij" register, not "u/uw") matching standard Dutch software products.
- Keep English technical terms: merge, commit, branch, scratch org, package.xml, DevHub, SOQL, sandbox, pipeline, deploy, pull request, merge request.
- Keep Salesforce metadata names in English: Flow, Permission Set, Permission Set Group, Profile, Custom Setting, Custom Label, Custom Permission, Connected App, External Client App, Validation Rule, Workflow Rule, Approval Process, Assignment Rule, Escalation Rule, Record Type, Lightning Page, Lightning Web Component, Static Resource, Visualforce, sObject, Flexipage.
- Consistent translations: "deployment" -> "implementatie", "deploy" -> "implementeren", "configuration" -> "configuratie", "settings" -> "instellingen", "retrieve" -> "ophalen", "run/execute" -> "uitvoeren", "workspace" -> "werkruimte".

## All Languages

- Keep all `{{varName}}` interpolation placeholders, `\n` newlines, `<br/>` tags, emoji characters, and markdown formatting exactly as-is.
- Keep brand names untranslated: Salesforce, SFDMU, Git, GitHub, GitLab, JIRA, VS Code, Cloudity, Apex, LWC, sfdx-hardis, Azure DevOps, Docker, Cloudflare, ServiceNow, MermaidJS, Bitbucket.
- "org" stays as "org" in all languages.
