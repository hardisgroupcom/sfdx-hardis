import { Connection, SfError } from '@salesforce/core';
import c from 'chalk';
import { glob } from 'glob';
import * as path from 'path';
import fs from './fsUtils.js';
import { createTempDir, uxLog } from './index.js';
import { soqlQuery } from './apiUtils.js';
import { parsePackageXmlFile, writePackageXmlFile } from './xmlUtils.js';
import { t } from './i18n.js';
import { CONSTANTS } from '../../config/index.js';

// First API version where agents are AiAgentDefinition and AiAgentDefinitionVersion
export const AGENT_DEFINITION_MIN_API_VERSION = 68.0;
export const AGENT_DEFINITION_TYPE = 'AiAgentDefinition';
export const AGENT_DEFINITION_VERSION_TYPE = 'AiAgentDefinitionVersion';
export const AGENT_DOC_URL = `${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-agentforce-agents/`;

// Custom objects and fields (__c), Data 360 objects (__dlm, __dll) and external objects (__x)
const CUSTOM_REFERENCE_REGEX = /\b([A-Za-z][A-Za-z0-9_]*__(?:c|dlm|dll|x))(?:\.([A-Za-z][A-Za-z0-9_]*__c))?\b/g;

/** A version of an agent, as listed from an org. */
export interface AgentVersionInfo {
  agentName: string;
  version: number;
  // Active, Inactive... Empty when the org did not tell
  status: string;
}

/** A component of the project the retrieved agent refers to, and that the project does not hold. */
export interface MissingAgentReference {
  type: 'CustomObject' | 'CustomField';
  name: string;
  referencedBy: string;
}

export function isApiVersionAtLeast(apiVersion: string | number | null | undefined, minVersion: number = AGENT_DEFINITION_MIN_API_VERSION): boolean {
  const parsed = parseFloat(String(apiVersion ?? ''));
  return !isNaN(parsed) && parsed >= minVersion;
}

// "MyAgent#3" -> { agentName: "MyAgent", version: 3 }. null when the name holds no version number.
export function parseAgentVersionFullName(fullName: string): { agentName: string; version: number } | null {
  const match = /^(.+)#(\d+)$/.exec(String(fullName || '').trim());
  if (!match) {
    return null;
  }
  return { agentName: match[1], version: parseInt(match[2], 10) };
}

export function formatAgentVersionFullName(agentName: string, version: number): string {
  return `${agentName}#${version}`;
}

/** Versions of every agent of the org, sorted by agent name then by version number. */
export async function listOrgAgentVersions(conn: Connection): Promise<AgentVersionInfo[]> {
  const listed: any = await conn.metadata.list([{ type: AGENT_DEFINITION_VERSION_TYPE }], String(AGENT_DEFINITION_MIN_API_VERSION.toFixed(1)));
  const listedItems: any[] = Array.isArray(listed) ? listed : listed ? [listed] : [];
  const statuses = await readAgentVersionStatuses(conn);
  const versions: AgentVersionInfo[] = [];
  for (const item of listedItems) {
    const parsed = parseAgentVersionFullName(item?.fullName);
    if (parsed) {
      versions.push({ ...parsed, status: statuses.get(formatAgentVersionFullName(parsed.agentName, parsed.version).toLowerCase()) || '' });
    }
  }
  return versions.sort((a, b) => a.agentName.localeCompare(b.agentName) || a.version - b.version);
}

// "latest" or empty: the highest version. A number: that version, or null when the org does not have it.
export function resolveAgentVersion(versions: AgentVersionInfo[], agentName: string, requested?: string | number | null): AgentVersionInfo | null {
  const agentVersions = versions.filter((version) => version.agentName.toLowerCase() === String(agentName).toLowerCase());
  if (agentVersions.length === 0) {
    return null;
  }
  const requestedStr = String(requested ?? '').trim().toLowerCase();
  if (requestedStr === '' || requestedStr === 'latest') {
    return agentVersions.reduce((latest, version) => (version.version > latest.version ? version : latest));
  }
  const requestedNumber = parseInt(requestedStr, 10);
  return agentVersions.find((version) => version.version === requestedNumber) || null;
}

// package.xml content of what a retrieve returned. The whole AiAgentDefinition is always there:
// the first deployment of an agent to an org needs it.
export function buildAgentPackageXmlContent(retrievedFiles: Array<{ type?: string; fullName?: string; state?: string }>, agentName: string): Record<string, string[]> {
  const content: Record<string, string[]> = {};
  const addMember = (type: string, member: string) => {
    content[type] = content[type] || [];
    if (!content[type].includes(member)) {
      content[type].push(member);
    }
  };
  for (const file of retrievedFiles || []) {
    if (file?.type && file?.fullName && file.state !== 'Failed') {
      addMember(file.type, file.fullName);
    }
  }
  addMember(AGENT_DEFINITION_TYPE, agentName);
  for (const type of Object.keys(content)) {
    content[type].sort();
  }
  return content;
}

/** Adds the content to a package.xml file (created when missing), and returns the members that were not there yet. */
export async function mergeIntoPackageXml(packageXmlFile: string, contentToAdd: Record<string, string[]>): Promise<Array<{ type: string; member: string }>> {
  const current: Record<string, string[]> = fs.existsSync(packageXmlFile) ? await parsePackageXmlFile(packageXmlFile) : {};
  const added: Array<{ type: string; member: string }> = [];
  for (const type of Object.keys(contentToAdd)) {
    const members = current[type] || [];
    // A wildcard already covers every member of the type
    if (members.includes('*')) {
      continue;
    }
    for (const member of contentToAdd[type]) {
      if (!members.includes(member)) {
        members.push(member);
        added.push({ type, member });
      }
    }
    current[type] = members.sort();
  }
  if (added.length > 0) {
    const sorted: Record<string, string[]> = {};
    for (const type of Object.keys(current).sort()) {
      sorted[type] = current[type];
    }
    await fs.ensureDir(path.dirname(packageXmlFile));
    await writePackageXmlFile(packageXmlFile, sorted);
  }
  return added;
}

/**
 * Custom objects, custom fields and Data 360 objects that the retrieved agent files name, and that
 * the project does not hold. The CLI does not retrieve them with the agent. Read from the files, so
 * a name the agent only mentions in a text is listed too: the result is what may be missing.
 */
export async function findMissingAgentReferences(agentFiles: string[], projectRoot: string = process.cwd()): Promise<MissingAgentReference[]> {
  const localObjects = await listLocalObjectFolders(projectRoot);
  const missing = new Map<string, MissingAgentReference>();
  for (const agentFile of agentFiles) {
    if (!fs.existsSync(agentFile) || fs.statSync(agentFile).isDirectory()) {
      continue;
    }
    const content = await fs.readFile(agentFile, 'utf8');
    const referencedBy = path.relative(projectRoot, agentFile).replace(/\\/g, '/');
    for (const match of content.matchAll(CUSTOM_REFERENCE_REGEX)) {
      const objectName = match[1];
      const fieldName = match[2];
      const objectFolder = localObjects.get(objectName.toLowerCase());
      if (!objectFolder) {
        addMissing(missing, { type: 'CustomObject', name: objectName, referencedBy });
        continue;
      }
      if (fieldName && !fs.existsSync(path.join(objectFolder, 'fields', `${fieldName}.field-meta.xml`))) {
        addMissing(missing, { type: 'CustomField', name: `${objectName}.${fieldName}`, referencedBy });
      }
    }
  }
  return [...missing.values()].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

/** Names of the agents a package.xml deploys, with or without their AiAgentDefinition. */
export async function getAgentNamesFromPackageXml(packageXmlFile: string): Promise<{ definitions: string[]; versionOnly: string[] }> {
  const content = await parsePackageXmlFile(packageXmlFile);
  const definitions: string[] = (content[AGENT_DEFINITION_TYPE] || []).map(String);
  const fromVersions = (content[AGENT_DEFINITION_VERSION_TYPE] || [])
    .map((member: string) => parseAgentVersionFullName(member)?.agentName || String(member).split('#')[0])
    .filter((name: string) => name && name !== '*');
  const hasAllDefinitions = definitions.includes('*');
  const versionOnly = [...new Set<string>(fromVersions)].filter(
    (name) => !hasAllDefinitions && !definitions.some((definition) => definition.toLowerCase() === name.toLowerCase())
  );
  return { definitions, versionOnly };
}

/**
 * Before a deployment: fails when the target org cannot receive the agent metadata types, and adds the
 * AiAgentDefinition of every agent deployed as a version only that the target org does not hold yet.
 * Returns the package.xml to deploy: a copy when something was added, so the project file is never changed.
 */
export async function applyAgentDeploymentGuard(packageXmlFile: string, conn: Connection, commandThis: any): Promise<string> {
  if (!packageXmlFile || !fs.existsSync(packageXmlFile)) {
    return packageXmlFile;
  }
  const { definitions, versionOnly } = await getAgentNamesFromPackageXml(packageXmlFile);
  if (definitions.length === 0 && versionOnly.length === 0) {
    return packageXmlFile;
  }
  const orgApiVersion = conn.getApiVersion();
  if (!isApiVersionAtLeast(orgApiVersion)) {
    throw new SfError(
      t('agentDeployRequiresApi68', {
        org: conn.getUsername() || '',
        apiVersion: orgApiVersion,
        agents: [...definitions, ...versionOnly].join(', '),
        docUrl: AGENT_DOC_URL,
      })
    );
  }
  if (versionOnly.length === 0) {
    return packageXmlFile;
  }
  const orgAgents = await listOrgAgentDefinitionNames(conn);
  const agentsToAdd = versionOnly.filter((name) => !orgAgents.has(name.toLowerCase()));
  if (agentsToAdd.length === 0) {
    return packageXmlFile;
  }
  const guardedPackageXmlFile = path.join(await createTempDir(), 'package-with-agent-definitions.xml');
  await fs.copy(packageXmlFile, guardedPackageXmlFile);
  await mergeIntoPackageXml(guardedPackageXmlFile, { [AGENT_DEFINITION_TYPE]: agentsToAdd });
  for (const agentName of agentsToAdd) {
    uxLog('action', commandThis, c.cyan(t('agentDefinitionAddedToDeployment', { agentName: c.bold(agentName) })));
  }
  return guardedPackageXmlFile;
}

// Status of each version, keyed by lowercase "Agent#n". Empty when the org does not answer the query.
async function readAgentVersionStatuses(conn: Connection): Promise<Map<string, string>> {
  const statuses = new Map<string, string>();
  try {
    const result = await soqlQuery('SELECT BotDefinition.DeveloperName, VersionNumber, Status FROM BotVersion', conn);
    for (const record of result.records || []) {
      const agentName = record?.BotDefinition?.DeveloperName;
      if (agentName && record.VersionNumber !== undefined && record.VersionNumber !== null) {
        statuses.set(formatAgentVersionFullName(agentName, Number(record.VersionNumber)).toLowerCase(), String(record.Status || ''));
      }
    }
  } catch (e: any) {
    uxLog('log', this, c.grey(`Unable to read agent version statuses: ${e?.message || e}`));
  }
  return statuses;
}

async function listOrgAgentDefinitionNames(conn: Connection): Promise<Set<string>> {
  const listed: any = await conn.metadata.list([{ type: AGENT_DEFINITION_TYPE }], String(AGENT_DEFINITION_MIN_API_VERSION.toFixed(1)));
  const listedItems: any[] = Array.isArray(listed) ? listed : listed ? [listed] : [];
  return new Set(listedItems.map((item) => String(item?.fullName || '').toLowerCase()).filter(Boolean));
}

// Object folders of the project, keyed by lowercase object API name
async function listLocalObjectFolders(projectRoot: string): Promise<Map<string, string>> {
  const objectFiles = await glob('**/objects/*/*.object-meta.xml', {
    cwd: projectRoot,
    ignore: ['**/node_modules/**', '**/.sfdx/**', '**/.sf/**'],
  });
  const folders = new Map<string, string>();
  for (const objectFile of objectFiles) {
    const folder = path.join(projectRoot, path.dirname(objectFile));
    folders.set(path.basename(folder).toLowerCase(), folder);
  }
  return folders;
}

function addMissing(missing: Map<string, MissingAgentReference>, reference: MissingAgentReference): void {
  const key = `${reference.type}:${reference.name.toLowerCase()}`;
  if (!missing.has(key)) {
    missing.set(key, reference);
  }
}
