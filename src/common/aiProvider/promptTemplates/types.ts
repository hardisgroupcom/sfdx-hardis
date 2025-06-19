export interface PromptTemplateVariable {
  name: string;
  description: string;
  example: string;
  truncateAfter?: number;
}

export interface PromptTemplateDefinition {
  variables: PromptTemplateVariable[];
  text: {
    [language: string]: string;
  };
}
