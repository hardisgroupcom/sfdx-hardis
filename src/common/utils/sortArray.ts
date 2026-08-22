// In-place multi-key sort of an array of objects. Replaces the `sort-array` package
// for the subset of options used in sfdx-hardis (`by`, `order` and `customOrders`).
export interface SortArrayOptions {
  /** One or more property names to sort by. */
  by?: string | string[];
  /** One sort order per `by` entry: 'asc' (default), 'desc', or the name of a custom order.
   * A single string applies to every key. */
  order?: string | string[];
  /** Named value lists: values are ranked by their position in the list, unknown values go last. */
  customOrders?: Record<string, unknown[]>;
}

type KeyComparator = (a: unknown, b: unknown) => number;

function buildComparator(order: string | undefined, customOrders: Record<string, unknown[]>): KeyComparator {
  if (order && order !== 'asc' && order !== 'desc' && Array.isArray(customOrders[order])) {
    const ranking = customOrders[order];
    return (a, b) => {
      const rankA = ranking.indexOf(a);
      const rankB = ranking.indexOf(b);
      const normalizedA = rankA === -1 ? ranking.length : rankA;
      const normalizedB = rankB === -1 ? ranking.length : rankB;
      return normalizedA - normalizedB;
    };
  }
  const direction = order === 'desc' ? -1 : 1;
  return (a, b) => compareValues(a, b) * direction;
}

function isMissing(value: unknown): boolean {
  return value === null || value === undefined;
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) {
    return 0;
  }
  // Same semantics as sort-array: plain JavaScript relational comparison
  return (a as any) < (b as any) ? -1 : (a as any) > (b as any) ? 1 : 0;
}

/** Sorts `array` in place by the given keys and returns it. */
export function sortArray<T>(array: T[], options: SortArrayOptions = {}): T[] {
  const keys = options.by === undefined ? [] : Array.isArray(options.by) ? options.by : [options.by];
  if (keys.length === 0) {
    return array;
  }
  const orders = options.order === undefined ? [] : Array.isArray(options.order) ? options.order : [options.order];
  const comparators = keys.map((_key, index) => {
    const order = orders.length === 1 ? orders[0] : orders[index];
    return buildComparator(order, options.customOrders || {});
  });
  array.sort((left, right) => {
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      const leftValue = (left as any)?.[key];
      const rightValue = (right as any)?.[key];
      const leftMissing = isMissing(leftValue);
      const rightMissing = isMissing(rightValue);
      // null and undefined always sort last, whatever the order
      if (leftMissing && rightMissing) {
        continue;
      }
      if (leftMissing) {
        return 1;
      }
      if (rightMissing) {
        return -1;
      }
      const result = comparators[index](leftValue, rightValue);
      if (result !== 0) {
        return result;
      }
    }
    return 0;
  });
  return array;
}

export default sortArray;
