// Built-in rule builtin-unknown-user-permissions: removes each userPermissions entry of a Profile or
// a Permission Set that the target org does not have. The list comes from the Permissions<Name>
// fields of the PermissionSet describe of the org (what its API version, licenses and features
// allow), else from the permissions its API version does not know (builtIn/userPermissionsByApiVersion.ts).

import c from 'chalk';
import { Org } from '@salesforce/core';
import { uxLog } from '../utils/index.js';
import { t } from '../utils/i18n.js';
import { BuiltInRemovalRule } from './builtInRemovalRule.js';
import { ReplacementRulePrepareOptions } from './replacementRuleRoot.js';
import { formatApiVersion } from './utils/apiVersionUtils.js';
import { childElementText, removeXmlNode, selectXmlPath } from './utils/xmlPath.js';

interface UserPermissionsCheck {
  // org: the user permissions the org has. version: the ones its API version does not know
  mode: 'org' | 'version';
  names: Set<string>;
}

export class UnknownUserPermissionsBuiltInRule extends BuiltInRemovalRule {
  private check: UserPermissionsCheck | null = null;

  public async prepare(options: ReplacementRulePrepareOptions): Promise<void> {
    if (!this.rule.enabled) {
      return;
    }
    this.check = await this.resolveCheck(options);
    if (this.check) {
      uxLog(
        'log',
        options.commandThis,
        c.grey(
          t(this.check.mode === 'org' ? 'replacementRulesUserPermissionsFromOrg' : 'replacementRulesUserPermissionsFromList', {
            count: this.check.names.size,
            apiVersion: formatApiVersion(options.target.apiVersion),
          })
        )
      );
    }
  }

  protected removeElements(doc: any): number {
    if (!this.check) {
      return 0;
    }
    let removed = 0;
    for (const xmlPath of this.builtIn.xmlPaths) {
      for (const node of selectXmlPath(xmlPath, doc)) {
        const name = childElementText(node, 'name');
        if (!name) {
          continue;
        }
        const unknown = this.check.mode === 'org' ? !this.check.names.has(name) : this.check.names.has(name);
        if (unknown) {
          removeXmlNode(node);
          removed++;
        }
      }
    }
    return removed;
  }

  private async resolveCheck(options: ReplacementRulePrepareOptions): Promise<UserPermissionsCheck | null> {
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
    const apiVersion = options.target.apiVersion;
    if (apiVersion == null) {
      return null;
    }
    const { USER_PERMISSIONS_INTRODUCED_IN, USER_PERMISSIONS_REMOVED_IN } = await import('./builtIn/userPermissionsByApiVersion.js');
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
}
