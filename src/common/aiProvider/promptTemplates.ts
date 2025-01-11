export type PromptTemplate = "PROMPT_SOLVE_DEPLOYMENT_ERROR" | "PROMPT_DESCRIBE_FLOW";
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
  const promptsLanguage = process.env.PROMPTS_LANGUAGE || "EN";
  if (!["en", "fr"].includes(promptsLanguage)) {
    throw new Error(`Invalid prompts language: ${promptsLanguage}`);
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
Caution: If the XML contains secret tokens or password, please replace them with a placeholder.
The flox XML is:
{{FLOW_XML}}`,
      "fr": `Vous êtes un analyste métier travaillant sur un projet Salesforce.
Veuillez décrire le flux suivant en utilisant un langage simple qui peut être compris par un utilisateur métier.
Attention : Si le XML contient des jetons secrets ou des mots de passe, veuillez les remplacer par un espace réservé.
Le XML du flux est :
{{FLOW_XML}}`
    }
  }
}