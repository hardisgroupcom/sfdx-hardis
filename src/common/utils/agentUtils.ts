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
import { resolveDeployApiVersion } from '../replacementRules/engine/ruleEngine.js';
import { findSkipReplacementRulesFile } from '../replacementRules/config/ruleConfig.js';
import { hasOwnRunningUserRule, readRulesOfEveryPlace } from '../replacementRules/agentRunningUserBuiltInRule.js';

// First API version where agents are AiAgentDefinition and AiAgentDefinitionVersion
export const AGENT_DEFINITION_MIN_API_VERSION = 68.0;
export const AGENT_DEFINITION_TYPE = 'AiAgentDefinition';
export const AGENT_DEFINITION_VERSION_TYPE = 'AiAgentDefinitionVersion';
export const AGENT_AUTHORING_BUNDLE_TYPE = 'AiAuthoringBundle';
export const AGENT_RUNNING_USER_RULE_ID = 'builtin-agent-running-user';
const LEGACY_PLANNER_TYPE = 'GenAiPlannerBundle';
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
  await assertNoLegacyAgentAtApi68(packageXmlFile, conn);
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
  await warnWhenDeployApiVersionTooLow(packageXmlFile, conn, [...definitions, ...versionOnly], commandThis);
  await warnWhenBotUserMissingInTargetOrg([...definitions, ...versionOnly], conn, commandThis);

  // An agent version is deployed only when the target org does not have it, like the components of
  // package-no-overwrite.xml: a committed version never changes, and Salesforce refuses the whole
  // deployment when it holds the active one ("Can't edit an active bot version").
  const content = await parsePackageXmlFile(packageXmlFile);
  const deployedVersions: string[] = (content[AGENT_DEFINITION_VERSION_TYPE] || []).map(String).filter((member: string) => member !== '*');
  const orgVersions = await listOrgAgentVersions(conn);
  await warnWhenVersionsCommittedOutsideProject([...definitions, ...versionOnly], orgVersions, commandThis);
  const versionsInOrg = new Set(orgVersions.map((version) => formatAgentVersionFullName(version.agentName, version.version).toLowerCase()));
  const versionsToSkip = deployedVersions.filter((member) => versionsInOrg.has(member.toLowerCase()));

  const orgAgents = versionOnly.length > 0 ? await listOrgAgentDefinitionNames(conn) : new Set<string>();
  const agentsToAdd = versionOnly.filter((name) => !orgAgents.has(name.toLowerCase()));
  if (versionsToSkip.length === 0 && agentsToAdd.length === 0) {
    return packageXmlFile;
  }

  // Changes go to a copy, so the project file is never changed
  if (versionsToSkip.length > 0) {
    const keptVersions = content[AGENT_DEFINITION_VERSION_TYPE].filter((member: string) => !versionsToSkip.includes(member));
    if (keptVersions.length > 0) {
      content[AGENT_DEFINITION_VERSION_TYPE] = keptVersions;
    } else {
      delete content[AGENT_DEFINITION_VERSION_TYPE];
    }
    for (const member of versionsToSkip) {
      uxLog('action', commandThis, c.cyan(t('agentExistingVersionSkipped', { version: c.bold(member) })));
    }
  }
  if (agentsToAdd.length > 0) {
    content[AGENT_DEFINITION_TYPE] = [...new Set([...(content[AGENT_DEFINITION_TYPE] || []), ...agentsToAdd])].sort();
    for (const agentName of agentsToAdd) {
      uxLog('action', commandThis, c.cyan(t('agentDefinitionAddedToDeployment', { agentName: c.bold(agentName) })));
    }
  }
  const guardedPackageXmlFile = path.join(await createTempDir(), 'package-agents-guarded.xml');
  await writePackageXmlKeepingVersion(guardedPackageXmlFile, content, packageXmlFile);
  return guardedPackageXmlFile;
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
 * Post-deployment actions that activate the agent versions a package.xml deploys: the highest version
 * of each agent, or the latest one of the target org when the package.xml holds a wildcard.
 */
export async function buildAgentAutoActivateCommands(packageXmlFile: string): Promise<any[]> {
  if (!packageXmlFile || !fs.existsSync(packageXmlFile)) {
    return [];
  }
  const content = await parsePackageXmlFile(packageXmlFile);
  const members: string[] = (content[AGENT_DEFINITION_VERSION_TYPE] || []).map(String);
  const highestVersions = new Map<string, number>();
  for (const member of members) {
    const parsed = parseAgentVersionFullName(member);
    if (parsed && parsed.version > (highestVersions.get(parsed.agentName) ?? 0)) {
      highestVersions.set(parsed.agentName, parsed.version);
    }
  }
  const toActivate = [...highestVersions.entries()].map(([agentName, version]) => ({ agentName, agentVersion: String(version) }));
  if (members.includes('*')) {
    for (const agentName of (content[AGENT_DEFINITION_TYPE] || []).map(String)) {
      if (agentName !== '*' && !highestVersions.has(agentName)) {
        toActivate.push({ agentName, agentVersion: 'latest' });
      }
    }
  }
  return toActivate
    .sort((a, b) => a.agentName.localeCompare(b.agentName))
    .map((parameters) => ({
      id: `AGENT_ACTIVATE_${parameters.agentName}`,
      label: t('agentAutoActivateLabel', { agentName: parameters.agentName, version: parameters.agentVersion }),
      type: 'agent-activate',
      parameters,
      context: 'process-deployment-only',
      preOrPost: 'commandsPostDeploy',
    }));
}

/**
 * Running user (botUser) of each agent definition file of the project. A service agent runs as a user
 * of its org: the username of the org it was retrieved from does not exist in the other orgs.
 */
export async function readAgentBotUsers(agentNames: string[], projectRoot: string = process.cwd()): Promise<Array<{ agentName: string; botUser: string; file: string }>> {
  const wanted = new Set(agentNames.filter((name) => name && name !== '*').map((name) => name.toLowerCase()));
  if (wanted.size === 0) {
    return [];
  }
  const files = await glob('**/aiAgents/*.aiAgentDefinition-meta.xml', {
    cwd: projectRoot,
    ignore: ['**/node_modules/**', '**/.sfdx/**', '**/.sf/**'],
  });
  const botUsers: Array<{ agentName: string; botUser: string; file: string }> = [];
  for (const file of files.sort()) {
    const agentName = path.basename(file).replace(/\.aiAgentDefinition-meta\.xml$/, '');
    if (!wanted.has(agentName.toLowerCase())) {
      continue;
    }
    const match = /<botUser>\s*([^<]+?)\s*<\/botUser>/.exec(await fs.readFile(path.join(projectRoot, file), 'utf8'));
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
export async function hasBotUserReplacementRule(): Promise<boolean> {
  if (await hasOwnRunningUserRule()) {
    return true;
  }
  const rules = await readRulesOfEveryPlace();
  const builtInTurnedOff = rules.some((rule) => rule?.id === AGENT_RUNNING_USER_RULE_ID && rule?.enabled === false);
  return !builtInTurnedOff && (await findSkipReplacementRulesFile(null)) === null;
}

// sourceApiVersion or the package.xml version below 68.0 lowers the deployment API version: Salesforce then refuses the agent types
async function warnWhenDeployApiVersionTooLow(packageXmlFile: string, conn: Connection, agents: string[], commandThis: any): Promise<void> {
  const deployApiVersion = await resolveDeployApiVersion({ conn, packageXmlFiles: [packageXmlFile] });
  if (deployApiVersion && !isApiVersionAtLeast(deployApiVersion)) {
    uxLog(
      'warning',
      commandThis,
      c.yellow(t('agentDeployApiVersionTooLow', { agents: agents.join(', '), apiVersion: deployApiVersion.toFixed(1), docUrl: AGENT_DOC_URL }))
    );
  }
}

// The agent deploys, but Salesforce refuses to activate it while its botUser is not a user of the org
async function warnWhenBotUserMissingInTargetOrg(agentNames: string[], conn: Connection, commandThis: any): Promise<void> {
  const botUsers = await readAgentBotUsers(agentNames);
  if (botUsers.length === 0 || (await hasBotUserReplacementRule())) {
    return;
  }
  const usernames = [...new Set(botUsers.map((item) => item.botUser))];
  let existing: Set<string>;
  try {
    const result = await soqlQuery(`SELECT Username FROM User WHERE Username IN (${usernames.map((username) => `'${username.replace(/'/g, "\\'")}'`).join(',')})`, conn);
    existing = new Set((result.records || []).map((record: any) => String(record.Username).toLowerCase()));
  } catch (e: any) {
    uxLog('log', commandThis, c.grey(`Unable to check the users of the agents: ${e?.message || e}`));
    return;
  }
  for (const item of botUsers.filter((botUser) => !existing.has(botUser.botUser.toLowerCase()))) {
    uxLog('warning', commandThis, c.yellow(t('agentBotUserMissingInTargetOrg', { agentName: item.agentName, botUser: item.botUser, file: item.file, docUrl: AGENT_DOC_URL })));
  }
}


// Agent versions are committed in a developer sandbox only. A version the target org has and the project
// does not was committed in that org: its number will be taken again by the next version of the sandbox.
async function warnWhenVersionsCommittedOutsideProject(agentNames: string[], orgVersions: AgentVersionInfo[], commandThis: any): Promise<void> {
  const wanted = new Set(agentNames.filter((name) => name && name !== '*').map((name) => name.toLowerCase()));
  if (wanted.size === 0) {
    return;
  }
  const localFiles = await glob('**/aiAgentDefinitionVersions/*/*.aiAgentDefinitionVersion-meta.xml', {
    cwd: process.cwd(),
    ignore: ['**/node_modules/**', '**/.sfdx/**', '**/.sf/**'],
  });
  const localVersions = new Set(localFiles.map((file) => path.basename(path.dirname(file)).toLowerCase()));
  const outside = new Map<string, number[]>();
  for (const version of orgVersions) {
    const fullName = formatAgentVersionFullName(version.agentName, version.version).toLowerCase();
    if (wanted.has(version.agentName.toLowerCase()) && !localVersions.has(fullName)) {
      outside.set(version.agentName, [...(outside.get(version.agentName) || []), version.version]);
    }
  }
  for (const [agentName, versions] of outside) {
    uxLog('warning', commandThis, c.yellow(t('agentVersionsCommittedOutsideProject', { agentName, versions: versions.sort((a, b) => a - b).join(', '), docUrl: AGENT_DOC_URL })));
  }
}

// The format before API 68.0 fails the whole deployment from API 68.0: stop before anything is sent
async function assertNoLegacyAgentAtApi68(packageXmlFile: string, conn: Connection): Promise<void> {
  const legacy = await findLegacyAgentEntries(packageXmlFile);
  if (legacy.length === 0) {
    return;
  }
  const deployApiVersion = await resolveDeployApiVersion({ conn, packageXmlFiles: [packageXmlFile] });
  if (deployApiVersion && isApiVersionAtLeast(deployApiVersion)) {
    throw new SfError(
      t('agentLegacyTypesAtApi68', {
        apiVersion: deployApiVersion.toFixed(1),
        entries: legacy.map((entry) => `${entry.type}:${entry.member}`).join(', '),
        agents: [...new Set(legacy.map((entry) => entry.agentName))].join(', '),
        docUrl: AGENT_DOC_URL,
      })
    );
  }
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
