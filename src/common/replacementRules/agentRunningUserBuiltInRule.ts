// Built-in rule builtin-agent-running-user: a service agent runs as a user of its org (botUser of the
// AiAgentDefinition, default_agent_user of the Agent Script of its authoring bundles). The username of
// the org the agent was retrieved from exists nowhere else, so each org gets a user of its own, created
// with "sf org create agent-user" by the agent-running-user deployment action of the Pull Request, and
// found again by its username at each deployment: <agent>.<unique id>@<org id>.ext.
// The rule never creates a user: a change to the org is always recorded in the Pull Request.

import c from 'chalk';
import { createHash } from 'crypto';
import { Org } from '@salesforce/core';
import fs from '../utils/fsUtils.js';
import { execSfdxJson, uxLog } from '../utils/index.js';
import { soqlQuery } from '../utils/apiUtils.js';
import { soqlString } from '../utils/metadataDepsUtils.js';
import { t } from '../utils/i18n.js';
import { parsePackageXmlFile } from '../utils/xmlUtils.js';
import { agentNameOfFile, BOT_USER_REGEX, DEFAULT_AGENT_USER_REGEX, readAgentRunningUsers, readBundleIndex } from '../utils/agentBundleUtils.js';
import { CONSTANTS } from '../../config/index.js';
import { MergedReplacementRule } from './utils/types.js';
import { ReplacementRulePrepareOptions, ReplacementRuleRoot, ReplacementTextOutcome } from './replacementRuleRoot.js';

// Salesforce usernames have at most 80 characters. "sf org create agent-user" adds a unique id
// before the @, and the domain is @<18 characters org id>.ext: the agent part keeps 30 of them
const MAX_AGENT_LOCAL_PART_LENGTH = 30;

export class AgentRunningUserBuiltInRule extends ReplacementRuleRoot {
  public readonly scope = 'text' as const;
  // Lowercase agent name -> lowercase username of git -> username of the target org. By agent: two
  // agents of git may run as the same user, and get a user each in the target org
  private readonly usernames = new Map<string, Map<string, string>>();
  private bundles = new Map<string, { agentName: string; isVersion: boolean }>();

  public async prepare(options: ReplacementRulePrepareOptions): Promise<void> {
    this.usernames.clear();
    if (!this.rule.enabled) {
      return;
    }
    // An error here never stops the other rules of the deployment: the agent files keep the usernames of git
    try {
      await this.prepareUsernames(options);
    } catch (e) {
      this.usernames.clear();
      uxLog('warning', options.commandThis, c.yellow(t('agentRunningUserCheckFailed', { message: (e as Error)?.message || String(e) })));
    }
  }

  public applyToText(content: string, _value: string | null, file?: string): ReplacementTextOutcome {
    const agentName = file ? agentNameOfFile(file, this.bundles) : null;
    const agentUsernames = agentName ? this.usernames.get(agentName.toLowerCase()) : undefined;
    let found = 0;
    let changed = 0;
    const replaceUser = (match: string, before: string, username: string, after: string) => {
      found++;
      const targetUsername = agentUsernames?.get(username.toLowerCase());
      if (!targetUsername || targetUsername === username) {
        return match;
      }
      changed++;
      return `${before}${targetUsername}${after}`;
    };
    const updated = content.replace(BOT_USER_REGEX, replaceUser).replace(DEFAULT_AGENT_USER_REGEX, replaceUser);
    if (found === 0) {
      return { content, found: 0, changed: 0, status: 'not-found' };
    }
    if (changed === 0) {
      return { content, found, changed: 0, status: 'unchanged' };
    }
    return { content: updated, found, changed, status: 'changed', detail: t('agentRunningUserReplaced', { count: changed }) };
  }

  // The user of the target org for each username of git, by agent
  private async prepareUsernames(options: ReplacementRulePrepareOptions): Promise<void> {
    // Read once, and only when the deployment holds an agent
    let bundles: Map<string, { agentName: string; isVersion: boolean }> | null = null;
    const getBundles = async () => (bundles ??= await readBundleIndex());
    const agents = await listAgentsWithRunningUser(options.packageXmlFiles, process.cwd(), getBundles);
    if (agents.length === 0) {
      return;
    }
    // A rule of the project writes the user for this target
    if (hasOwnRunningUserRule(options.rules || [], agents.flatMap((agent) => agent.usernames))) {
      uxLog('log', options.commandThis, c.grey(t('agentRunningUserOwnRule')));
      return;
    }
    const conn = await resolveConnection(options);
    if (!conn) {
      uxLog('log', options.commandThis, c.grey(t('agentRunningUserOrgUnreachable')));
      return;
    }
    this.bundles = await getBundles();
    for (const agent of agents) {
      const resolved = await resolveAgentRunningUser(conn, agent, false, options.commandThis);
      if (resolved.status === 'missing') {
        uxLog('warning', options.commandThis, c.yellow(t('agentRunningUserMissing', { agentName: agent.agentName, docUrl: `${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-agentforce-agents/` })));
        continue;
      }
      if (resolved.status !== 'found') {
        continue;
      }
      uxLog('action', options.commandThis, c.cyan(t('agentRunningUserUsed', { agentName: agent.agentName, username: resolved.username })));
      const agentUsernames = new Map<string, string>();
      for (const username of agent.usernames) {
        agentUsernames.set(username.toLowerCase(), resolved.username as string);
      }
      this.usernames.set(agent.agentName.toLowerCase(), agentUsernames);
    }
  }
}

/**
 * Agents of the deployment that run as a user, with every username their files hold. getBundles: the
 * authoring bundles of the project, read once by the caller that needs them too.
 */
export async function listAgentsWithRunningUser(
  packageXmlFiles?: string[],
  projectRoot: string = process.cwd(),
  getBundles: () => Promise<Map<string, { agentName: string; isVersion: boolean }>> = () => readBundleIndex(projectRoot)
): Promise<Array<{ agentName: string; usernames: string[] }>> {
  const deployed = await listDeployedAgentNames(packageXmlFiles, getBundles);
  // No agent in the package.xml files: the project files are not read
  if (deployed && deployed.size === 0) {
    return [];
  }
  const byAgent = new Map<string, { agentName: string; usernames: Set<string> }>();
  for (const entry of await readAgentRunningUsers(projectRoot, await getBundles())) {
    const key = entry.agentName.toLowerCase();
    if (deployed && !deployed.has(key)) {
      continue;
    }
    const agent = byAgent.get(key) || { agentName: entry.agentName, usernames: new Set<string>() };
    agent.usernames.add(entry.username);
    byAgent.set(key, agent);
  }
  return [...byAgent.values()].map((entry) => ({ agentName: entry.agentName, usernames: [...entry.usernames] }));
}

/**
 * True when one of the rules is a rule of the project, on, that writes the running user: it names botUser
 * or default_agent_user, or its find matches one of the usernames of the agents (a text rule that
 * replaces the username, or its domain).
 */
export function hasOwnRunningUserRule(rules: Array<Partial<MergedReplacementRule>>, usernames: string[] = []): boolean {
  return rules.some((rule) => {
    if (rule?.enabled === false || rule?.builtIn) {
      return false;
    }
    if (/botUser|default_agent_user/.test(`${rule?.xmlPath || ''} ${rule?.find || ''}`)) {
      return true;
    }
    return usernames.some((username) => ruleFindMatches(rule, username));
  });
}

/** Base username given to "sf org create agent-user", which adds a unique id before the @ */
export function buildAgentUserBaseUsername(agentName: string, orgId: string): string {
  let localPart = agentName.toLowerCase().replace(/[^a-z0-9.-]/g, '-');
  if (localPart.length > MAX_AGENT_LOCAL_PART_LENGTH) {
    // A hash of the whole name keeps two long names with the same start apart
    const hash = createHash('sha1').update(agentName.toLowerCase()).digest('hex').slice(0, 6);
    localPart = `${localPart.slice(0, MAX_AGENT_LOCAL_PART_LENGTH - hash.length - 1)}-${hash}`;
  }
  return `${localPart}@${orgId.toLowerCase()}.ext`;
}

/**
 * Running user of an agent in the org of the connection:
 * - git: every username of the files is a user of the org (the org it was retrieved from, or a sandbox copy of it);
 * - found: the agent user created for the agent at a previous deployment;
 * - created: none was there, and create is true (agent-running-user deployment action);
 * - missing: none was there, and create is false (the replacement rule);
 * - failed: the creation failed.
 */
export async function resolveAgentRunningUser(
  conn: any,
  agent: { agentName: string; usernames: string[] },
  create: boolean,
  commandThis: any
): Promise<{ status: 'git' | 'found' | 'created' | 'missing' | 'failed'; username: string | null; message?: string }> {
  const existingUsers = await findExistingUsers(conn, agent.usernames);
  if (agent.usernames.length > 0 && agent.usernames.every((username) => existingUsers.has(username.toLowerCase()))) {
    return { status: 'git', username: agent.usernames[0] };
  }
  const orgId = String(conn.getAuthInfoFields?.().orgId || (await conn.identity()).organization_id || '').toLowerCase();
  const found = await findAgentUser(conn, agent.agentName, orgId);
  if (found) {
    return { status: 'found', username: found };
  }
  if (!create) {
    return { status: 'missing', username: null };
  }
  return createAgentUser(agent.agentName, orgId, conn.getUsername(), commandThis);
}

// True when the find of a rule matches the text: a regex, or a plain text it contains, in any case
function ruleFindMatches(rule: Partial<MergedReplacementRule>, text: string): boolean {
  const find = String(rule?.find || '');
  if (!find) {
    return false;
  }
  if (rule?.regex) {
    try {
      return new RegExp(find, 'i').test(text);
    } catch {
      return false;
    }
  }
  return text.toLowerCase().includes(find.toLowerCase());
}

// Agents of the package.xml files (AiAgentDefinition, or the agent of an AiAgentDefinitionVersion or an
// AiAuthoringBundle). null: no package.xml, every agent of the project.
async function listDeployedAgentNames(
  packageXmlFiles: string[] | undefined,
  getBundles: () => Promise<Map<string, { agentName: string; isVersion: boolean }>>
): Promise<Set<string> | null> {
  if (!packageXmlFiles || packageXmlFiles.length === 0) {
    return null;
  }
  const names = new Set<string>();
  for (const packageXmlFile of packageXmlFiles) {
    if (!packageXmlFile || !fs.existsSync(packageXmlFile)) {
      continue;
    }
    const content = await parsePackageXmlFile(packageXmlFile);
    for (const member of content['AiAgentDefinition'] || []) {
      names.add(String(member).toLowerCase());
    }
    for (const member of content['AiAgentDefinitionVersion'] || []) {
      names.add(String(member).split('#')[0].toLowerCase());
    }
    for (const member of content['AiAuthoringBundle'] || []) {
      // The bundle of a version belongs to its agent, an agent may be named Support_Agent_2
      const name = String(member);
      names.add(((await getBundles()).get(name.toLowerCase())?.agentName || name).toLowerCase());
    }
  }
  // A wildcard deploys every agent of the project
  return names.has('*') ? null : names;
}

async function resolveConnection(options: ReplacementRulePrepareOptions): Promise<any | null> {
  try {
    if (options.conn) {
      return options.conn;
    }
    if (options.targetUsername) {
      return (await Org.create({ aliasOrUsername: options.targetUsername })).getConnection();
    }
  } catch {
    // Org not reachable: the files keep the usernames of git
  }
  return null;
}

async function findExistingUsers(conn: any, usernames: string[]): Promise<Set<string>> {
  const unique = [...new Set(usernames.map((username) => username.toLowerCase()))];
  if (unique.length === 0) {
    return new Set();
  }
  const result = await soqlQuery(`SELECT Username FROM User WHERE Username IN (${unique.map(soqlString).join(',')})`, conn);
  return new Set((result.records || []).map((record: any) => String(record.Username).toLowerCase()));
}

// The active agent user created by this rule for the agent at a previous deployment
async function findAgentUser(conn: any, agentName: string, orgId: string): Promise<string | null> {
  // The base username holds no "_" nor "%", the wildcards of LIKE. No filter on the profile: Salesforce
  // returns the name of a standard profile in the language of the user who runs the query
  const [localPart, domain] = buildAgentUserBaseUsername(agentName, orgId).split('@');
  const pattern = `${localPart}.%@${domain}`;
  const result = await soqlQuery(
    `SELECT Username FROM User WHERE Username LIKE ${soqlString(pattern)} AND IsActive = true ORDER BY CreatedDate ASC LIMIT 1`,
    conn
  );
  return result.records?.[0]?.Username || null;
}

async function createAgentUser(
  agentName: string,
  orgId: string,
  targetUsername: string,
  commandThis: any
): Promise<{ status: 'created' | 'failed'; username: string | null; message?: string }> {
  const command =
    'sf org create agent-user' +
    ` --base-username ${buildAgentUserBaseUsername(agentName, orgId)}` +
    ' --first-name Agent' +
    ` --last-name ${agentName}` +
    ` --target-org ${targetUsername}` +
    ' --json';
  uxLog('action', commandThis, c.cyan(t('agentRunningUserCreating', { agentName })));
  const res = await execSfdxJson(command, commandThis, { fail: false, output: false });
  const username = res?.result?.username || res?.result?.user?.username || res?.result?.Username || null;
  if (res?.status !== 0 || !username) {
    return { status: 'failed', username: null, message: res?.message || JSON.stringify(res?.result || {}) };
  }
  return { status: 'created', username };
}
