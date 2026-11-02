import { Connection } from '@salesforce/core';
import c from 'chalk';
import { glob } from 'glob';
import * as path from 'path';
import fs from './fsUtils.js';
import { execSfdxJson, git, uxLog } from './index.js';
import { t } from './i18n.js';
import { soqlQuery } from './apiUtils.js';
import { parsePackageXmlFile, writePackageXmlFile } from './xmlUtils.js';
import { buildActionOutput, PrePostCommand } from '../actionsProvider/actionsProvider.js';
import { CONSTANTS } from '../../config/index.js';
import { findSkipReplacementRulesFile } from '../replacementRules/config/ruleConfig.js';
import { hasOwnRunningUserRule, readRulesOfEveryPlace } from '../replacementRules/agentRunningUserBuiltInRule.js';

// First API version where agents are AiAgentDefinition and AiAgentDefinitionVersion
export const AGENT_DEFINITION_MIN_API_VERSION = 68.0;
export const AGENT_DEFINITION_TYPE = 'AiAgentDefinition';
export const AGENT_DEFINITION_VERSION_TYPE = 'AiAgentDefinitionVersion';
export const AGENT_AUTHORING_BUNDLE_TYPE = 'AiAuthoringBundle';
export const AGENT_RUNNING_USER_RULE_ID = 'builtin-agent-running-user';
const LEGACY_PLANNER_TYPE = 'GenAiPlannerBundle';
// Types of the agent itself: the project holds its authoring bundle instead
const AGENT_OWN_TYPES = [AGENT_DEFINITION_TYPE, AGENT_DEFINITION_VERSION_TYPE, AGENT_AUTHORING_BUNDLE_TYPE];
const DEFAULT_BUNDLE_META_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<AiAuthoringBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n    <bundleType>AGENT</bundleType>\n</AiAuthoringBundle>\n';
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

/** An entry of a package.xml that holds an agent in the format before API 68.0. */
export interface LegacyAgentEntry {
  type: string;
  member: string;
  // "*" for a wildcard
  agentName: string;
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

/** Authoring bundles of the org: the agents of Agentforce Builder, committed or still drafts. */
export async function listOrgAuthoringBundleNames(conn: Connection): Promise<string[]> {
  const listed: any = await conn.metadata.list([{ type: AGENT_AUTHORING_BUNDLE_TYPE }], String(AGENT_DEFINITION_MIN_API_VERSION.toFixed(1)));
  const listedItems: any[] = Array.isArray(listed) ? listed : listed ? [listed] : [];
  return listedItems.map((item) => String(item?.fullName || '')).filter(Boolean).sort();
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

// package.xml content of what a retrieve returned: the dependencies of the agent and its authoring bundle,
// named after the agent. The project holds no AiAgentDefinition nor AiAgentDefinitionVersion: the
// agent-publish deployment action creates them in each org, with the version number of that org.
export function buildAgentPackageXmlContent(retrievedFiles: Array<{ type?: string; fullName?: string; state?: string }>, agentName: string): Record<string, string[]> {
  const content: Record<string, string[]> = {};
  const addMember = (type: string, member: string) => {
    content[type] = content[type] || [];
    if (!content[type].includes(member)) {
      content[type].push(member);
    }
  };
  for (const file of retrievedFiles || []) {
    if (file?.type && file?.fullName && file.state !== 'Failed' && !AGENT_OWN_TYPES.includes(file.type)) {
      addMember(file.type, file.fullName);
    }
  }
  addMember(AGENT_AUTHORING_BUNDLE_TYPE, agentName);
  for (const type of Object.keys(content)) {
    content[type].sort();
  }
  return content;
}

/**
 * Writes the authoring bundle of the retrieved version (aiAuthoringBundles/<Agent>_<n>) as the bundle of
 * the agent (aiAuthoringBundles/<Agent>), the folder "sf agent publish authoring-bundle" reads, without
 * the version it targets. Then removes the retrieved files of the agent that git does not track: the
 * version bundle, the AiAgentDefinitionVersion and the AiAgentDefinition. A tracked file is kept: deleting
 * it would turn into a destructive change of the delta deployment. Returns the bundle folder, or null when
 * the retrieve returned no bundle for the version.
 */
export async function convertRetrievedAgentToBundle(
  retrievedFiles: Array<{ type?: string; fullName?: string; filePath?: string; state?: string }>,
  agentName: string,
  version: number,
  projectRoot: string = process.cwd()
): Promise<{ bundleFolder: string; removedFiles: string[]; keptFiles: string[] } | null> {
  const versionBundleName = `${agentName}_${version}`.toLowerCase();
  const scriptFile = (retrievedFiles || []).find(
    (file) => file?.type === AGENT_AUTHORING_BUNDLE_TYPE && String(file.fullName || '').toLowerCase() === versionBundleName && String(file.filePath || '').endsWith('.agent')
  )?.filePath;
  if (!scriptFile || !fs.existsSync(path.resolve(projectRoot, scriptFile))) {
    return null;
  }
  const versionFolder = path.dirname(path.resolve(projectRoot, scriptFile));
  const bundleFolder = path.join(path.dirname(versionFolder), agentName);
  await fs.ensureDir(bundleFolder);
  await fs.copyFile(path.resolve(projectRoot, scriptFile), path.join(bundleFolder, `${agentName}.agent`));
  const versionMetaFile = path.join(versionFolder, `${path.basename(versionFolder)}.bundle-meta.xml`);
  const metaXml = fs.existsSync(versionMetaFile) ? await fs.readFile(versionMetaFile, 'utf8') : DEFAULT_BUNDLE_META_XML;
  // <target> names a version of the org it was retrieved from
  await fs.writeFile(path.join(bundleFolder, `${agentName}.bundle-meta.xml`), metaXml.replace(/^[ \t]*<target>[^<]*<\/target>[ \t]*\r?\n/m, ''));

  const agentFiles = new Set<string>([versionFolder]);
  for (const file of retrievedFiles || []) {
    if (file?.filePath && (file.type === AGENT_DEFINITION_TYPE || file.type === AGENT_DEFINITION_VERSION_TYPE)) {
      const parsed = parseAgentVersionFullName(String(file.fullName || ''));
      const ownerName = parsed ? parsed.agentName : String(file.fullName || '');
      if (ownerName.toLowerCase() === agentName.toLowerCase()) {
        agentFiles.add(path.resolve(projectRoot, file.filePath));
      }
    }
  }
  // A tracked file gets its content of git back: the retrieve may have rewritten it, and the project
  // no longer deploys it
  const removed = new Set<string>();
  const kept = new Set<string>();
  for (const file of listFilesOf([...agentFiles])) {
    if (await isTrackedByGit(file)) {
      await git({ output: false, displayCommand: false }).raw(['checkout', '--', file]);
      kept.add(agentFileUnit(file, projectRoot));
    } else {
      await fs.remove(file);
      removed.add(agentFileUnit(file, projectRoot));
    }
  }
  await removeEmptyFolders([...agentFiles]);
  return { bundleFolder: path.relative(projectRoot, bundleFolder).replace(/\\/g, '/'), removedFiles: [...removed].sort(), keptFiles: [...kept].sort() };
}

/**
 * Removes from a package.xml the entries of the agent that the project no longer deploys: its
 * AiAgentDefinition, its AiAgentDefinitionVersion and the bundles of its versions (<Agent>_<n>).
 * Returns the removed entries as "Type:member".
 */
export async function removeAgentVersionEntries(packageXmlFile: string, agentName: string): Promise<string[]> {
  if (!fs.existsSync(packageXmlFile)) {
    return [];
  }
  const content = await parsePackageXmlFile(packageXmlFile);
  const name = agentName.toLowerCase();
  const isAgentEntry: Record<string, (member: string) => boolean> = {
    [AGENT_DEFINITION_TYPE]: (member) => member.toLowerCase() === name,
    [AGENT_DEFINITION_VERSION_TYPE]: (member) => parseAgentVersionFullName(member)?.agentName.toLowerCase() === name,
    [AGENT_AUTHORING_BUNDLE_TYPE]: (member) => new RegExp(`^${escapeRegex(name)}_\\d+$`).test(member.toLowerCase()),
  };
  const removed: string[] = [];
  for (const type of Object.keys(isAgentEntry)) {
    const members: string[] = (content[type] || []).map(String);
    const kept = members.filter((member) => !isAgentEntry[type](member));
    removed.push(...members.filter((member) => isAgentEntry[type](member)).map((member) => `${type}:${member}`));
    if (kept.length > 0) {
      content[type] = kept;
    } else {
      delete content[type];
    }
  }
  if (removed.length > 0) {
    await writePackageXmlKeepingVersion(packageXmlFile, content, packageXmlFile);
  }
  return removed;
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
    await writePackageXmlKeepingVersion(packageXmlFile, sorted, packageXmlFile);
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

/** Agents with a file of their authoring bundle changed since the commit: committed, staged, unstaged or new. */
export async function listAgentsChangedSince(fromCommit: string): Promise<string[]> {
  const changedFiles = [
    ...(await git({ output: false, displayCommand: false }).diff(['--name-only', fromCommit])).split('\n'),
    ...(await git({ output: false, displayCommand: false }).status()).not_added,
  ];
  const agentNames = new Set<string>();
  for (const file of changedFiles) {
    const match = /aiAuthoringBundles\/([^/]+)\//.exec(file.replace(/\\/g, '/'));
    // The bundle of a version (<Agent>_<n>) is not the one the project publishes
    if (match && !/_\d+$/.test(match[1])) {
      agentNames.add(match[1]);
    }
  }
  return [...agentNames].sort();
}

/**
 * Adds to the actions an agent-publish action of the agent, unless one is there. It runs once by org:
 * each publication creates a new version, even when the bundle did not change.
 */
export function upsertAgentPublishAction(actions: PrePostCommand[], agentName: string, newId: () => string): PrePostCommand {
  const existing = actions.find((action) => action.type === 'agent-publish' && String(action.parameters?.agentName || '').toLowerCase() === agentName.toLowerCase());
  if (existing) {
    return existing;
  }
  const action: PrePostCommand = {
    id: newId(),
    label: `Publish agent ${agentName} and activate the new version`,
    type: 'agent-publish',
    command: '',
    context: 'process-deployment-only',
    parameters: { agentName },
    allowFailure: false,
    runOnlyOnceByOrg: true,
  };
  actions.push(action);
  return action;
}

/**
 * Activates a version of an agent with "sf agent activate", then reads its status again: it is what
 * proves the version now runs. An org that does not tell the status is trusted on the command result.
 * Salesforce deactivates the version that was active.
 */
export async function activateAgentVersion(conn: Connection, target: AgentVersionInfo, commandThis: any): Promise<{ success: boolean; message: string }> {
  uxLog('log', commandThis, c.grey(`[DeploymentActions] ${t('activatingAgentVersion', { agentName: target.agentName, version: target.version })}`));
  const activateCommand =
    `sf agent activate --api-name ${target.agentName} --version ${target.version}` +
    ` --target-org ${conn.getUsername()}` +
    ' --json';
  const activateRes = await execSfdxJson(activateCommand, commandThis, { fail: false, output: true });
  if (activateRes?.status !== 0) {
    const activateOutput = buildActionOutput(activateRes);
    // Salesforce refuses a service agent whose running user is not a user of the org
    const hint = /should have a user assigned/i.test(activateOutput) ? `\n${t('agentActivationNeedsBotUser', { agentName: target.agentName, docUrl: AGENT_DOC_URL })}` : '';
    return { success: false, message: t('agentActivationFailed', { agentName: target.agentName, version: target.version, message: activateOutput }) + hint };
  }
  const updated = resolveAgentVersion(await listOrgAgentVersions(conn), target.agentName, target.version);
  if (updated?.status && updated.status.toLowerCase() !== 'active') {
    return { success: false, message: t('agentActivationFailed', { agentName: target.agentName, version: target.version, message: `Status is ${updated.status}` }) };
  }
  return { success: true, message: t('agentVersionActivated', { agentName: target.agentName, version: target.version }) };
}

/**
 * Adds to the pre-deployment actions an agent-running-user action for the agent, unless one is there.
 * Context all: the deployment check then validates the agent with the user of the target org.
 */
export function upsertAgentRunningUserAction(actions: PrePostCommand[], agentName: string, newId: () => string): PrePostCommand {
  const existing = actions.find((action) => action.type === 'agent-running-user' && String(action.parameters?.agentName || '').toLowerCase() === agentName.toLowerCase());
  if (existing) {
    return existing;
  }
  const action: PrePostCommand = {
    id: newId(),
    label: `Create the running user of agent ${agentName} when the org has none`,
    type: 'agent-running-user',
    command: '',
    context: 'all',
    parameters: { agentName },
    allowFailure: false,
    runOnlyOnceByOrg: false,
  };
  actions.push(action);
  return action;
}

/**
 * Entries of a package.xml that hold agents in the format before API 68.0: GenAiPlannerBundle, and the
 * Bot and BotVersion of an agent. A classic Einstein Bot (no agentType, no Copilot type) is not one.
 * Salesforce refuses them from API 68.0, where the same agents are AiAgentDefinition.
 */
export async function findLegacyAgentEntries(packageXmlFile: string, projectRoot: string = process.cwd()): Promise<LegacyAgentEntry[]> {
  if (!packageXmlFile || !fs.existsSync(packageXmlFile)) {
    return [];
  }
  const content = await parsePackageXmlFile(packageXmlFile);
  const entries: LegacyAgentEntry[] = [];
  for (const member of (content[LEGACY_PLANNER_TYPE] || []).map(String)) {
    entries.push({ type: LEGACY_PLANNER_TYPE, member, agentName: member === '*' ? '*' : member.replace(/_v\d+$/, '') });
  }
  const botMembers: string[] = (content['Bot'] || []).map(String);
  const botVersionMembers: string[] = (content['BotVersion'] || []).map(String);
  if (botMembers.length === 0 && botVersionMembers.length === 0) {
    return entries;
  }
  const agentBots = await listLocalAgentBots(projectRoot);
  for (const member of botMembers) {
    const names = member === '*' ? [...agentBots] : agentBots.has(member) ? [member] : [];
    names.forEach((name) => entries.push({ type: 'Bot', member, agentName: name }));
  }
  for (const member of botVersionMembers) {
    const botName = member.split('.')[0];
    if (member === '*' || agentBots.has(botName)) {
      entries.push({ type: 'BotVersion', member, agentName: member === '*' ? '*' : botName });
    }
  }
  return entries;
}

/** Removes the entries from the package.xml file. Returns the folders of the project that still hold them. */
export async function removeLegacyAgentEntries(packageXmlFile: string, entries: LegacyAgentEntry[], projectRoot: string = process.cwd()): Promise<string[]> {
  const content = await parsePackageXmlFile(packageXmlFile);
  for (const entry of entries) {
    const kept = (content[entry.type] || []).filter((member: string) => member !== entry.member);
    if (kept.length > 0) {
      content[entry.type] = kept;
    } else {
      delete content[entry.type];
    }
  }
  await writePackageXmlKeepingVersion(packageXmlFile, content, packageXmlFile);
  const agentNames = [...new Set(entries.map((entry) => entry.agentName).filter((name) => name !== '*'))];
  const folders = await glob(
    agentNames.flatMap((agentName) => [`**/bots/${agentName}`, `**/genAiPlannerBundles/${agentName}_v*`]),
    { cwd: projectRoot, ignore: ['**/node_modules/**', '**/.sfdx/**', '**/.sf/**'] }
  );
  return folders.map((folder) => folder.replace(/\\/g, '/')).sort();
}

/**
 * Running user of each agent of the project: botUser of its definition file, default_agent_user of its bundle. A service agent runs as a user
 * of its org: the username of the org it was retrieved from does not exist in the other orgs.
 */
export async function readAgentBotUsers(agentNames: string[], projectRoot: string = process.cwd()): Promise<Array<{ agentName: string; botUser: string; file: string }>> {
  const wanted = new Set(agentNames.filter((name) => name && name !== '*').map((name) => name.toLowerCase()));
  if (wanted.size === 0) {
    return [];
  }
  const files = await glob(['**/aiAgents/*.aiAgentDefinition-meta.xml', '**/aiAuthoringBundles/*/*.agent'], {
    cwd: projectRoot,
    ignore: ['**/node_modules/**', '**/.sfdx/**', '**/.sf/**'],
  });
  const botUsers: Array<{ agentName: string; botUser: string; file: string }> = [];
  for (const file of files.sort()) {
    const agentName = path.basename(file).replace(/\.aiAgentDefinition-meta\.xml$/, '').replace(/\.agent$/, '');
    if (!wanted.has(agentName.toLowerCase())) {
      continue;
    }
    const userRegex = file.endsWith('.agent') ? /default_agent_user:\s*"([^"]+)"/ : /<botUser>\s*([^<]+?)\s*<\/botUser>/;
    const match = userRegex.exec(await fs.readFile(path.join(projectRoot, file), 'utf8'));
    if (match) {
      botUsers.push({ agentName, botUser: match[1], file: file.replace(/\\/g, '/') });
    }
  }
  return botUsers;
}

/**
 * True when a replacement rule writes the running user of each org: the built-in rule
 * builtin-agent-running-user (on unless turned off in some place, or every rule is skipped),
 * or a rule of the project that writes botUser or default_agent_user.
 */
export async function hasBotUserReplacementRule(targetBranch: string | null = null): Promise<boolean> {
  if (await hasOwnRunningUserRule()) {
    return true;
  }
  const rules = await readRulesOfEveryPlace();
  const builtInTurnedOff = rules.some((rule) => rule?.id === AGENT_RUNNING_USER_RULE_ID && rule?.enabled === false);
  return !builtInTurnedOff && (await findSkipReplacementRulesFile(targetBranch)) === null;
}

// Bots of the project that are agents, not classic Einstein Bots
async function listLocalAgentBots(projectRoot: string): Promise<Set<string>> {
  const files = await glob('**/bots/*/*.bot-meta.xml', { cwd: projectRoot, ignore: ['**/node_modules/**', '**/.sfdx/**', '**/.sf/**'] });
  const agentBots = new Set<string>();
  for (const file of files) {
    const content = await fs.readFile(path.join(projectRoot, file), 'utf8');
    if (/<agentType>|<type>\s*\w*Copilot\s*<\/type>/.test(content)) {
      agentBots.add(path.basename(file).replace(/\.bot-meta\.xml$/, ''));
    }
  }
  return agentBots;
}

// writePackageXmlFile writes the default API version: keep the one of the source file
async function writePackageXmlKeepingVersion(targetFile: string, content: Record<string, string[]>, versionSourceFile: string): Promise<void> {
  const originalVersion = fs.existsSync(versionSourceFile) ? /<version>\s*([\d.]+)\s*<\/version>/.exec(await fs.readFile(versionSourceFile, 'utf8'))?.[1] : undefined;
  await writePackageXmlFile(targetFile, content);
  if (originalVersion) {
    const written = await fs.readFile(targetFile, 'utf8');
    await fs.writeFile(targetFile, written.replace(/<version>\s*[\d.]+\s*<\/version>/, `<version>${originalVersion}</version>`));
  }
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
    uxLog('log', null, c.grey(`Unable to read agent version statuses: ${e?.message || e}`));
  }
  return statuses;
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

async function isTrackedByGit(file: string): Promise<boolean> {
  try {
    const listed = await git({ output: false, displayCommand: false }).raw(['ls-files', '--', file]);
    return listed.trim() !== '';
  } catch {
    // Not a git repository: nothing is tracked
    return false;
  }
}

// Every file of the paths: a folder gives the files it holds, at any depth
function listFilesOf(paths: string[]): string[] {
  const files = new Set<string>();
  const walk = (current: string) => {
    if (!fs.existsSync(current)) {
      return;
    }
    if (fs.statSync(current).isDirectory()) {
      fs.readdirSync(current).forEach((entry) => walk(path.join(current, entry)));
    } else {
      files.add(current);
    }
  };
  paths.forEach(walk);
  return [...files].sort();
}

// What a file of an agent is reported as: its version folder, its bundle folder, or the file itself
function agentFileUnit(file: string, projectRoot: string): string {
  const relative = path.relative(projectRoot, file).replace(/\\/g, '/');
  const folder = /^(.*\/(?:aiAgentDefinitionVersions|aiAuthoringBundles)\/[^/]+)\//.exec(relative);
  return folder ? folder[1] : relative;
}

// Removes the empty folders under the paths, then the paths and their parents while they are empty,
// up to the folder of the metadata type
async function removeEmptyFolders(paths: string[]): Promise<void> {
  const typeFolders = ['aiAgentDefinitionVersions', 'aiAuthoringBundles', 'aiAgents'];
  const prune = (folder: string): boolean => {
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
      return false;
    }
    fs.readdirSync(folder).forEach((entry) => prune(path.join(folder, entry)));
    if (fs.readdirSync(folder).length === 0 && !typeFolders.includes(path.basename(folder))) {
      fs.rmdirSync(folder);
      return true;
    }
    return false;
  };
  for (const item of paths) {
    let current = fs.existsSync(item) && fs.statSync(item).isDirectory() ? item : path.dirname(item);
    prune(current);
    current = path.dirname(current);
    while (fs.existsSync(current) && fs.readdirSync(current).length === 0 && !typeFolders.includes(path.basename(current))) {
      fs.rmdirSync(current);
      current = path.dirname(current);
    }
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addMissing(missing: Map<string, MissingAgentReference>, reference: MissingAgentReference): void {
  const key = `${reference.type}:${reference.name.toLowerCase()}`;
  if (!missing.has(key)) {
    missing.set(key, reference);
  }
}
