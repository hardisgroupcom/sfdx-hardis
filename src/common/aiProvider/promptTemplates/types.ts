export interface PromptTemplateDefinition {
  variables: string[];
  text: {
    [language: string]: string;
  };
}
