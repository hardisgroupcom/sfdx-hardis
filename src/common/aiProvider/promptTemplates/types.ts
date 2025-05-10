export interface PromptTemplateVariable {
  name: string;
  description: string;
  example: string;
}

export interface PromptTemplateDefinition {
  variables: PromptTemplateVariable[];
  text: {
    [language: string]: string;
  };
}
