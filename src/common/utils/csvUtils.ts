// CSV generation helpers, used to build report files (see generateReports in utils/index.ts)
import { stringify as csvStringify } from 'csv-stringify/sync';

export type CsvColumn = string | { key: string; header: string };

// Builds a CSV string from row objects.
// Columns can be plain keys ("Username") or { key, header } objects: the header row then
// shows the label while values are read from the key.
export function stringifyCsv(
  rows: any[],
  options: { delimiter: string; columns?: CsvColumn[] }
): string {
  return csvStringify(rows, {
    delimiter: options.delimiter,
    header: true,
    columns: options.columns,
  });
}
