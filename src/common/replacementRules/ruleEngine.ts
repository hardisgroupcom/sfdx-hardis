// Applies the replacement rules to the files of a deployment, or computes what they would change
// (preview). See ruleConfig.ts for the layers, builtInReplacementRules.ts for the built-in list.

import * as path from 'path';
import c from 'chalk';
import picomatch from 'picomatch';
import * as xmldom from '@xmldom/xmldom';
import { ConfigAggregator, Connection, Org, OrgConfigProperties } from '@salesforce/core';
import fs from '../utils/fsUtils.js';
import { uxLog } from '../utils/index.js';
import { t } from '../utils/i18n.js';
import { listMajorOrgs } from '../utils/orgConfigUtils.js';
import { buildActionTargetBranchCandidates, evaluateActionBranchFilter, normalizeBranchName } from '../utils/actionUtils.js';
import { getSfdxProjectPackageDirectories, PACKAGE_DIRECTORY_GLOB_IGNORE_PATTERNS } from '../utils/projectUtils.js';
import { registerSecretValue } from '../utils/secretMaskingUtils.js';
import { getSecretsProvider } from '../secretsProvider/index.js';
import { builtInRuleAppliesToApiVersion } from './builtInReplacementRules.js';
import { removeFlowEnds } from './flowEndsHandler.js';
import { ReplacementFileBackup, restoreLeftoverReplacementFiles } from './fileBackup.js';
import { readIssueRules } from './issueRulesStore.js';
import {
  mergeReplacementRules,
  readBranchReplacementRules,
  readProjectReplacementRules,
  ReplacementRulesSource,
  toFileList,
  validateReplacementRule,
} from './ruleConfig.js';
import {
  DEFAULT_VALUE_KEY,
  MergedReplacementRule,
  ReplacementFileResult,
  ReplacementRulesReport,
  ReplacementTarget,
  ReplacementWarning,
} from './types.js';
import { removeXmlNode, selectXmlPath } from './xmlPath.js';

export const SKIP_REPLACEMENT_RULES_ENV = 'SFDX_HARDIS_SKIP_REPLACEMENT_RULES';

export interface ApplyReplacementRulesOptions {
  // Major branch of the target org, or null for a dev sandbox / scratch org
  targetBranch: string | null;
  // Target org, to read its deployment API version
  conn?: Connection | null;
  targetUsername?: string | null;
  // Deployment API version given explicitly (preview --api-version)
  apiVersion?: number | null;
  // Package.xml files of the deployment: only their components are processed. None: every file
  // of the package directories (source push, preview)
  packageXmlFiles?: string[];
  // false: compute the results without writing anything
  write: boolean;
  // false: do not read the issue (list --skip-issue, unit tests)
  readIssue?: boolean;
  commandThis?: any;
}

export interface ReplacementRulesSession {
  report: ReplacementRulesReport;
  // Put the changed files back. Returns the number of restored files
  restore: () => number;
}

// What some built-in rules need to know about the target org, computed once per run
interface EngineContext {
  // mode org: the user permissions the org has; mode version: the ones its API version does not know
  userPermissions?: { mode: 'org' | 'version'; names: Set<string> } | null;
}

interface ResolvedRule {
  rule: MergedReplacementRule;
  value: string | null;
  matcher: (file: string) => boolean;
  matchedFiles: number;
  found: number;
}

/** Apply the rules of a deployment target (write: true), or preview them (write: false) */
export async function applyReplacementRules(options: ApplyReplacementRulesOptions): Promise<ReplacementRulesSession> {
  const commandThis = options.commandThis;
  // Only a deployment repairs the files of a killed run: a preview must never write, even while
  // another deployment of this folder is running
  if (options.write) {
    const recovered = restoreLeftoverReplacementFiles();
    if (recovered > 0) {
      uxLog('warning', commandThis, c.yellow(t('replacementRulesRecovered', { count: recovered })));
    }
  }
  const backup = new ReplacementFileBackup();
  const session: ReplacementRulesSession = {
    report: { target: { targetBranch: options.targetBranch, label: '', apiVersion: null }, results: [], warnings: [], appliedRules: [] },
    restore: () => {
      const count = backup.restore();
      if (count > 0) {
        uxLog('log', commandThis, c.grey(t('replacementRulesRestored', { count })));
      }
      return count;
    },
  };
  if (process.env[SKIP_REPLACEMENT_RULES_ENV] === 'true') {
    session.report.skipped = 'env';
    session.report.target = await resolveTarget(options.targetBranch, null);
    uxLog('warning', commandThis, c.yellow(t('replacementRulesSkippedByEnv', { variable: SKIP_REPLACEMENT_RULES_ENV })));
    return session;
  }

  // Target and rules
  const target = await resolveTarget(options.targetBranch, null);
  const { rules, warnings, issue } = await loadEffectiveRules(target.targetBranch, { readIssue: options.readIssue !== false });
  session.report.warnings.push(...warnings);
  session.report.issue = issue;
  const activeCustomRules = rules.filter((rule) => !rule.builtIn && rule.enabled);
  const builtInRules = rules.filter((rule) => rule.builtIn);
  const needsApiVersion = builtInRules.some((rule) => rule.enabled || rule.builtIn?.warnWhenDisabled);
  target.apiVersion = needsApiVersion ? await resolveDeployApiVersion(options) : options.apiVersion ?? null;
  session.report.target = target;
  if (needsApiVersion && target.apiVersion == null) {
    uxLog('log', commandThis, c.grey(t('replacementRulesApiVersionUnknown')));
  }

  // Rules that concern this target
  const majorBranchNames = (await listMajorOrgs()).map((majorOrg: any) => majorOrg.branchName);
  const candidates = buildActionTargetBranchCandidates(target.targetBranch || '', majorBranchNames);
  const resolved: ResolvedRule[] = [];
  const secretsProvider = activeCustomRules.some((rule) => rule.secret) ? await getSecretsProvider() : null;
  for (const rule of rules) {
    if (rule.builtIn) {
      if (!builtInRuleAppliesToApiVersion(rule.builtIn, target.apiVersion)) {
        continue;
      }
      if (!rule.enabled && !rule.builtIn.warnWhenDisabled) {
        continue;
      }
      resolved.push({ rule, value: null, matcher: buildMatcher(toFileList(rule.files)), matchedFiles: 0, found: 0 });
      continue;
    }
    if (!rule.enabled) {
      continue;
    }
    const verdict = evaluateActionBranchFilter(rule, candidates);
    if (!verdict.run) {
      continue;
    }
    let value: string | null = null;
    if (rule.type !== 'xml-remove') {
      if (rule.secret && secretsProvider) {
        const secret = await secretsProvider.getSecret(rule.secret, target.targetBranch);
        if (secret.value == null) {
          session.report.warnings.push({
            kind: 'secret-missing',
            ruleId: rule.id,
            message: t('replacementRulesSecretMissing', { id: rule.id, names: secret.lookedUp.join(', ') }),
          });
          continue;
        }
        registerSecretValue(secret.value);
        value = secret.value;
      } else {
        value = resolveRuleValue(rule, target.targetBranch);
        if (value == null) {
          uxLog('log', commandThis, c.grey(t('replacementRulesNoValue', { id: rule.id, target: target.label })));
          continue;
        }
      }
    }
    resolved.push({ rule, value, matcher: buildMatcher(toFileList(rule.files)), matchedFiles: 0, found: 0 });
  }
  if (resolved.length === 0) {
    session.report.skipped = 'no-rules';
    logWarnings(session.report.warnings, commandThis);
    return session;
  }

  uxLog('action', commandThis, c.cyan(t('replacementRulesApplying', { target: target.label })));
  const context: EngineContext = {};
  if (resolved.some((item) => item.rule.enabled && item.rule.builtIn?.handler === 'unknownUserPermissions')) {
    context.userPermissions = await resolveUserPermissionsCheck(options, target.apiVersion);
    if (context.userPermissions) {
      uxLog('log', commandThis, c.grey(t(context.userPermissions.mode === 'org' ? 'replacementRulesUserPermissionsFromOrg' : 'replacementRulesUserPermissionsFromList', { count: context.userPermissions.names.size, apiVersion: formatApiVersion(target.apiVersion) })));
    }
  }
  const files = await listCandidateFiles(options.packageXmlFiles, commandThis);
  for (const file of files) {
    const rulesOfFile = resolved.filter((item) => item.matcher(file));
    if (rulesOfFile.length === 0) {
      continue;
    }
    try {
      await processFile(file, rulesOfFile, target, session.report, options.write ? backup : null, context);
    } catch (e: any) {
      session.report.warnings.push({ kind: 'file-error', message: t('replacementRulesFileError', { file, message: e.message }) });
    }
  }

  // Summary
  for (const item of resolved) {
    if (item.rule.required && item.matchedFiles > 0 && item.found === 0) {
      session.report.warnings.push({ kind: 'required-no-match', ruleId: item.rule.id, message: t('replacementRulesRequiredNoMatch', { id: item.rule.id }) });
    }
    const changedFiles = new Set(session.report.results.filter((result) => result.ruleId === item.rule.id && result.status === 'changed').map((result) => result.file));
    if (changedFiles.size > 0) {
      session.report.appliedRules.push({ id: item.rule.id, origins: item.rule.origins, files: changedFiles.size });
    }
  }
  for (const result of session.report.results.filter((item) => item.status === 'changed')) {
    uxLog('log', commandThis, c.grey(`- ${result.file}: ${result.ruleId}${result.detail ? ` (${result.detail})` : ''}`));
  }
  logWarnings(session.report.warnings, commandThis);
  const changedFileCount = new Set(session.report.results.filter((item) => item.status === 'changed').map((item) => item.file)).size;
  uxLog(
    'success',
    commandThis,
    c.green(t(options.write ? 'replacementRulesApplied' : 'replacementRulesPreviewed', { count: session.report.appliedRules.length, files: changedFileCount }))
  );
  return session;
}

/**
 * Run a deployment with the rules applied to its files, then restore them. A failure of the rules
 * is a warning: the deployment goes on with the files of git.
 */
export async function runWithReplacementRules<T>(options: Omit<ApplyReplacementRulesOptions, 'write'>, deploy: () => Promise<T>): Promise<T> {
  let session: ReplacementRulesSession | null = null;
  try {
    session = await applyReplacementRules({ ...options, write: true });
  } catch (e: any) {
    uxLog('warning', options.commandThis, c.yellow(t('replacementRulesError', { message: e.message })));
  }
  try {
    return await deploy();
  } finally {
    session?.restore();
  }
}

/** Rules after the merge of the layers, invalid ones removed and reported */
export async function loadEffectiveRules(
  targetBranch: string | null,
  options: { readIssue: boolean }
): Promise<{ rules: MergedReplacementRule[]; warnings: ReplacementWarning[]; issue?: { number?: number; url?: string } }> {
  const sources: ReplacementRulesSource[] = [{ origin: 'project', rules: await readProjectReplacementRules() }];
  if (targetBranch) {
    sources.push({ origin: 'branch', branch: targetBranch, rules: readBranchReplacementRules(targetBranch) });
  }
  const warnings: ReplacementWarning[] = [];
  let issue: { number?: number; url?: string } | undefined;
  if (options.readIssue) {
    const issueState = await readIssueRules();
    if (issueState.error) {
      warnings.push({ kind: 'issue-unreadable', message: t('replacementRulesIssueUnreadable', { message: issueState.error }) });
    }
    if (issueState.number) {
      issue = { number: issueState.number, url: issueState.url };
    }
    sources.push({ origin: 'issue', rules: issueState.rules });
  }
  const merged = mergeReplacementRules(sources);
  warnings.push(...merged.warnings);
  const rules: MergedReplacementRule[] = [];
  for (const rule of merged.rules) {
    if (!rule.builtIn && rule.enabled) {
      const error = validateReplacementRule(rule);
      if (error) {
        warnings.push({ kind: 'invalid-rule', ruleId: rule.id, message: t('replacementRulesInvalidRule', { id: rule.id, reason: error }) });
        continue;
      }
    }
    rules.push(rule);
  }
  return { rules, warnings, issue };
}

/** The value of a rule for a target: its own value, the default, or the single value. Null: no value. */
export function resolveRuleValue(rule: Pick<MergedReplacementRule, 'value' | 'values'>, targetBranch: string | null): string | null {
  if (rule.values && Object.keys(rule.values).length > 0) {
    if (targetBranch) {
      const key = Object.keys(rule.values).find((candidate) => normalizeBranchName(candidate) === normalizeBranchName(targetBranch));
      if (key !== undefined) {
        return rule.values[key];
      }
    }
    return rule.values[DEFAULT_VALUE_KEY] ?? null;
  }
  return rule.value ?? null;
}

/** A major branch target, or null (dev sandbox, scratch org, branch without config file) */
export async function resolveTarget(targetBranch: string | null, apiVersion: number | null): Promise<ReplacementTarget> {
  if (targetBranch) {
    const majorOrgs = await listMajorOrgs();
    const majorOrg = majorOrgs.find((org: any) => normalizeBranchName(org.branchName) === normalizeBranchName(targetBranch));
    if (majorOrg) {
      return { targetBranch: majorOrg.branchName, label: majorOrg.branchName, apiVersion };
    }
  }
  return { targetBranch: null, label: t('replacementRulesDevSandboxTarget'), apiVersion };
}

/**
 * Deployment API version, the one Salesforce reads the metadata with: explicit (preview
 * --api-version), else the lowest of the connection version (SF_ORG_API_VERSION, org-api-version
 * config, or the max version of the target org), sourceApiVersion of sfdx-project.json and the
 * version of the package.xml files.
 */
export async function resolveDeployApiVersion(
  options: Pick<ApplyReplacementRulesOptions, 'apiVersion' | 'conn' | 'targetUsername' | 'packageXmlFiles'>
): Promise<number | null> {
  if (options.apiVersion) {
    return options.apiVersion;
  }
  const candidates: number[] = [];
  const connectionVersion = await resolveConnectionApiVersion(options);
  if (connectionVersion) {
    candidates.push(connectionVersion);
  }
  try {
    if (fs.existsSync('sfdx-project.json')) {
      const sourceApiVersion = parseApiVersion((await fs.readJson('sfdx-project.json'))?.sourceApiVersion);
      if (sourceApiVersion) {
        candidates.push(sourceApiVersion);
      }
    }
  } catch {
    // Unreadable project file: the other versions decide
  }
  for (const packageXmlFile of options.packageXmlFiles || []) {
    try {
      const match = /<version>\s*([\d.]+)\s*<\/version>/.exec(await fs.readFile(packageXmlFile, 'utf8'));
      const manifestVersion = parseApiVersion(match?.[1]);
      if (manifestVersion) {
        candidates.push(manifestVersion);
      }
    } catch {
      // Missing package.xml: the other versions decide
    }
  }
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

/**
 * The user permissions check of the target org: the Permissions<Name> fields of its PermissionSet
 * describe (what its API version, licenses and features allow), else the permissions its API
 * version does not know, from userPermissionsByApiVersion.ts. Null when neither is available.
 */
async function resolveUserPermissionsCheck(
  options: Pick<ApplyReplacementRulesOptions, 'conn' | 'targetUsername'>,
  apiVersion: number | null
): Promise<EngineContext['userPermissions']> {
  try {
    let conn: any = options.conn || null;
    if (!conn && options.targetUsername) {
      conn = (await Org.create({ aliasOrUsername: options.targetUsername })).getConnection();
    }
    if (conn) {
      const describe = await conn.sobject('PermissionSet').describe();
      const names = new Set<string>(
        (describe?.fields || [])
          .map((field: any) => String(field.name || ''))
          .filter((name: string) => name.startsWith('Permissions'))
          .map((name: string) => name.substring('Permissions'.length))
      );
      if (names.size > 0) {
        return { mode: 'org', names };
      }
    }
  } catch {
    // Org not reachable: the list by API version decides
  }
  if (apiVersion == null) {
    return null;
  }
  const { USER_PERMISSIONS_INTRODUCED_IN, USER_PERMISSIONS_REMOVED_IN } = await import('./userPermissionsByApiVersion.js');
  const unknown = new Set<string>();
  for (const [version, names] of Object.entries(USER_PERMISSIONS_INTRODUCED_IN)) {
    if (apiVersion < Number(version)) {
      names.forEach((name) => unknown.add(name));
    }
  }
  for (const [version, names] of Object.entries(USER_PERMISSIONS_REMOVED_IN)) {
    if (apiVersion >= Number(version)) {
      names.forEach((name) => unknown.add(name));
    }
  }
  return { mode: 'version', names: unknown };
}

// Removes the userPermissions entries the target org does not have. Returns the number removed
function removeUnknownUserPermissions(doc: any, xmlPaths: string[], check: EngineContext['userPermissions']): number {
  if (!check) {
    return 0;
  }
  let removed = 0;
  for (const xmlPath of xmlPaths) {
    for (const node of selectXmlPath(xmlPath, doc)) {
      let name = '';
      let child = node.firstChild;
      while (child) {
        if (child.nodeType === 1 && (child.localName || child.nodeName) === 'name') {
          name = (child.textContent || '').trim();
        }
        child = child.nextSibling;
      }
      if (!name) {
        continue;
      }
      const unknown = check.mode === 'org' ? !check.names.has(name) : check.names.has(name);
      if (unknown) {
        removeXmlNode(node);
        removed++;
      }
    }
  }
  return removed;
}

async function resolveConnectionApiVersion(options: Pick<ApplyReplacementRulesOptions, 'conn' | 'targetUsername'>): Promise<number | null> {
  const fromEnv = parseApiVersion(process.env.SF_ORG_API_VERSION);
  if (fromEnv) {
    return fromEnv;
  }
  try {
    const aggregator = await ConfigAggregator.create();
    const fromConfig = parseApiVersion(aggregator.getPropertyValue(OrgConfigProperties.ORG_API_VERSION) as string);
    if (fromConfig) {
      return fromConfig;
    }
  } catch {
    // No sf config: use the org
  }
  try {
    let conn = options.conn || null;
    if (!conn && options.targetUsername) {
      const org = await Org.create({ aliasOrUsername: options.targetUsername });
      conn = org.getConnection();
    }
    if (conn) {
      return parseApiVersion(await conn.retrieveMaxApiVersion());
    }
  } catch {
    // Unknown org version: the source versions decide
  }
  return null;
}

async function processFile(
  file: string,
  rulesOfFile: ResolvedRule[],
  target: ReplacementTarget,
  report: ReplacementRulesReport,
  backup: ReplacementFileBackup | null,
  context: EngineContext = {}
): Promise<void> {
  const original = await fs.readFile(file, 'utf8');
  let content = original;
  // Text rules work on the raw content, before the XML ones
  for (const item of rulesOfFile.filter((entry) => entry.rule.type === 'text')) {
    item.matchedFiles++;
    const { content: updated, count } = replaceText(content, item.rule, item.value as string);
    item.found += count;
    pushResult(report, file, item, updated !== content ? 'changed' : count > 0 ? 'unchanged' : 'not-found', count, count > 0 ? t('replacementRulesTextMatches', { count }) : undefined);
    content = updated;
  }
  const xmlRules = rulesOfFile.filter((entry) => entry.rule.type !== 'text');
  if (xmlRules.length > 0 && file.toLowerCase().endsWith('.xml')) {
    const doc = new xmldom.DOMParser().parseFromString(content, 'text/xml');
    let xmlChanged = false;
    for (const item of xmlRules) {
      item.matchedFiles++;
      const outcome = applyXmlRule(doc, item, target, context);
      item.found += outcome.found;
      xmlChanged = xmlChanged || outcome.changed > 0;
      pushResult(report, file, item, outcome.status, outcome.changed || outcome.found, outcome.detail);
    }
    if (xmlChanged) {
      content = serializeXml(doc, content);
    }
  }
  if (content !== original && backup) {
    await backup.backupFile(file);
    await fs.writeFile(file, content, 'utf8');
  }
}

function applyXmlRule(
  doc: any,
  item: ResolvedRule,
  target: ReplacementTarget,
  context: EngineContext = {}
): { found: number; changed: number; status: ReplacementFileResult['status']; detail?: string } {
  const rule = item.rule;
  if (rule.builtIn) {
    const builtIn = rule.builtIn;
    if (!rule.enabled) {
      // Disabled rule with warnWhenDisabled: report the element the deployment will fail on
      const found = builtIn.xmlPaths.reduce((total, xmlPath) => total + selectXmlPath(xmlPath, doc).length, 0);
      return found > 0
        ? { found, changed: 0, status: 'risky-element', detail: builtIn.xmlPaths.join(', ') }
        : { found: 0, changed: 0, status: 'not-found' };
    }
    let removed = 0;
    if (builtIn.handler === 'flowEnds') {
      removed = removeFlowEnds(doc);
    } else if (builtIn.handler === 'unknownUserPermissions') {
      removed = removeUnknownUserPermissions(doc, builtIn.xmlPaths, context.userPermissions || null);
    } else {
      for (const xmlPath of builtIn.xmlPaths) {
        for (const node of selectXmlPath(xmlPath, doc)) {
          removeXmlNode(node);
          removed++;
        }
      }
    }
    return removed > 0
      ? { found: removed, changed: removed, status: 'changed', detail: t('replacementRulesRemovedForApi', { count: removed, apiVersion: formatApiVersion(target.apiVersion) }) }
      : { found: 0, changed: 0, status: 'not-found' };
  }
  const nodes = selectXmlPath(rule.xmlPath as string, doc);
  if (nodes.length === 0) {
    return { found: 0, changed: 0, status: 'not-found' };
  }
  if (rule.type === 'xml-remove') {
    for (const node of nodes) {
      removeXmlNode(node);
    }
    return { found: nodes.length, changed: nodes.length, status: 'changed', detail: t('replacementRulesRemovedElements', { count: nodes.length }) };
  }
  let changed = 0;
  for (const node of nodes) {
    if ((node.textContent ?? '') !== item.value) {
      node.textContent = item.value;
      changed++;
    }
  }
  return { found: nodes.length, changed, status: changed > 0 ? 'changed' : 'unchanged' };
}

function replaceText(content: string, rule: MergedReplacementRule, value: string): { content: string; count: number } {
  const find = rule.find as string;
  if (rule.regex === true) {
    const regex = new RegExp(find, 'g');
    let count = 0;
    // A function replacement keeps "$" in the value literal (a secret can contain one)
    const updated = content.replace(regex, () => {
      count++;
      return value;
    });
    return { content: updated, count };
  }
  const parts = content.split(find);
  return { content: parts.join(value), count: parts.length - 1 };
}

function pushResult(
  report: ReplacementRulesReport,
  file: string,
  item: ResolvedRule,
  status: ReplacementFileResult['status'],
  count: number,
  detail?: string
): void {
  report.results.push({ file, ruleId: item.rule.id, origins: item.rule.origins, status, count, detail });
  if (status === 'risky-element' && item.rule.builtIn) {
    report.warnings.push({
      kind: 'risky-element',
      ruleId: item.rule.id,
      message: t('replacementRulesRiskyElement', {
        file,
        element: item.rule.builtIn.xmlPaths.join(', '),
        apiVersion: formatApiVersion(report.target.apiVersion),
        id: item.rule.id,
      }),
    });
  }
}

// XMLSerializer drops the XML declaration: it is put back as it was
function serializeXml(doc: any, originalContent: string): string {
  let serialized = new xmldom.XMLSerializer().serializeToString(doc);
  const declaration = /^\s*(<\?xml[^>]*\?>)/.exec(originalContent);
  if (declaration && !serialized.startsWith('<?xml')) {
    serialized = `${declaration[1]}\n${serialized}`;
  }
  if (originalContent.endsWith('\n') && !serialized.endsWith('\n')) {
    serialized += '\n';
  }
  return serialized;
}

/** Files of the deployment, relative to the current folder with "/" separators */
async function listCandidateFiles(packageXmlFiles: string[] | undefined, commandThis: any): Promise<string[]> {
  const packageDirectories = await getSfdxProjectPackageDirectories();
  if (packageXmlFiles && packageXmlFiles.length > 0) {
    try {
      const { ComponentSet } = await import('@salesforce/source-deploy-retrieve');
      const files = new Set<string>();
      const resolveSourcePaths = packageDirectories.map((directory) => directory.fullPath).filter((directory) => fs.existsSync(directory));
      for (const packageXmlFile of packageXmlFiles.filter((file) => fs.existsSync(file))) {
        const componentSet = await ComponentSet.fromManifest({ manifestPath: packageXmlFile, resolveSourcePaths, forceAddWildcards: true });
        for (const component of componentSet.getSourceComponents().toArray()) {
          collectComponentFiles(component, files);
        }
      }
      return [...files].map(toRelativePosix).sort();
    } catch (e: any) {
      uxLog('log', commandThis, c.grey(t('replacementRulesManifestFallback', { message: e.message })));
    }
  }
  const { glob } = await import('glob');
  const files: string[] = [];
  for (const directory of packageDirectories) {
    if (!fs.existsSync(directory.fullPath)) {
      continue;
    }
    const found = await glob('**/*', { cwd: directory.fullPath, nodir: true, dot: false, ignore: PACKAGE_DIRECTORY_GLOB_IGNORE_PATTERNS });
    files.push(...found.map((file) => toRelativePosix(path.join(directory.fullPath, file))));
  }
  return files.sort();
}

function collectComponentFiles(component: any, files: Set<string>): void {
  if (component.xml) {
    files.add(component.xml);
  }
  if (component.content) {
    try {
      for (const file of component.walkContent()) {
        files.add(file);
      }
    } catch {
      files.add(component.content);
    }
  }
  for (const child of component.getChildren?.() || []) {
    collectComponentFiles(child, files);
  }
}

function buildMatcher(globs: string[]): (file: string) => boolean {
  const matchers = globs.map((pattern) => picomatch(pattern.replace(/\\/g, '/').replace(/^\.\//, ''), { dot: true }));
  return (file: string) => matchers.some((matcher) => matcher(file));
}

function toRelativePosix(file: string): string {
  return path.relative(process.cwd(), path.resolve(file)).replace(/\\/g, '/');
}

function parseApiVersion(value: string | null | undefined): number | null {
  const parsed = parseFloat(String(value || ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatApiVersion(apiVersion: number | null): string {
  return apiVersion == null ? '?' : apiVersion.toFixed(1);
}

function logWarnings(warnings: ReplacementWarning[], commandThis: any): void {
  for (const warning of warnings) {
    uxLog('warning', commandThis, c.yellow(warning.message));
  }
}
