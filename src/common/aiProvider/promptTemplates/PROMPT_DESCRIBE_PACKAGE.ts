import { PromptTemplateDefinition } from "./types.js";


const template: PromptTemplateDefinition = {
  variables: [
    {
      name: "PACKAGE_NAME",
      description: "The name of the package to describe.",
      example: "Pardot"
    },
    {
      name: "PACKAGE_XML",
      description: "The JsonL metadata for the package",
      example: "{\"SubscriberPackageName\":\"Pardot\",\"SubscriberPackageNamespace\":\"pi\",\"SubscriberPackageVersionNumber\":\"1.0.0\",\"SubscriberPackageVersionId\":\"04t1t0000000abcAAA\",\"SubscriberPackageVersionName\":\"Pardot Version 1.0\"}"
    },
    {
      name: "PACKAGE_METADATAS",
      description: "A list of all metadata items (Apex classes, objects, flows, etc.) in the org that are provided by this package (namespaced).",
      example: "ApexClass: pi__MyClass, CustomObject: pi__MyObject, Flow: pi__MyFlow",
      truncateAfter: 100000
    }
  ],
  text: {
    "en": `You are a skilled business analyst working on a Salesforce project. Your goal is to summarize the content and behavior of the Salesforce Installed package "{{PACKAGE_NAME}}" in plain English, providing a detailed explanation suitable for a business user. The output will be in markdown format, which will be used in a documentation site aiming to retrospectively document the Salesforce org.

### Instructions:

1. **Contextual Overview**:
    - Browse internet to find the package's official documentation and provide an overview of its purpose and capabilities, with links to the documentation.
      - If you found the package's official documentation, summarize its key features and functionalities.
      - If you can not find the package's official documentation, provide a general overview based on the package attributes and its metadata components (but do not output the list of metadatas, it will be for paragraph 2).
    - Include any relevant information about the package's intended use cases or target audience.
    - If you can find other relevant information about the package, like articles or blog posts, provide them as a list of links
      - If you find the AppExchange page, include it in your response.
      - If you find the package's GitHub repository, include it in your response.
      - If you find the vendor information, include it in your response.

2. **Package Metadata**:
    - Review the list of metadata items (Apex classes, objects, flows, etc.) provided by this package, as listed in reference data.
    - Highlight the most important or business-relevant components.

3. **Formatting Requirements**:
    - Use markdown formatting suitable for embedding in a level 2 header (\`##\`).
    - Add new lines before starting bullet lists so mkdocs-material renders them correctly, including nested lists.
    - Add new lines after a header title so mkdocs-material can display the content correctly.
    - Never truncate any information in the response.
    - Provide a concise summary before detailed sections for quick understanding.

### Reference Data:

- The attributes for Installed package "{{PACKAGE_NAME}}" are:
{{PACKAGE_XML}}

- The list of metadata items provided by this package is:
{{PACKAGE_METADATAS}}

- Many Salesforce managed packages are published by third-party vendors. You can find the package's vendor information in the Salesforce AppExchange (https://appexchange.salesforce.com/).

- There are also many open-source packages available on GitHub (github.com)

- Other relevant sources for articles or blog posts about the package may include the vendor's website, community forums, or Salesforce-related blogs, like Salesforce Ben or medium.com.

\nCaution: Redact any sensitive information and replace with \`[REDACTED]\`. Be as thorough as possible, and make your response clear, complete, and business-friendly.
`,
  },
};

export default template;
