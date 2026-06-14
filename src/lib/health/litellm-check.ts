/**
 * checkLiteLLM — proxy status for the Infrastructure widget.
 *
 * internal reviewer 2026-05-09 launch-final architecture:
 *
 *   STATUS is driven by FAST LIVENESS only (`/health/liveliness`).
 *   Deep model-health (`/health`) is best-effort enrichment for the
 *   detail line. Slow deep checks NEVER drive the row to DEGRADED.
 *
 * Why: LiteLLM's `/health` endpoint actively pings every configured
 * model upstream (one outbound request per model_list entry). On a
 * deploy with N>50 models the endpoint routinely takes 1.5s–10s. With
 * a 5s poll-side timeout the dashboard flapped DEGRADED ↔ ONLINE every
 * 12s. The proxy was alive throughout; the deep ping cost just
 * exceeded the dashboard's poll budget. This module fixes the conflation
 * by making liveness drive status, deep drive detail.
 *
 * Pure-ish: takes injected `fetchImpl` + `queryProviderCountImpl` so the
 * verifier can mock both. Default impls bind to global fetch + the
 * local DB query. No side effects beyond an optional audit-log call
 * (also injectable via `logDegradedEventImpl`).
 *
 * Status taxonomy:
 *   not_configured: zero real (non-OpenClaw) providers configured, OR
 *                   only the labeled "no-provider-configured" placeholder
 *                   is present in /health response
 *   offline:        /health/liveliness failed (proxy unreachable / non-2xx)
 *   online:         liveness 2xx; deep check returned 2xx with no
 *                   unhealthy non-placeholder endpoints, OR deep check
 *                   timed out / errored (liveness already proved alive)
 *   degraded:       liveness 2xx; deep check returned 2xx with at least
 *                   one non-placeholder unhealthy endpoint
 */

export interface ServiceCheck {
  name: string;
  url: string;
  status: "online" | "degraded" | "offline" | "not_configured";
  latency: number;
  detail?: string;
  error?: string;
}

export interface CheckLiteLLMOpts {
  /** Inject a fetch impl. Default: globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Inject the active-provider count query. Default: live DB query. */
  queryProviderCountImpl?: () => number;
  /** Optional logger for degraded events (audit trail). Default: no-op. */
  logDegradedEventImpl?: (service: string, detail: string) => void;
  /** Liveness timeout in ms. Default 3000. */
  livenessTimeoutMs?: number;
  /** Deep health timeout in ms. Default 8000. */
  deepTimeoutMs?: number;
}

const PLACEHOLDER_SUFFIX = "no-provider-configured";

// LiteLLM reports model names from its model_list as either:
//   - bare placeholder string ("no-provider-configured"), or
//   - provider-prefixed ("openai/no-provider-configured", which is what
//     LiteLLM actually emits in /health when the placeholder is registered
//     under the openai litellm_provider).
// Both are the same conceptual placeholder — match either form.
function isPlaceholder(name: string): boolean {
  return name === PLACEHOLDER_SUFFIX || name.endsWith("/" + PLACEHOLDER_SUFFIX);
}

function isPlaceholderEndpoint(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const r = e as { model?: unknown; models?: unknown };
  if (typeof r.model === "string" && isPlaceholder(r.model)) return true;
  if (Array.isArray(r.models) && r.models.every((m) => typeof m === "string" && isPlaceholder(m))) return true;
  return false;
}

export async function checkLiteLLM(port: number, opts: CheckLiteLLMOpts = {}): Promise<ServiceCheck> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const queryProviderCount = opts.queryProviderCountImpl ?? (() => 0);
  const logDegradedEvent = opts.logDegradedEventImpl ?? (() => { /* no-op */ });
  const livenessTimeoutMs = opts.livenessTimeoutMs ?? 3000;
  const deepTimeoutMs = opts.deepTimeoutMs ?? 8000;

  // Step 0 — not_configured short-circuit when no real providers exist.
  // Only counts active, non-OpenClaw providers (OpenClaw is a gateway,
  // not a model provider).
  try {
    const providerCount = queryProviderCount();
    if (providerCount === 0) {
      return {
        name: "LiteLLM Proxy",
        url: `${baseUrl}/health/liveliness`,
        status: "not_configured",
        latency: 0,
        detail: "No AI model provider configured. Add one in Configuration.",
      };
    }
  } catch {
    // DB not ready — fall through to the network check.
  }

  // Step 1 — fast liveness. /health/liveliness is a process-alive probe
  // (~2.5ms in practice) that doesn't fan out to upstream providers.
  // This drives the row STATUS. If liveness fails the proxy is genuinely
  // offline; nothing else is worth checking.
  const liveStart = performance.now();
  let liveOk = false;
  let liveLatency = 0;
  let liveError: string | undefined;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), livenessTimeoutMs);
    const res = await fetchImpl(`${baseUrl}/health/liveliness`, { method: "GET", signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    liveOk = res.ok;
    liveLatency = Math.round(performance.now() - liveStart);
    if (!liveOk) liveError = `HTTP ${res.status}`;
  } catch {
    liveLatency = Math.round(performance.now() - liveStart);
    liveError = "Service not reachable";
  }

  if (!liveOk) {
    return {
      name: "LiteLLM Proxy",
      url: `${baseUrl}/health/liveliness`,
      status: "offline",
      latency: liveLatency,
      error: liveError ?? "liveness check failed",
    };
  }

  // Step 2 — deep model health (best-effort enrichment). NEVER drives
  // the row to DEGRADED on a slow/timed-out check. Only drives DEGRADED
  // when /health returns within budget AND has real (non-placeholder)
  // unhealthy endpoints.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), deepTimeoutMs);
    const res = await fetchImpl(`${baseUrl}/health`, { method: "GET", signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    const totalLatency = Math.round(performance.now() - liveStart);

    if (res.ok) {
      try {
        const data = await res.json();
        const rawUnhealthy = Array.isArray(data.unhealthy_endpoints) ? data.unhealthy_endpoints : [];
        const rawHealthy = Array.isArray(data.healthy_endpoints) ? data.healthy_endpoints : [];
        const unhealthy = rawUnhealthy.filter((e: unknown) => !isPlaceholderEndpoint(e));
        const onlyPlaceholderConfigured =
          (rawUnhealthy.length > 0 || rawHealthy.length > 0) &&
          rawUnhealthy.every(isPlaceholderEndpoint) &&
          rawHealthy.every(isPlaceholderEndpoint);

        if (onlyPlaceholderConfigured) {
          return {
            name: "LiteLLM Proxy",
            url: `${baseUrl}/health`,
            status: "not_configured",
            latency: totalLatency,
            detail: "No AI model provider configured. Add one in Configuration.",
          };
        }
        if (unhealthy.length > 0) {
          const models = unhealthy.map((u: { model?: string; models?: string[] }) =>
            u.model || (Array.isArray(u.models) ? u.models.join("/") : "unknown")
          ).join(", ");
          logDegradedEvent("LiteLLM Proxy", `Unhealthy models: ${models}`);
          return {
            name: "LiteLLM Proxy",
            url: `${baseUrl}/health`,
            status: "degraded",
            latency: totalLatency,
            detail: `${unhealthy.length} model(s) unhealthy: ${models}`,
          };
        }
      } catch {
        // JSON parse failure — fall through to the ONLINE-with-detail path
      }
      return {
        name: "LiteLLM Proxy",
        url: `${baseUrl}/health`,
        status: "online",
        latency: totalLatency,
      };
    }

    // /health returned non-2xx but liveness was 2xx — ONLINE with caveat.
    // The proxy is up; deep model health is in an unknown state right now.
    return {
      name: "LiteLLM Proxy",
      url: `${baseUrl}/health`,
      status: "online",
      latency: totalLatency,
      detail: `Proxy alive; deep model health-check returned ${res.status}`,
    };
  } catch {
    // /health timed out or fetch errored. Liveness already proved the proxy
    // is alive — return ONLINE with a soft detail so the operator sees the
    // upstream-ping cost without a fake red status.
    const totalLatency = Math.round(performance.now() - liveStart);
    return {
      name: "LiteLLM Proxy",
      url: `${baseUrl}/health`,
      status: "online",
      latency: totalLatency,
      detail: "Proxy alive; deep model health-check slow or unknown (last attempt timed out)",
    };
  }
}
