export type TelemetryState =
  | "measured"
  | "derived"
  | "stale"
  | "unavailable"
  | "not_applicable";

export interface TelemetryValue<T> {
  value: T | null;
  state: TelemetryState;
  source: string;
  observedAt: string | null;
  staleAfterMs: number | null;
  reason?: string;
}

interface TelemetryOptions {
  observedAt?: string | null;
  staleAfterMs?: number | null;
  reason?: string;
}

function validObservedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function stateForObservation(observedAt: string | null, staleAfterMs: number | null): "measured" | "stale" {
  if (observedAt && staleAfterMs != null && Date.now() - Date.parse(observedAt) > staleAfterMs) return "stale";
  return "measured";
}

export function measured<T>(value: T, source: string, options: TelemetryOptions = {}): TelemetryValue<T> {
  const observedAt = validObservedAt(options.observedAt) ?? new Date().toISOString();
  const staleAfterMs = options.staleAfterMs ?? null;
  return {
    value,
    state: stateForObservation(observedAt, staleAfterMs),
    source,
    observedAt,
    staleAfterMs,
    ...(options.reason ? { reason: options.reason } : {}),
  };
}

export function derived<T>(value: T, source: string, options: TelemetryOptions = {}): TelemetryValue<T> {
  const observedAt = validObservedAt(options.observedAt) ?? new Date().toISOString();
  const staleAfterMs = options.staleAfterMs ?? null;
  const stale = stateForObservation(observedAt, staleAfterMs) === "stale";
  return {
    value,
    state: stale ? "stale" : "derived",
    source,
    observedAt,
    staleAfterMs,
    ...(options.reason ? { reason: options.reason } : {}),
  };
}

export function unavailable<T>(source: string, reason: string): TelemetryValue<T> {
  return { value: null, state: "unavailable", source, observedAt: null, staleAfterMs: null, reason };
}

export function notApplicable<T>(source: string, reason: string): TelemetryValue<T> {
  return { value: null, state: "not_applicable", source, observedAt: null, staleAfterMs: null, reason };
}

export function nonNegative(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}
