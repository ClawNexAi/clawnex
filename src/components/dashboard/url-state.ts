// URL-as-state for the dashboard.
//
// All view state that we want to survive refresh / back-button / share-via-paste
// lives in `window.location.hash`. Format is flat key=value separated by `&`,
// matching standard URL query semantics but on the hash so we don't trigger
// Next.js routing and don't roundtrip the server on filter change.
//
// Reserved keys (consume / produce only via this module's UrlState shape):
//   tab        — TabId of the active panel
//   q          — freeform search text
//   severity   — CSV of severity values (CRITICAL,HIGH,...)
//   source     — CSV of source values
//   status     — CSV of status values
//   scope      — CSV of scope values (used by RiskAcceptances)
//   productionOnly — scalar "true" when a drilldown must keep demo/fixture rows out
//   actor      — CSV of actor values (used by Audit & Evidence)
//   id         — deep-link to a specific row (filters list to that row)
//   highlight  — pulse a specific row but do not filter
//
// New filter dimensions belong in the UrlState interface (and the keys list
// below) so unknown panels can ignore them safely.
//
// Spec: docs/superpowers/specs/2026-04-23-filtered-navigation-design.md §2

"use client";

import { useEffect, useState, useCallback } from "react";
import type { TabId } from "./types";

/**
 * Argument shape accepted by the dashboard `navigate(tab, focusOrOpts)` function.
 *
 * Used by every panel that calls `onNavigate`. Single source of truth so adding
 * a new opt (e.g. `fromMissionControl` introduced in v0.12.0) only changes one
 * place rather than 8+ inline duplicates.
 */
export type NavigateOpts =
  | string
  | {
      focus?: string;
      filter?: Partial<UrlState>;
      id?: string;
      highlight?: string;
      fromAlert?: string;
      focusAlertId?: string;
      /** v0.12.0+: marks this navigation as a Mission Control drill-down so the
       *  destination panel can render a "← Back to Mission Control" breadcrumb. */
      fromMissionControl?: boolean;
    };

export interface UrlState {
  tab?: TabId;
  q?: string;
  severity?: string[];
  source?: string[];
  status?: string[];
  scope?: string[];
  productionOnly?: string;
  actor?: string[];
  /** Evidence-level confidence (Trust Audit, Blast Radius). Reserved key
   *  added in v0.8.2 alongside the initial filter rollout so the URL param
   *  name matches the data semantics (instead of overloading `scope`). */
  confidence?: string[];
  /** v0.8.4+: numeric minimum threshold (e.g. Traffic Monitor shield score).
   *  Stored as a string in the URL because URLSearchParams is string-only;
   *  consumers `parseInt` when applying. Empty string / "0" = no minimum. */
  min?: string;
  /** v0.8.4+: numeric maximum threshold. Symmetry with `min`. Reserved for
   *  future Traffic Monitor / Models & Cost panels that want score-ranges. */
  max?: string;
  id?: string;
  highlight?: string;
  /** v0.13.0+: age-bucket filter for AlertsIncidentsPanel — values from
   *  the IncidentAging chart's bucket labels (Current / 1–4h / 4–24h /
   *  1–3d / 3d+). Supports multi-select. */
  age?: string[];
}

const CSV_KEYS = ["severity", "source", "status", "scope", "actor", "confidence", "age"] as const;
const SCALAR_KEYS = ["tab", "q", "id", "highlight", "min", "max", "productionOnly"] as const;
const ALL_KEYS = [...CSV_KEYS, ...SCALAR_KEYS] as const;

// ---------------------------------------------------------------------------
// Parse / serialize
// ---------------------------------------------------------------------------

export function readHashState(): UrlState {
  if (typeof window === "undefined") return {};
  const raw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (!raw) return {};
  const params = new URLSearchParams(raw);
  const out: UrlState = {};
  for (const key of SCALAR_KEYS) {
    const v = params.get(key);
    if (v !== null && v !== "") (out as Record<string, unknown>)[key] = v;
  }
  for (const key of CSV_KEYS) {
    const v = params.get(key);
    if (v !== null && v !== "") {
      const parts = v.split(",").map(s => s.trim()).filter(Boolean);
      if (parts.length > 0) (out as Record<string, unknown>)[key] = parts;
    }
  }
  return out;
}

function serialize(state: UrlState): string {
  const params = new URLSearchParams();
  for (const key of SCALAR_KEYS) {
    const v = (state as Record<string, unknown>)[key];
    if (typeof v === "string" && v.length > 0) params.set(key, v);
  }
  for (const key of CSV_KEYS) {
    const v = (state as Record<string, unknown>)[key];
    if (Array.isArray(v) && v.length > 0) params.set(key, v.join(","));
  }
  return params.toString();
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Update the URL hash. By default, merges patch into current state. With
 * { clearOthers: true }, replaces the entire state with the patch (used for
 * "clear all filters" and for sidebar tab clicks that should reset filters).
 */
export function writeHashState(patch: Partial<UrlState>, opts?: { clearOthers?: boolean }): void {
  if (typeof window === "undefined") return;
  const current = opts?.clearOthers ? {} : readHashState();
  const next: UrlState = { ...current };
  for (const key of ALL_KEYS) {
    if (key in patch) {
      const v = (patch as Record<string, unknown>)[key];
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
        delete (next as Record<string, unknown>)[key];
      } else {
        (next as Record<string, unknown>)[key] = v;
      }
    }
  }
  const serialized = serialize(next);
  const newHash = serialized ? `#${serialized}` : "";
  // Avoid no-op writes (and the resulting hashchange ping-pong)
  if (window.location.hash === newHash || (window.location.hash === "" && newHash === "")) return;
  // Use replaceState to avoid polluting history on every filter keystroke
  if (window.history.replaceState) {
    const url = window.location.pathname + window.location.search + newHash;
    window.history.replaceState(null, "", url);
    // replaceState doesn't fire hashchange — dispatch manually so subscribers update
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = newHash;
  }
}

/**
 * Push a new history entry instead of replacing — used for tab navigation
 * so the browser back-button moves between panels (not between filter
 * keystrokes within a panel).
 */
export function pushHashState(patch: Partial<UrlState>, opts?: { clearOthers?: boolean }): void {
  if (typeof window === "undefined") return;
  const current = opts?.clearOthers ? {} : readHashState();
  const next: UrlState = { ...current };
  for (const key of ALL_KEYS) {
    if (key in patch) {
      const v = (patch as Record<string, unknown>)[key];
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
        delete (next as Record<string, unknown>)[key];
      } else {
        (next as Record<string, unknown>)[key] = v;
      }
    }
  }
  const serialized = serialize(next);
  const newHash = serialized ? `#${serialized}` : "";
  if (window.location.hash === newHash) return;
  if (window.history.pushState) {
    const url = window.location.pathname + window.location.search + newHash;
    window.history.pushState(null, "", url);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = newHash;
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export function useHashState(): [UrlState, (patch: Partial<UrlState>, opts?: { clearOthers?: boolean }) => void] {
  const [state, setState] = useState<UrlState>(() => (typeof window === "undefined" ? {} : readHashState()));

  useEffect(() => {
    const handler = () => setState(readHashState());
    window.addEventListener("hashchange", handler);
    // Read once on mount in case URL changed between SSR and hydration
    setState(readHashState());
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  const update = useCallback((patch: Partial<UrlState>, opts?: { clearOthers?: boolean }) => {
    writeHashState(patch, opts);
  }, []);

  return [state, update];
}
