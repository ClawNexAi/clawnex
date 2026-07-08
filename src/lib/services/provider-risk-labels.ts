import { queryAll, queryOne } from "@/lib/db/index";
import type { ConfigModel, ConfigProvider } from "@/lib/services/config-service";

export interface RiskLabel {
  id: string;
  label: string;
  tone: "good" | "warn" | "danger" | "info" | "neutral";
  reason: string;
}

interface RouteRow {
  provider_id: string;
  current_route: "routed" | "direct" | "unknown" | "unsupported";
  capability: string;
}

function isLocalUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url.replace(/^ws:/, "http:").replace(/^wss:/, "https:")).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function add(labels: RiskLabel[], label: RiskLabel): void {
  if (!labels.some((existing) => existing.id === label.id)) labels.push(label);
}

export function providerRiskLabels(provider: Pick<ConfigProvider, "id" | "type" | "base_url">): RiskLabel[] {
  const labels: RiskLabel[] = [];
  const local = isLocalUrl(provider.base_url) || provider.type === "lmstudio";
  add(labels, local
    ? { id: "local", label: "local", tone: "good", reason: "Provider endpoint is local/loopback." }
    : { id: "cloud", label: "cloud", tone: "info", reason: "Provider endpoint is remote/cloud-hosted." });

  const routeRows = queryAll<RouteRow>(
    `SELECT provider_id, current_route, capability FROM connector_routing_items
     WHERE provider_id = ? AND present = 1`,
    [provider.id],
  );
  if (routeRows.some((row) => row.current_route === "routed")) {
    add(labels, { id: "routed", label: "routed", tone: "good", reason: "Traffic is routed through the ClawNex LiteLLM shield path." });
  } else if (routeRows.some((row) => row.current_route === "direct")) {
    add(labels, { id: "direct", label: "direct", tone: "warn", reason: "Observed connector path talks directly to the provider." });
    add(labels, { id: "unscanned", label: "unscanned", tone: "danger", reason: "Direct traffic may bypass real-time Shield inspection." });
  }

  if (["claude-ai", "chatgpt", "gemini", "oauth"].some((needle) => provider.type.toLowerCase().includes(needle))) {
    add(labels, { id: "oauth-bound", label: "OAuth-bound", tone: "warn", reason: "OAuth/session-bound providers are often read-only or watcher-observed." });
  }

  return labels;
}

export function modelRiskLabels(model: ConfigModel & { provider_type?: string; provider_name?: string }): RiskLabel[] {
  const labels: RiskLabel[] = [];
  const provider = queryOne<ConfigProvider>("SELECT * FROM config_providers WHERE id = ?", [model.provider_id]);
  if (provider) labels.push(...providerRiskLabels(provider));

  if (model.context_window >= 128000) {
    add(labels, { id: "large-context", label: "large-context", tone: "warn", reason: "Large context windows increase prompt-injection and data-exposure blast radius." });
  }
  if (model.supports_reasoning || model.supports_vision) {
    add(labels, { id: "tool-capable", label: "tool-capable", tone: "warn", reason: "Model metadata indicates advanced capability; review tool exposure." });
  }

  const price = queryOne<{ input_per_token: number; output_per_token: number }>(
    "SELECT input_per_token, output_per_token FROM model_prices WHERE model_id = ?",
    [model.model_id],
  );
  const outputPerMillion = (price?.output_per_token || 0) * 1_000_000;
  if (outputPerMillion >= 15) {
    add(labels, { id: "high-cost", label: "high-cost", tone: "warn", reason: "Output pricing is high enough for denial-of-wallet monitoring." });
  }

  return labels;
}

