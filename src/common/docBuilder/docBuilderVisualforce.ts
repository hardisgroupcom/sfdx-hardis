import { DocBuilderComponentRoot } from "./docBuilderComponentRoot.js";
import { PromptTemplate } from "../aiProvider/promptTemplates.js";
import { buildGenericMarkdownTable } from "../utils/flowVisualiser/nodeFormatUtils.js";
import { buildUsesTable, extractVisualforceDependencies } from "../utils/metadataReferenceUtils.js";
import { t } from '../utils/i18n.js';

// Attributes of the -meta.xml file, shown before the ones read from the markup
const META_ATTRIBUTES_FIRST = ["label", "type", "apiVersion"];
const META_ATTRIBUTES_LAST = ["description", "availableInTouch", "confirmationTokenRequired"];
// Markup attributes that matter most to a reader, shown before the remaining ones
const MARKUP_ATTRIBUTES_PREFERRED = ["controller", "extensions", "standardController", "action", "renderAs", "showHeader", "sidebar"];

/**
 * Documentation of a Visualforce page (ApexPage) or of a Visualforce component (ApexComponent).
 * Both share their markup structure, their attributes table and their "Where Used" section: only the
 * prompt, the metadata root tag and the markup root tag differ.
 */
export abstract class DocBuilderVisualforce extends DocBuilderComponentRoot {

  public docType = "Visualforce";
  public docsSection = "visualforce";
  public placeholder = "<!-- Visualforce description -->";

  /** "Page" or "Component" */
  public abstract visualforceType: string;
  /** Root tag of the markup file, used to read its attributes */
  public abstract markupRootTag: string;

  public static getTypeLabel(visualforceType: string): string {
    return visualforceType === "Component" ? t('docMdVisualforceTypeComponent') : t('docMdVisualforceTypePage');
  }

  /** Reads the attributes of the markup root tag, for example controller and extensions of an apex:page */
  public static parseMarkupAttributes(markup: string, markupRootTag: string): any {
    const attributes: any = {};
    if (!markup) {
      return attributes;
    }
    const rootTagMatch = markup.match(new RegExp(`<${markupRootTag}\\b([^>]*)>`, 'i'));
    if (!rootTagMatch) {
      return attributes;
    }
    for (const attributeMatch of rootTagMatch[1].matchAll(/([A-Za-z_][A-Za-z0-9_:-]*)\s*=\s*"([^"]*)"/g)) {
      attributes[attributeMatch[1]] = attributeMatch[2];
    }
    return attributes;
  }

  /** Apex classes acting as controller or extension of the markup */
  public static listApexControllers(markupAttributes: any): string[] {
    const controllers: string[] = [];
    if (markupAttributes?.controller) {
      controllers.push(String(markupAttributes.controller).trim());
    }
    for (const extension of String(markupAttributes?.extensions || "").split(",")) {
      const extensionName = extension.trim();
      if (extensionName) {
        controllers.push(extensionName);
      }
    }
    return [...new Set(controllers.filter(controller => controller.length > 0))];
  }

  public static buildIndexTable(prefix: string, visualforceDescriptions: any[], filterObject: string | null = null) {
    return DocBuilderVisualforce.buildComponentIndexTable({
      prefix: prefix,
      descriptions: visualforceDescriptions,
      filterObject: filterObject,
      title: t('docMdVisualforce'),
      relatedTitle: t('docMdRelatedVisualforce'),
      columnLabels: [t('docMdColVisualforce'), t('docMdColType'), t('docMdColLabel'), t('docMdColApexControllers')],
      columnAlignments: [":--------", ":--:", ":----", ":----------"],
      buildValueCells: (visualforce) => [
        visualforce.type || "",
        visualforce.label || "",
        (visualforce.apexControllers || []).join(", "),
      ],
    });
  }

  public async buildInitialMarkdownLines(): Promise<string[]> {
    const mdLines: string[] = [
      ...this.buildComponentHeaderLines(),
      ...this.buildUsesLines(),
      ...this.buildWhereUsedLines(),
    ];
    if (!this.additionalVariables.HIDE_CODE) {
      mdLines.push(...[
        `## ${t('docMdVisualforceMarkup')}`,
        '',
        '```html',
        this.additionalVariables.VISUALFORCE_MARKUP || '',
        '```',
        ''
      ]);
    }
    return mdLines;
  }

  /** Outbound dependencies declared by the markup (components, pages, static resources, labels) */
  protected buildUsesLines(): string[] {
    const dependencies = extractVisualforceDependencies(
      this.additionalVariables.VISUALFORCE_MARKUP || '',
      this.metadataName
    );
    return buildUsesTable(dependencies, '../');
  }

  protected buildAttributesTable(): string {
    const markupAttributes = { ...(this.additionalVariables.MARKUP_ATTRIBUTES || {}) };
    const attributes: any = {
      label: this.parsedXmlObject?.label,
      type: DocBuilderVisualforce.getTypeLabel(this.visualforceType),
      apiVersion: this.parsedXmlObject?.apiVersion,
      description: this.parsedXmlObject?.description,
      availableInTouch: this.parsedXmlObject?.availableInTouch,
      confirmationTokenRequired: this.parsedXmlObject?.confirmationTokenRequired,
      ...markupAttributes,
    };
    // Always link Apex and objects: their docs may be generated later in the same run
    for (const attributeName of ["controller", "extensions"]) {
      if (attributes[attributeName]) {
        attributes[attributeName] = this.linkifyApexClasses(String(attributes[attributeName]));
      }
    }
    if (attributes.standardController) {
      attributes.standardController = this.linkifyObject(String(attributes.standardController));
    }

    const remainingMarkupAttributes = Object.keys(markupAttributes)
      .filter(attributeName => !MARKUP_ATTRIBUTES_PREFERRED.includes(attributeName))
      .sort();
    const fields = [...META_ATTRIBUTES_FIRST, ...MARKUP_ATTRIBUTES_PREFERRED, ...remainingMarkupAttributes, ...META_ATTRIBUTES_LAST];

    return buildGenericMarkdownTable(attributes, fields, `## ${t('docMdVisualforceAttributes')}`, []);
  }

  private linkifyApexClasses(value: string): string {
    return value
      .split(",")
      .map(className => {
        const apexName = className.trim();
        return apexName ? `[${apexName}](../apex/${apexName}.md)` : '';
      })
      .filter(className => className.length > 0)
      .join(", ");
  }

  private linkifyObject(objectName: string): string {
    const trimmedObjectName = objectName.trim();
    return trimmedObjectName ? `[${trimmedObjectName}](../objects/${trimmedObjectName}.md)` : trimmedObjectName;
  }

  // Only the markup and the metadata are sent to AI: the "Where Used" section and the controller list
  // change whenever another metadata of the project changes, and would invalidate the AI cache of a
  // Visualforce page that was not touched at all.
  public async stripXmlForAi(): Promise<string> {
    const markup = this.additionalVariables.VISUALFORCE_MARKUP || '';
    const meta = this.additionalVariables.VISUALFORCE_META || '';
    return `${markup}\n\n${meta}`;
  }
}

export class DocBuilderVisualforcePage extends DocBuilderVisualforce {
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_VISUALFORCE_PAGE";
  public xmlRootKey = "ApexPage";
  public visualforceType = "Page";
  public markupRootTag = "apex:page";
}

export class DocBuilderVisualforceComponent extends DocBuilderVisualforce {
  public promptKey: PromptTemplate = "PROMPT_DESCRIBE_VISUALFORCE_COMPONENT";
  public xmlRootKey = "ApexComponent";
  public visualforceType = "Component";
  public markupRootTag = "apex:component";
}
