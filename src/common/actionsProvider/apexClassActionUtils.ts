// Helpers shared by the actions that instantiate an Apex class of the target org (schedule-batch, run-batch)

// What the Tooling API returns as the body of a managed class that is not global
export const HIDDEN_APEX_BODY = '(hidden)';

/** Splits `ns.ClassName` into its namespace and its name. A class of the project has no namespace. */
export function parseApexClassName(className: string): { namespace: string; name: string } {
  const trimmed = className.trim();
  const dot = trimmed.indexOf('.');
  return dot > 0
    ? { namespace: trimmed.slice(0, dot), name: trimmed.slice(dot + 1) }
    : { namespace: '', name: trimmed };
}

/** Tooling query listing the classes of the org bearing that name, in that namespace when there is one. */
export function buildApexClassQuery(classBareName: string, namespace: string): string {
  const namespaceFilter = namespace ? ` AND NamespacePrefix = '${namespace.replace(/'/g, "\\'")}'` : '';
  return `SELECT Id, Name, NamespacePrefix, ManageableState, Body FROM ApexClass WHERE Name = '${classBareName.replace(/'/g, "\\'")}'${namespaceFilter}`;
}

/**
 * Picks the class to schedule among the classes of the org bearing that name.
 * With a namespace, the class of that package. Without one, a class of the org itself,
 * or of a package without namespace: a namespaced package class is never picked by its bare name.
 */
export function pickApexClassToSchedule(records: any[], namespace: string): any | null {
  if (namespace) {
    return records.find((r) => (r.NamespacePrefix || '').toLowerCase() === namespace.toLowerCase()) || null;
  }
  return records.find((r) => r.ManageableState === 'unmanaged') || records.find((r) => !r.NamespacePrefix) || null;
}

/**
 * True when anonymous Apex cannot write `new ClassName()`: the no-arg constructor is private or
 * protected, or the class only declares constructors with parameters.
 */
export function hasNoVisibleNoArgConstructor(body: string, classBareName: string): boolean {
  const classNamePattern = classBareName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const noArgCtorPattern = new RegExp(`(private|protected)\\s+${classNamePattern}\\s*\\(\\s*\\)`, 'i');
  const paramCtorPattern = new RegExp(`(public|private|protected|global)\\s+${classNamePattern}\\s*\\([^)]+\\)`, 'i');
  const hasExplicitNoArgCtor = new RegExp(`(public|global)\\s+${classNamePattern}\\s*\\(\\s*\\)`, 'i').test(body);
  return noArgCtorPattern.test(body) || (paramCtorPattern.test(body) && !hasExplicitNoArgCtor);
}
