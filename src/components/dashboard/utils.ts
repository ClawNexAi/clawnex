import { C } from './constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Filter state used by the dashboard to scope queries. */
export interface DashboardFilters {
  timeRange: string;
  since: string;
  selectedInstance: string;
  selectedClient: string;
  selectedSeverity: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maps human-readable time-range labels to their duration in milliseconds. */
export const TIME_RANGE_MS: Record<string, number> = {
  "1h": 3600000,
  "6h": 21600000,
  "24h": 86400000,
  "7d": 604800000,
  "30d": 2592000000,
};

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Returns an ISO timestamp representing the start of the given time range
 * relative to the current moment.
 *
 * @param range - A key from {@link TIME_RANGE_MS} (e.g. `"24h"`). Falls back
 *   to 24 h if the key is unrecognised.
 */
export function getTimeSince(range: string): string {
  return new Date(Date.now() - (TIME_RANGE_MS[range] || 86400000)).toISOString();
}

/**
 * Serialises dashboard filters into a URL query string suitable for API calls.
 *
 * @param filters - Current dashboard filter state.
 * @param extra   - Optional additional key/value pairs to append.
 * @returns A URL-encoded query string (without leading `?`).
 */
export function buildFilterQuery(filters: DashboardFilters, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  params.set("since", filters.since);
  if (filters.selectedSeverity !== "all") params.set("severity", filters.selectedSeverity);
  if (filters.selectedInstance !== "all") params.set("instance", filters.selectedInstance);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v);
    }
  }
  return params.toString();
}

/**
 * Formats a duration given in seconds into a compact human-readable string
 * such as `"3d 2h 15m"`.
 *
 * @param seconds - Total uptime in seconds.
 */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Maps a severity level string to its corresponding colour hex value.
 *
 * @param sev - Severity label (case-insensitive), e.g. `"CRITICAL"`, `"HIGH"`.
 * @returns A hex colour string from the theme palette.
 */
export function sevColor(sev: string): string {
  switch (sev.toUpperCase()) {
    case "CRITICAL": return C.danger;
    case "HIGH": return C.orange;
    case "MEDIUM": return C.warn;
    case "LOW": return C.info;
    case "DANGER": return C.danger;
    case "ELEVATED": return C.warn;
    case "WARN": return C.orange;
    default: return C.txS;
  }
}

/**
 * Maps a status string to its corresponding colour hex value.
 *
 * @param st - Status label (case-insensitive), e.g. `"online"`, `"degraded"`.
 * @returns A hex colour string from the theme palette.
 */
export function stColor(st: string): string {
  switch (st.toLowerCase()) {
    case "online": case "healthy": case "ok": case "allow": case "active": case "pass": case "completed": return C.green;
    case "degraded": case "review": case "warning": case "watching": case "idle": case "pending": case "restricted": case "elevated": return C.orange;
    case "offline": case "critical": case "block": case "error": case "overdue": case "danger": case "runaway": case "fail": return C.danger;
    case "not_configured": return C.info;
    case "acknowledged": case "investigating": return C.cyan;
    case "resolved": return C.txT;
    default: return C.txS;
  }
}

/**
 * Converts an ISO 8601 timestamp (or pre-formatted relative string) into a
 * compact relative time description such as `"5m ago"` or `"2d ago"`.
 *
 * Returns the input unchanged if it already looks like a relative string,
 * and `"--"` for falsy input.
 *
 * @param isoOrTime - An ISO date string or an already-formatted relative time.
 */
export function timeAgo(isoOrTime: string): string {
  if (!isoOrTime) return "--";
  if (isoOrTime.includes("ago") || isoOrTime.includes("m ") || isoOrTime.includes("h ")) return isoOrTime;
  try {
    const diff = Date.now() - new Date(isoOrTime).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch { return isoOrTime; }
}
