// API version helpers of replacement rules

/** 67 -> "67.0", null -> "?" */
export function formatApiVersion(apiVersion: number | null): string {
  return apiVersion == null ? '?' : apiVersion.toFixed(1);
}

/** "67.0" -> 67, anything else -> null */
export function parseApiVersion(value: string | null | undefined): number | null {
  const parsed = parseFloat(String(value || ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
