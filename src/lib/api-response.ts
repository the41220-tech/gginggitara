export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function relation(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  return Array.isArray(value) && isRecord(value[0]) ? value[0] : null;
}

export function apiMessage(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  if (typeof value.error === "string") return value.error;
  return isRecord(value.error) && typeof value.error.message === "string"
    ? value.error.message
    : fallback;
}
