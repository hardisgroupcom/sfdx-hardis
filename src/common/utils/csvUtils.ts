// CSV generation helpers, used to build report files (see generateReports in utils/index.ts)
export type CsvColumn = string | { key: string; header: string };

// Builds a CSV string from row objects.
// Columns can be plain keys ("Username") or { key, header } objects: the header row then
// shows the label while values are read from the key.
// Output format matches the historical csv-stringify behavior (see csvUtils.test.ts):
// quote only when needed, boolean true -> "1" / false -> "", null/undefined -> "",
// trailing newline after the last record.
export function stringifyCsv(
  rows: any[],
  options: { delimiter: string; columns?: CsvColumn[] }
): string {
  const columns: CsvColumn[] = options.columns ?? Object.keys(rows[0] ?? {});
  const keys = columns.map((col) => (typeof col === 'string' ? col : col.key));
  const headers = columns.map((col) => (typeof col === 'string' ? col : col.header));
  const lines = [buildCsvLine(headers, options.delimiter)];
  for (const row of rows) {
    const values = keys.map((key) => formatCsvValue(row?.[key]));
    lines.push(buildCsvLine(values, options.delimiter));
  }
  return lines.join('\n') + '\n';
}

function formatCsvValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '';
  }
  return String(value);
}

function buildCsvLine(values: string[], delimiter: string): string {
  return values
    .map((value) => {
      // Quote only when needed, to stay byte-compatible with the historical output
      if (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
        return '"' + value.replace(/"/g, '""') + '"';
      }
      return value;
    })
    .join(delimiter);
}
