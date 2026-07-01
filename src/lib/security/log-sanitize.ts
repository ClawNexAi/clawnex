export function sanitizeLogField(value: unknown, maxLength = 240): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\b(?:sk|cnx|or|ghp|github_pat)[_-][A-Za-z0-9_=-]{12,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, "$1 [REDACTED]")
    .replace(/\b(api[_-]?key|token|password|secret)\b\s*[:=]\s*["']?[^"',\s}]{6,}/gi, "$1=[REDACTED]")
    .slice(0, maxLength);
}
