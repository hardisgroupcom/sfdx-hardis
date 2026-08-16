/**
 * Set a deeply-nested property on an object using dot notation.
 * Creates intermediate objects as needed.
 * When the target key already holds an object and the value is also an object, merges instead of overwriting.
 *
 * @example
 * const obj = {};
 * setDeepValue(obj, 'a.b.c', { x: 1 });
 * // obj => { a: { b: { c: { x: 1 } } } }
 */
export function setDeepValue(obj: any, dotPath: string, value: any): void {
  const keys = dotPath.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] == null || typeof current[keys[i]] !== 'object') {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }
  const lastKey = keys[keys.length - 1];
  if (current[lastKey] != null && typeof current[lastKey] === 'object' && typeof value === 'object') {
    Object.assign(current[lastKey], value);
  } else {
    current[lastKey] = value;
  }
}
