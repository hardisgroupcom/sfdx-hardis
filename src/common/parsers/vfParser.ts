import fs from "fs-extra";
import { load } from "cheerio";

export interface VisualforcePageData {
  name: string;
  customController?: string;
  standardController?: string;
  extensions: string[];
  pageMeta?: Record<string, any>;
  pageStructure?: {
    forms?: number;
    inputs?: string[];
    buttons?: string[];
  };
  scripts?: { type: string; value: string }[];
  actionSupports?: any[];
  outputPanels?: any[];
  bindings?: string[];
  dependencies?: {
    objects: string[];
    fields: string[];
    components: string[];
    staticResources: string[];
  };
}

export async function parseVisualforcePage(filePath: string): Promise<VisualforcePageData> {
  const content = await fs.readFile(filePath, "utf-8");
  const $ = load(content, { xmlMode: true });

  const pageName = filePath.split("/").pop()?.replace(".page", "") || "UnknownPage";

  // Extract some basic info
  const customController = $("apex\\:page").attr("controller") || undefined;
  const standardController = $("apex\\:page").attr("standardController") || undefined;
  const extensionsAttr = $("apex\\:page").attr("extensions");
  const extensions = extensionsAttr ? extensionsAttr.split(",").map(s => s.trim()) : [];

  // Count forms, inputs, buttons
  const forms = $("apex\\:form").length;
  const inputs: string[] = [];
  $("apex\\:inputField, apex\\:inputText, apex\\:inputTextArea, apex\\:selectList, apex\\:inputCheckbox").each((i, el) => {
    const binding = $(el).attr("value") || $(el).attr("id") || `input_${i}`;
    inputs.push(binding);
  });
  const buttons: string[] = [];
  $("apex\\:commandButton, apex\\:commandLink, apex\\:button").each((i, el) => {
    const action = $(el).attr("action") || $(el).attr("value") || `button_${i}`;
    buttons.push(action);
  });

  return {
    name: pageName,
    customController,
    standardController,
    extensions,
    pageStructure: {
      forms,
      inputs,
      buttons,
    },
    scripts: $("apex\\:includeScript, script").map((i, el) => ({
      type: el.tagName,
      value: $(el).attr("src") || $(el).html() || ""
    })).get(),
    actionSupports: $("apex\\:actionSupport").map((i, el) => ({
      event: $(el).attr("event"),
      action: $(el).attr("action"),
      reRender: $(el).attr("reRender"),
      status: $(el).attr("status"),
      parent: $(el).parent().attr("id") || $(el).parent().prop("tagName"),
      parentId: $(el).parent().attr("id") || null
    })).get(),
    outputPanels: $("apex\\:outputPanel").map((i, el) => ({
      id: $(el).attr("id"),
      layout: $(el).attr("layout") || "",
      contentPreview: $(el).text().substring(0, 50)
    })).get(),
    bindings: inputs,
    dependencies: {
      objects: [], // Could fill later by analyzing bindings
      fields: [],
      components: [],
      staticResources: []
    }
  };
}
