// IPv4 / IPv6 helpers for the trusted IP ranges of an org (Setup > Network Access).
// Addresses are compared as BigInt so both families share the same code.

export interface ParsedIp {
  version: 4 | 6;
  value: bigint;
}

const IPV4_BITS = 32;
const IPV6_BITS = 128;

// True when ip is between start and end (inclusive), all three of the same IP family
export function isIpInRange(ip: string, start: string, end: string): boolean {
  const parsedIp = parseIp(ip);
  const parsedStart = parseIp(start);
  const parsedEnd = parseIp(end);
  if (!parsedIp || !parsedStart || !parsedEnd) {
    return false;
  }
  if (parsedIp.version !== parsedStart.version || parsedIp.version !== parsedEnd.version) {
    return false;
  }
  return parsedIp.value >= parsedStart.value && parsedIp.value <= parsedEnd.value;
}

// True when the range holds more addresses than a /ipv4Prefix (IPv4) or a /ipv6Prefix (IPv6) network.
// Returns false for an invalid or mixed-family range.
export function isRangeWiderThan(start: string, end: string, ipv4Prefix: number, ipv6Prefix: number): boolean {
  const size = getRangeSize(start, end);
  const parsedStart = parseIp(start);
  if (size === null || !parsedStart) {
    return false;
  }
  const bits = parsedStart.version === 4 ? IPV4_BITS : IPV6_BITS;
  const prefix = parsedStart.version === 4 ? ipv4Prefix : ipv6Prefix;
  return size > 1n << BigInt(bits - prefix);
}

// Number of addresses of the range, or null when the range is invalid
export function getRangeSize(start: string, end: string): bigint | null {
  const parsedStart = parseIp(start);
  const parsedEnd = parseIp(end);
  if (!parsedStart || !parsedEnd || parsedStart.version !== parsedEnd.version || parsedEnd.value < parsedStart.value) {
    return null;
  }
  return parsedEnd.value - parsedStart.value + 1n;
}

export function parseIp(ip: string): ParsedIp | null {
  const value = (ip || '').trim();
  if (!value) {
    return null;
  }
  if (value.includes(':')) {
    const ipv6 = parseIpv6(value);
    return ipv6 === null ? null : { version: 6, value: ipv6 };
  }
  const ipv4 = parseIpv4(value);
  return ipv4 === null ? null : { version: 4, value: ipv4 };
}

function parseIpv4(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let result = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const byte = Number(part);
    if (byte > 255) {
      return null;
    }
    result = (result << 8n) + BigInt(byte);
  }
  return result;
}

function parseIpv6(ip: string): bigint | null {
  // Drop a zone index (fe80::1%eth0)
  let address = ip.split('%')[0];
  // An embedded IPv4 tail (::ffff:192.168.0.1) counts for two groups
  const lastColon = address.lastIndexOf(':');
  const tail = address.substring(lastColon + 1);
  if (tail.includes('.')) {
    const ipv4 = parseIpv4(tail);
    if (ipv4 === null) {
      return null;
    }
    address = `${address.substring(0, lastColon + 1)}${(ipv4 >> 16n).toString(16)}:${(ipv4 & 0xffffn).toString(16)}`;
  }
  const halves = address.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null;
  }
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      return null;
    }
    result = (result << 16n) + BigInt(parseInt(group, 16));
  }
  return result;
}
