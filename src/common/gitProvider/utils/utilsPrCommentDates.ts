/**
 * Dates as Pull Request comments write them for people: "Oct 7", or "Oct 7, 16:25 UTC".
 * The hidden data of the comments keeps the ISO dates.
 */
export function formatShortDate(isoDate: string, options: { withTime?: boolean } = {}): string {
  const date = new Date(isoDate || '');
  if (isNaN(date.getTime())) {
    return (isoDate || '').substring(0, 16).replace('T', ' ');
  }
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return options.withTime === true ? `${day}, ${date.toISOString().substring(11, 16)} UTC` : day;
}
