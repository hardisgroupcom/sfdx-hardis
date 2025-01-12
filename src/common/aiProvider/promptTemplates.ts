import { uxLog } from "../utils/index.js";
import c from "chalk";

export type PromptTemplate =
  "PROMPT_SOLVE_DEPLOYMENT_ERROR" |
  "PROMPT_DESCRIBE_FLOW" |
  "PROMPT_DESCRIBE_FLOW_DIFF"
  ;

export type PromptLanguage = "en" | "fr";

export function buildPromptFromTemplate(template: PromptTemplate, variables: object): string {
  // Get matching prompt
  const templateData = getPromptTemplate(template);
  // Check for missing input variables
  const missingVariables = templateData.variables.filter((variable) => !variables[variable]);
  if (missingVariables.length > 0) {
    throw new Error(`Missing variables for prompt template ${template}: ${missingVariables.join(", ")}`);
  }
  // Get prompt language and check if it is an allowed one
  let promptsLanguage = process.env.PROMPTS_LANGUAGE || "en";
  if (!["en", "fr"].includes(promptsLanguage)) {
    uxLog(this, c.yellow(`Unknown prompt language ${promptsLanguage}: Switch back to en`));
    promptsLanguage = "en";
  }
  // Build prompt
  let prompt = process.env?.[template] || templateData.text[promptsLanguage];
  for (const variable in variables) {
    prompt = prompt.replace(`{{${variable}}}`, variables[variable]);
  }
  return prompt;
}

function getPromptTemplate(template: PromptTemplate): any {
  const templateData = PROMPT_TEMPLATES[template];
  if (!templateData) {
    throw new Error(`Unknown prompt template: ${template}`);
  }
  return templateData;
}

export const PROMPT_TEMPLATES = {
  "PROMPT_SOLVE_DEPLOYMENT_ERROR": {
    variables: ["ERROR"],
    text: {
      "en": `You are a Salesforce release manager using Salesforce CLI commands to perform deployments 
How to solve the following Salesforce deployment error ?
- Please answer using sfdx source format, not metadata format.
- Please provide XML example if applicable. 
- Please skip the part of the response about how to retrieve or deploy the changes with Salesforce CLI
The error is: 
{{ERROR}}
`,
      "fr": `Vous êtes un release manager Salesforce qui utilise les commands Salesforce CLI pour effectuer des déploiements 
Comment résoudre l'erreur de déploiement Salesforce suivante ?
- Veuillez répondre en utilisant le format source de sfdx, pas le format metadata.
- Veuillez fournir un exemple XML si applicable.
- Veuillez sauter la partie de la réponse sur comment récupérer ou déployer les changements avec Salesforce CLI
L'erreur est :
{{ERROR}}
`
    },
  },
  "PROMPT_DESCRIBE_FLOW": {
    variables: ["FLOW_XML"],
    text: {
      "en": `You are a business analyst working on a Salesforce project.
Please describe the following flow using plain English that can be understood by a business user.
Please respond with markdown format, that can be embedded in a level 2 header (##).
Add a new line before starting a bullet list so mkdocs-material displays it correctly, including for sub-bullets.
Caution: If the XML contains secret tokens or password, please replace them with a placeholder.
The flow XML is:
{{FLOW_XML}}`,
      "fr": `Vous êtes un analyste métier travaillant sur un projet Salesforce.
Veuillez décrire le flux suivant en utilisant un langage simple qui peut être compris par un utilisateur métier.
Veuillez répondre avec le format markdown, qui peut être intégré dans un en-tête de niveau 2 (##)
Ajoutez une nouvelle ligne avant de commencer une liste à puces pour que mkdocs-material l'affiche correctement, y compris pour les sous-puces.
Attention : Si le XML contient des jetons secrets ou des mots de passe, veuillez les remplacer par un espace réservé.
Le XML du flux est :
{{FLOW_XML}}`
    }
  },
  "PROMPT_DESCRIBE_FLOW_DIFF": {
    variables: ["FLOW_XML_NEW", "FLOW_XML_PREVIOUS"],
    text: {
      "en": `You are a business analyst working on a Salesforce project.
Please describe the differences between new version of the flow and previous version of the flow, using plain English that can be understood by a business user.
Do NOT include in the response:
- Elements related to location attributes (locationX and locationY) or positions.
- Elements that have not changed
Please respond with markdown format, that can be embedded in a level 2 header (##).
Add a new line before starting a bullet list so mkdocs-material displays it correctly, including for sub-bullets.
Caution: If the XML contains secret tokens or password, please replace them with a placeholder.
Please DO NOT refer to locationX, locationY or positions of the XML nodes.
The new version flow XML is:
{{FLOW_XML_NEW}}

The previous version flow XML is:
{{FLOW_XML_PREVIOUS}}
`,
      "fr": `Vous êtes un analyste métier travaillant sur un projet Salesforce.
Veuillez décrire les différences entre la nouvelle version du Flow et la version précédente du Flow, en utilisant un langage simple qui peut être compris par un utilisateur métier.
Ne PAS inclure dans la réponse :
- Les éléments liés aux attributs de localisation (locationX et locationY).
- Les éléments qui n'ont pas changé
Veuillez répondre avec le format markdown, qui peut être intégré dans un en-tête de niveau 2 (##)
Ajoutez une nouvelle ligne avant de commencer une liste à puces pour que mkdocs-material l'affiche correctement, y compris pour les sous-puces.
Attention : Si le XML contient des jetons secrets ou des mots de passe, veuillez les remplacer par un espace réservé.
Veuillez NE PAS faire référence aux localisations (locationX, locationY or positions) des nœuds XML.
Le XML de la nouvelle version du Flow est:
{{FLOW_XML_CURRENT}}

Le XML de la précédente version du Flow est:
{{FLOW_XML_PREVIOUS}}
`
    }
  }
}