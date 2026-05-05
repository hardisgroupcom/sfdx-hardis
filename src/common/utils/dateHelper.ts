/**
 * DateHelper - Vanilla JS date utility class.
 * Replaces the 'moment' dependency for date formatting, parsing, and comparison.
 */
export class DateHelper {
  private date: Date;

  constructor(input?: string | Date | null) {
    if (input instanceof Date) {
      this.date = new Date(input.getTime());
    } else if (typeof input === "string") {
      this.date = new Date(input);
    } else {
      this.date = new Date();
    }
  }

  /** Create a DateHelper from a string with a specific format (supports common moment tokens). */
  static parse(value: string, formatStr: string): DateHelper {
    const tokens = extractTokens(formatStr);
    const parts: Record<string, number> = { YYYY: 1970, MM: 1, DD: 1, HH: 0, hh: 0, H: 0, h: 0, mm: 0, ss: 0, SSS: 0 };

    let pos = 0;
    for (const token of tokens) {
      if (token.literal) {
        pos += token.text.length;
        continue;
      }
      const len = token.text === "SSS" ? 3 : token.text.length <= 2 ? 2 : 4;
      const raw = value.substring(pos, pos + len).replace(/^0+/, "") || "0";
      parts[token.text] = parseInt(raw, 10);
      pos += len;
    }

    const d = new Date(parts.YYYY, (parts.MM || 1) - 1, parts.DD || 1, parts.HH || parts.hh || parts.H || parts.h || 0, parts.mm || 0, parts.ss || 0, parts.SSS || 0);
    return new DateHelper(d);
  }

  /** Return true if the underlying date is invalid. */
  isInvalid(): boolean {
    return isNaN(this.date.getTime());
  }

  /** Format the date using a moment-compatible format string. Without arguments, returns ISO 8601 string. */
  format(formatStr?: string): string {
    if (this.isInvalid()) {
      return "Invalid date";
    }
    // No format string: return ISO 8601 (same as moment().format())
    if (!formatStr) {
      return this.date.toISOString();
    }
    // Special: "ll" = localized short date like "Jan 1, 2024"
    if (formatStr === "ll") {
      return this.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }

    const d = this.date;
    const hours24 = d.getHours();
    const hours12 = hours24 % 12 || 12;

    const map: Record<string, string> = {
      YYYY: String(d.getFullYear()),
      YY: String(d.getFullYear()).slice(-2),
      MM: pad2(d.getMonth() + 1),
      M: String(d.getMonth() + 1),
      DD: pad2(d.getDate()),
      D: String(d.getDate()),
      HH: pad2(hours24),
      H: String(hours24),
      hh: pad2(hours12),
      h: String(hours12),
      mm: pad2(d.getMinutes()),
      m: String(d.getMinutes()),
      ss: pad2(d.getSeconds()),
      s: String(d.getSeconds()),
      SSS: pad3(d.getMilliseconds()),
    };

    const tokens = extractTokens(formatStr);
    return tokens.map((t) => (t.literal ? t.text : map[t.text] ?? t.text)).join("");
  }

  /** Return the underlying Date object. */
  toDate(): Date {
    return new Date(this.date.getTime());
  }

  /** Difference between this date and another, in the given unit. Result can be negative. */
  diff(other: DateHelper | Date | string, unit: "days" | "months" | "years" = "days"): number {
    const otherDate = other instanceof DateHelper ? other.date : new Date(other as any);
    const diffMs = this.date.getTime() - otherDate.getTime();
    if (unit === "days") {
      return Math.trunc(diffMs / 86400000);
    }
    if (unit === "months") {
      return (this.date.getFullYear() - otherDate.getFullYear()) * 12 + (this.date.getMonth() - otherDate.getMonth());
    }
    if (unit === "years") {
      return this.date.getFullYear() - otherDate.getFullYear();
    }
    return Math.trunc(diffMs / 86400000);
  }

  /** Returns true if this date is after the other date. When unit is specified, comparison is truncated to that unit. */
  isAfter(other: DateHelper, unit?: "day" | "month"): boolean {
    if (unit === "day") {
      return stripTime(this.date) > stripTime(other.date);
    }
    return this.date.getTime() > other.date.getTime();
  }

  /** Returns true if this date is before the other date. */
  isBefore(other: DateHelper, unit?: "day" | "month"): boolean {
    if (unit === "day") {
      return stripTime(this.date) < stripTime(other.date);
    }
    return this.date.getTime() < other.date.getTime();
  }

  /** Returns true if this date is the same as the other date. */
  isSame(other: DateHelper, unit?: "day" | "month"): boolean {
    if (unit === "day") {
      return stripTime(this.date) === stripTime(other.date);
    }
    return this.date.getTime() === other.date.getTime();
  }
}

/** Shorthand to create a DateHelper. */
export function dateHelper(input?: string | Date | null): DateHelper {
  return new DateHelper(input);
}

/** Format elapsed milliseconds as H:mm:ss.SSS */
export function formatElapsedMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms % 1000);
  return `${hours}:${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
}

// --- Internal helpers ---

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad3(n: number): string {
  if (n < 10) return `00${n}`;
  if (n < 100) return `0${n}`;
  return String(n);
}

function stripTime(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

interface Token {
  text: string;
  literal: boolean;
}

const FORMAT_TOKENS = /YYYY|YY|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|SSS/g;

function extractTokens(formatStr: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  FORMAT_TOKENS.lastIndex = 0;
  while ((match = FORMAT_TOKENS.exec(formatStr)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: formatStr.substring(lastIndex, match.index), literal: true });
    }
    tokens.push({ text: match[0], literal: false });
    lastIndex = FORMAT_TOKENS.lastIndex;
  }
  if (lastIndex < formatStr.length) {
    tokens.push({ text: formatStr.substring(lastIndex), literal: true });
  }
  return tokens;
}
