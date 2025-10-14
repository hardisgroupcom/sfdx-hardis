import fs from "fs-extra";

/** ---------- Interfaces ---------- **/

export interface ApexAnnotation {
  name: string;
  args?: string;
}

export interface ApexProperty {
  visibility: string;
  type: string;
  name: string;
  annotations: ApexAnnotation[];
  description?: string;
}

export interface ApexParameter {
  type: string;
  name: string;
}

export interface ApexMethod {
  visibility: string;
  returnType: string;
  name: string;
  parameters: ApexParameter[];
  annotations: ApexAnnotation[];
  description?: string;
}

export interface ApexTriggerInfo {
  triggerName: string;
  objectName: string;
  events: string[];
  description?: string;
}

export interface ApexClassInfo {
  className: string;
  description?: string;
  extends?: string;
  implements?: string[];
  annotations: ApexAnnotation[];
  properties: ApexProperty[];
  methods: ApexMethod[];
  extensions?: string[];
  isTest?: boolean;
  isTrigger?: boolean;
  triggerInfo?: ApexTriggerInfo;
}

/** ---------- Main Parser ---------- **/

export async function parseApexClass(filePath: string): Promise<ApexClassInfo> {
  const fallback: ApexClassInfo = {
    className: "",
    annotations: [],
    properties: [],
    methods: [],
  };

  if (!(await fs.pathExists(filePath))) {
    return fallback;
  }

  const content = await fs.readFile(filePath, "utf-8");
  const normalized = content.replace(/\r\n/g, "\n");

  // --- Capture all doc comments (/** ... */)
  const commentBlocks = new Map<number, string>();
  const commentRegex = /\/\*\*([\s\S]*?)\*\//g;
  let commentMatch;
  while ((commentMatch = commentRegex.exec(normalized)) !== null) {
    commentBlocks.set(commentMatch.index, commentMatch[1].replace(/\*/g, "").trim());
  }

  // --- Check if file is a Trigger
  const triggerRegex = /trigger\s+([A-Za-z0-9_]+)\s+on\s+([A-Za-z0-9_]+)\s*\(([^)]+)\)/i;
  const triggerMatch = normalized.match(triggerRegex);
  if (triggerMatch) {
    const triggerName = triggerMatch[1];
    const objectName = triggerMatch[2];
    const events = triggerMatch[3]
      .split(",")
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);

    return {
      className: triggerName,
      isTrigger: true,
      annotations: [],
      properties: [],
      methods: [],
      triggerInfo: { triggerName, objectName, events },
      description: getClosestComment(commentBlocks, triggerMatch?.index ?? 0),
    };
  }

  // --- Class declaration
  const classRegex =
    /(?:(?:global|public|private|protected)\s+)?(?:with\s+sharing|without\s+sharing)?\s*class\s+([A-Za-z0-9_]+)(?:\s+extends\s+([A-Za-z0-9_]+))?(?:\s+implements\s+([A-Za-z0-9_,\s]+))?(?:\s+extends\s+([A-Za-z0-9_]+))?/;
  const classMatch = normalized.match(classRegex);

  const className = classMatch?.[1] ?? "";
  const extendsName = classMatch?.[2] ?? classMatch?.[4];
  const implementsList = classMatch?.[3]
    ? classMatch[3].split(",").map(s => s.trim()).filter(Boolean)
    : [];

  // --- Class-level annotations
  const annotationRegex = /@([A-Za-z0-9_]+)(\((.*?)\))?/g;
  const beforeClass = normalized.slice(0, classMatch?.index ?? 0);
  const classAnnotations = extractAnnotations(beforeClass, annotationRegex);

  // --- Detect test classes
  const isTest =
    classAnnotations.some(a => a.name.toLowerCase() === "istest") ||
    /@isTest/i.test(normalized) ||
    /@testSetup/i.test(normalized);

  // --- Extensions (used in controllers)
  const extensionRegex = /extends\s+([A-Za-z0-9_]+)/g;
  const extensions: string[] = [];
  let extMatch;
  while ((extMatch = extensionRegex.exec(normalized)) !== null) {
    extensions.push(extMatch[1]);
  }

  // --- Properties
  const propertyRegex =
    /((?:@[\w(),\s"]+\s*)*)((?:public|private|protected|global|static|final)\s+[\w<>,\s[\]]+\s+[\w_]+\s*;)/g;
  const properties: ApexProperty[] = [];
  let propMatch;
  while ((propMatch = propertyRegex.exec(normalized)) !== null) {
    const annotations = extractAnnotations(propMatch[1], annotationRegex);
    const statement = propMatch[2].trim();

    const parts = statement.replace(/;$/, "").split(/\s+/);
    const visibility = parts[0];
    const type = parts.slice(1, parts.length - 1).join(" ");
    const name = parts[parts.length - 1];

    const description = getClosestComment(commentBlocks, propMatch.index);

    properties.push({ visibility, type, name, annotations, description });
  }

  // --- Methods
  const methodRegex =
    /((?:@[\w(),\s"]+\s*)*)((?:public|private|protected|global|static|final)\s+[\w<>,\s[\]]+\s+[\w_]+)\s*\(([^)]*)\)\s*\{/g;
  const methods: ApexMethod[] = [];
  let methodMatch;
  while ((methodMatch = methodRegex.exec(normalized)) !== null) {
    const annotations = extractAnnotations(methodMatch[1], annotationRegex);
    const signature = methodMatch[2].trim().split(/\s+/);
    const visibility = signature[0];
    const returnType = signature.slice(1, signature.length - 1).join(" ");
    const name = signature[signature.length - 1];

    const paramList = methodMatch[3]
      ? methodMatch[3]
        .split(",")
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => {
          const [type, name] = p.split(/\s+/);
          return { type: type || "", name: name || "" };
        })
      : [];

    const description = getClosestComment(commentBlocks, methodMatch.index);

    methods.push({ visibility, returnType, name, parameters: paramList, annotations, description });
  }

  const description = getClosestComment(commentBlocks, classMatch?.index ?? 0);

  return {
    className,
    extends: extendsName,
    implements: implementsList,
    annotations: classAnnotations,
    description,
    properties,
    methods,
    extensions,
    isTest,
    isTrigger: false,
  };
}

/** ---------- Helpers ---------- **/

function extractAnnotations(segment: string, regex: RegExp): ApexAnnotation[] {
  const annotations: ApexAnnotation[] = [];
  let match;
  while ((match = regex.exec(segment)) !== null) {
    annotations.push({
      name: match[1],
      args: match[3]?.trim(),
    });
  }
  return annotations;
}

function getClosestComment(comments: Map<number, string>, position: number): string | undefined {
  let closestKey = -1;
  for (const [key] of comments) {
    if (key < position && key > closestKey) {
      closestKey = key;
    }
  }
  return closestKey !== -1 ? comments.get(closestKey) : undefined;
}
