// Registrable-domain extraction, replacing the psl package for the simple
// grouping use case of hardis:project:audit:remotesites.

// Common multi-part public suffixes: when the hostname ends with one of these,
// the registrable domain is made of three labels instead of two.
// Not exhaustive like the Public Suffix List, but covers the common cases.
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au',
  'co.nz', 'org.nz', 'govt.nz',
  'co.jp', 'or.jp', 'ne.jp', 'go.jp', 'ac.jp',
  'com.br', 'org.br', 'gov.br', 'net.br',
  'com.mx', 'org.mx', 'gob.mx',
  'com.ar', 'org.ar', 'gob.ar',
  'co.in', 'org.in', 'gov.in', 'net.in',
  'co.za', 'org.za', 'gov.za',
  'com.sg', 'org.sg', 'gov.sg',
  'com.hk', 'org.hk', 'gov.hk',
  'com.cn', 'org.cn', 'gov.cn', 'net.cn',
  'com.tw', 'org.tw', 'gov.tw',
  'co.kr', 'or.kr', 'go.kr',
  'com.tr', 'org.tr', 'gov.tr',
  'co.il', 'org.il', 'gov.il',
  'com.my', 'org.my', 'gov.my',
  'co.id', 'or.id', 'go.id',
  'com.co', 'org.co', 'gov.co',
  'com.pe', 'org.pe', 'gob.pe',
  'com.ph', 'org.ph', 'gov.ph',
  'com.vn', 'org.vn', 'gov.vn',
]);

/**
 * Returns the registrable domain of a hostname (e.g. "docs.example.co.uk" -> "example.co.uk",
 * "api.example.com" -> "example.com"). IP addresses and single-label hosts are returned as-is.
 * Returns null for empty input.
 */
export function extractRegistrableDomain(hostname: string | null | undefined): string | null {
  if (!hostname) {
    return null;
  }
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  // IPv4 / IPv6 addresses have no registrable domain: return as-is
  if (/^[0-9.]+$/.test(normalized) || normalized.includes(':')) {
    return normalized;
  }
  const labels = normalized.split('.');
  if (labels.length <= 2) {
    return normalized;
  }
  const lastTwo = labels.slice(-2).join('.');
  const labelCount = MULTI_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-labelCount).join('.');
}
