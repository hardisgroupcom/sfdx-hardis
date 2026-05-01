export function daysBetween(start: Date | null, end: Date | null): number {
  if (!start || !end) return 0;
  return (end.getTime() - start.getTime()) / 86400000;
}
