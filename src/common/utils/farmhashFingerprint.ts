/**
 * Pure TypeScript port of FarmHash Fingerprint32 (Google, MIT license).
 * Fingerprint32 is farmhashmk::Hash32 from https://github.com/google/farmhash/blob/master/src/farmhash.cc:
 * the platform-independent 32-bit hash, little-endian reads, no seed.
 *
 * Results are byte-identical with `farmhash.fingerprint32(str)` from the native `farmhash` npm package
 * that was previously used. They must stay identical because the values are persisted
 * (AI prompt cache keys, flow documentation node fingerprints).
 */

const c1 = 0xcc9e2d51;
const c2 = 0x1b873593;
const MAGIC = 0xe6546b64;

function rotate32(val: number, shift: number): number {
  return shift === 0 ? val >>> 0 : ((val >>> shift) | (val << (32 - shift))) >>> 0;
}

function fetch32(buf: Uint8Array, pos: number): number {
  return (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24)) >>> 0;
}

function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function mur(a: number, h: number): number {
  a = Math.imul(a, c1) >>> 0;
  a = rotate32(a, 17);
  a = Math.imul(a, c2) >>> 0;
  h = (h ^ a) >>> 0;
  h = rotate32(h, 19);
  return (Math.imul(h, 5) + MAGIC) >>> 0;
}

function hash32Len0to4(s: Uint8Array, len: number): number {
  let b = 0;
  let c = 9;
  for (let i = 0; i < len; i++) {
    // The C++ reference reads a signed char, so bytes >= 0x80 are sign-extended.
    const v = s[i] > 127 ? s[i] - 256 : s[i];
    b = (Math.imul(b, c1) + v) >>> 0;
    c = (c ^ b) >>> 0;
  }
  return fmix(mur(b, mur(len, c)));
}

function hash32Len5to12(s: Uint8Array, len: number): number {
  let a = len >>> 0;
  let b = (len * 5) >>> 0;
  let c = 9;
  const d = b;
  a = (a + fetch32(s, 0)) >>> 0;
  b = (b + fetch32(s, len - 4)) >>> 0;
  c = (c + fetch32(s, (len >>> 1) & 4)) >>> 0;
  return fmix(mur(c, mur(b, mur(a, d))));
}

function hash32Len13to24(s: Uint8Array, len: number): number {
  let a = fetch32(s, (len >>> 1) - 4);
  const b = fetch32(s, 4);
  const c = fetch32(s, len - 8);
  const d = fetch32(s, len >>> 1);
  const e = fetch32(s, 0);
  const f = fetch32(s, len - 4);
  let h = (Math.imul(d, c1) + len) >>> 0;
  a = (rotate32(a, 12) + f) >>> 0;
  h = (mur(c, h) + a) >>> 0;
  a = (rotate32(a, 3) + c) >>> 0;
  h = (mur(e, h) + a) >>> 0;
  a = (rotate32((a + f) >>> 0, 12) + d) >>> 0;
  h = (mur(b, h) + a) >>> 0;
  return fmix(h);
}

function hash32(s: Uint8Array): number {
  const len = s.length;
  if (len <= 24) {
    if (len <= 12) {
      return len <= 4 ? hash32Len0to4(s, len) : hash32Len5to12(s, len);
    }
    return hash32Len13to24(s, len);
  }

  // len > 24
  let h = len >>> 0;
  let g = Math.imul(c1, len) >>> 0;
  let f = g;
  const a0 = Math.imul(rotate32(Math.imul(fetch32(s, len - 4), c1) >>> 0, 17), c2) >>> 0;
  const a1 = Math.imul(rotate32(Math.imul(fetch32(s, len - 8), c1) >>> 0, 17), c2) >>> 0;
  const a2 = Math.imul(rotate32(Math.imul(fetch32(s, len - 16), c1) >>> 0, 17), c2) >>> 0;
  const a3 = Math.imul(rotate32(Math.imul(fetch32(s, len - 12), c1) >>> 0, 17), c2) >>> 0;
  const a4 = Math.imul(rotate32(Math.imul(fetch32(s, len - 20), c1) >>> 0, 17), c2) >>> 0;
  h = (h ^ a0) >>> 0;
  h = rotate32(h, 19);
  h = (Math.imul(h, 5) + MAGIC) >>> 0;
  h = (h ^ a2) >>> 0;
  h = rotate32(h, 19);
  h = (Math.imul(h, 5) + MAGIC) >>> 0;
  g = (g ^ a1) >>> 0;
  g = rotate32(g, 19);
  g = (Math.imul(g, 5) + MAGIC) >>> 0;
  g = (g ^ a3) >>> 0;
  g = rotate32(g, 19);
  g = (Math.imul(g, 5) + MAGIC) >>> 0;
  f = (f + a4) >>> 0;
  f = (rotate32(f, 19) + 113) >>> 0;
  let iters = Math.floor((len - 1) / 20);
  let pos = 0;
  do {
    const a = fetch32(s, pos);
    const b = fetch32(s, pos + 4);
    const c = fetch32(s, pos + 8);
    const d = fetch32(s, pos + 12);
    const e = fetch32(s, pos + 16);
    h = (h + a) >>> 0;
    g = (g + b) >>> 0;
    f = (f + c) >>> 0;
    h = (mur(d, h) + e) >>> 0;
    g = (mur(c, g) + a) >>> 0;
    f = (mur((b + Math.imul(e, c1)) >>> 0, f) + d) >>> 0;
    f = (f + g) >>> 0;
    g = (g + f) >>> 0;
    pos += 20;
  } while (--iters !== 0);
  g = Math.imul(rotate32(g, 11), c1) >>> 0;
  g = Math.imul(rotate32(g, 17), c1) >>> 0;
  f = Math.imul(rotate32(f, 11), c1) >>> 0;
  f = Math.imul(rotate32(f, 17), c1) >>> 0;
  h = rotate32((h + g) >>> 0, 19);
  h = (Math.imul(h, 5) + MAGIC) >>> 0;
  h = Math.imul(rotate32(h, 17), c1) >>> 0;
  h = rotate32((h + f) >>> 0, 19);
  h = (Math.imul(h, 5) + MAGIC) >>> 0;
  h = Math.imul(rotate32(h, 17), c1) >>> 0;
  return h >>> 0;
}

/**
 * FarmHash Fingerprint32 of the input. Strings are hashed as their UTF-8 bytes.
 * Returns an unsigned 32-bit integer, identical to the native farmhash.fingerprint32().
 */
export function fingerprint32(input: string | Uint8Array): number {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return hash32(bytes);
}
