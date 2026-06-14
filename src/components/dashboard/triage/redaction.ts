const FORBIDDEN_RAW_KEY_PATTERNS = [
  /payload[_-]?excerpt/i,
  /matched[_-]?snippets?/i,
  /snippet[_-]?(before|match|after)/i,
  /request[_-]?body/i,
  /response[_-]?body/i,
  /authorization/i,
  /api[_-]?key/i,
  /password/i,
  /secret/i,
  /connection[_-]?string/i,
  /token/i,
];

export function isSafeTriageFieldName(fieldName: string): boolean {
  return !FORBIDDEN_RAW_KEY_PATTERNS.some((pattern) => pattern.test(fieldName));
}

export function safeTriageValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function redactedTriageMarker(reason = "raw evidence available in source panel"): string {
  return `[REDACTED: ${reason}]`;
}
