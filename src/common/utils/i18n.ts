const frTranslations: Record<string, string> = {
  '✅ Yes': '✅ Oui',
  '❌ No': '❌ Non',
  '⛔ Exit this script': '⛔ Quitter ce script',
  'Script terminated at user request.': "Script arrêté à la demande de l'utilisateur.",
  'Selection hidden because it contains sensitive information.':
    'Sélection masquée car elle contient des informations sensibles.',
  'Proceed with the operation despite API usage warnings':
    "Confirme la poursuite de l'opération malgré les avertissements d'utilisation API",
  'Confirm file import operation which will consume API calls':
    "Confirme l'import de fichiers qui consommera des appels API",
  'Select the files workspace configuration to use for this operation':
    "Sélectionnez la configuration d'espace de travail des fichiers à utiliser pour cette opération",
  'The folder name that will be created to store the export configuration and downloaded files':
    "Nom du dossier qui sera créé pour stocker la configuration d'export et les fichiers téléchargés",
  'A human-readable label that will identify this export configuration':
    "Libellé lisible qui identifiera cette configuration d'export",
  'A detailed description explaining what this export configuration does':
    "Description détaillée expliquant le rôle de cette configuration d'export",
  'SOQL query that retrieves the parent records to which files are attached':
    'Requête SOQL qui récupère les enregistrements parents auxquels les fichiers sont rattachés',
  'Field name from the SOQL query result that will be used as folder name for organizing files':
    'Nom du champ issu de la requête SOQL utilisé comme nom de dossier pour organiser les fichiers',
  'Choose how downloaded file names should be formatted':
    'Choisissez le format des noms des fichiers téléchargés',
  'Allow downloading files for records that already have a local folder':
    'Autorise le téléchargement de fichiers pour les enregistrements ayant déjà un dossier local',
  'Replace existing local files with newly downloaded versions':
    'Remplace les fichiers locaux existants par les nouvelles versions téléchargées',
  'Only files with size greater than or equal to this value will be downloaded (in kilobytes)':
    'Seuls les fichiers de taille supérieure ou égale à cette valeur seront téléchargés (en kilo-octets)',
  'Select one or more Salesforce profiles for the operation':
    'Sélectionnez un ou plusieurs profils Salesforce pour cette opération',
  'Enter the Salesforce profile name manually': 'Saisissez manuellement le nom du profil Salesforce',
  'Choose a Salesforce org from the list of authenticated orgs':
    'Choisissez une organisation Salesforce dans la liste des organisations authentifiées',
  'Choose multiple Salesforce orgs from the list of authenticated orgs':
    'Choisissez plusieurs organisations Salesforce dans la liste des organisations authentifiées',
  'Confirms whether to use the currently configured default org or select a different one':
    "Confirme s'il faut utiliser l'organisation par défaut configurée actuellement ou en sélectionner une autre",
  'Your email address will be stored locally and used for CI/CD operations':
    'Votre adresse e-mail sera stockée localement et utilisée pour les opérations CI/CD',
  'Select packages to add to your project configuration for automatic installation during scratch org creation and/or deployments':
    "Sélectionnez les packages à ajouter à la configuration du projet pour une installation automatique lors de la création des scratch org et/ou des déploiements",
  'Configure how this package should be automatically installed during CI/CD operations':
    "Configurez la façon dont ce package doit être installé automatiquement pendant les opérations CI/CD",
  'Used to generate environment variables and configuration files for your Salesforce project':
    'Utilisé pour générer des variables d’environnement et des fichiers de configuration pour votre projet Salesforce',
  'Confirms the use of the sanitized project name which must be compliant with environment variable format':
    "Confirme l'utilisation du nom de projet normalisé qui doit respecter le format des variables d'environnement",
  'Updates your .gitignore file with latest sfdx-hardis best practices and removes duplicate entries':
    'Met à jour votre fichier .gitignore avec les dernières bonnes pratiques sfdx-hardis et supprime les entrées en doublon',
  'Updates your .forceignore file with latest sfdx-hardis best practices and removes duplicate entries':
    'Met à jour votre fichier .forceignore avec les dernières bonnes pratiques sfdx-hardis et supprime les entrées en doublon',
  Yes: 'Oui',
  No: 'Non',
  'Never ask again': 'Ne plus demander',
  'Hello {{name}}': 'Bonjour {{name}}',
  'Enter your Azure DevOps Personal Access Token for API authentication (will not be stored permanently)':
    "Saisissez votre jeton d'accès personnel Azure DevOps pour l'authentification API (il ne sera pas stocké de façon permanente)",
  'Updated .gitignore.': '.gitignore mis à jour.',
  'Updated .forceignore.': '.forceignore mis à jour.',
};

function getLocale(): string {
  const explicitLocale = (process.env.SFDX_HARDIS_LOCALE || '').trim().toLowerCase();
  if (explicitLocale.startsWith('fr')) {
    return 'fr';
  }
  const lang = (process.env.LANG || '').trim().toLowerCase();
  if (lang.startsWith('fr')) {
    return 'fr';
  }
  return 'en';
}

function interpolateVariables(value: string, vars?: Record<string, unknown>): string {
  if (!vars) {
    return value;
  }
  return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => String(vars[key] ?? ''));
}

function translateLiteral(value: string): string {
  if (getLocale() !== 'fr') {
    return value;
  }
  return frTranslations[value] ?? value;
}

export function translateTextPreservingMarkers(value: string): string {
  return value
    .split(/(\[[^[\]]+\])/g)
    .map((part) => {
      if (part.match(/^\[[^[\]]+\]$/)) {
        return part;
      }
      const leading = part.match(/^\s*/)?.[0] ?? '';
      const trailing = part.match(/\s*$/)?.[0] ?? '';
      const core = part.trim();
      if (core === '') {
        return part;
      }
      return `${leading}${translateLiteral(core)}${trailing}`;
    })
    .join('');
}

export function t(key: string, vars?: Record<string, unknown>): string {
  return interpolateVariables(translateTextPreservingMarkers(key), vars);
}
