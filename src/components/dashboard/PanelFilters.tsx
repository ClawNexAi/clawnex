// PanelFilters — shared filter widget for every event-list panel.
//
// Config-driven: each panel passes which filter dimensions are relevant
// (severity, source, status, scope, actor, freeform search). Renders a
// horizontal row above the data: search input + multi-select dropdowns +
// clear-all button + "X of Y results" counter.
//
// Filter values come from the URL hash via useHashState — this widget never
// owns state. Calling onChange writes back to URL; the parent panel re-derives
// its filtered list from the new URL state on the next render.
//
// Spec: docs/superpowers/specs/2026-04-23-filtered-navigation-design.md §2 Layer B

"use client";

import { useState, useRef, useEffect } from "react";
import { C, F } from "./constants";
import type { UrlState } from "./url-state";

/**
 * Which filter dimensions this panel cares about. Only the keys that appear
 * in `config` are rendered; the rest are ignored. Each multi-select
 * dimension supplies its own option list.
 */
export interface PanelFiltersConfig {
  /** Render the freeform search input. Optional placeholder text override. */
  search?: { placeholder?: string };
  /** Severity options (typically CRITICAL/HIGH/MEDIUM/LOW/INFO). */
  severity?: string[];
  /** Source options — usually computed dynamically from current data. */
  source?: string[];
  /** Status options. */
  status?: string[];
  /** Scope options (used by RiskAcceptances source_panel). */
  scope?: string[];
  /** Actor options (used by Audit & Evidence). */
  actor?: string[];
  /** Confidence options (used by Trust Audit + Blast Radius). */
  confidence?: string[];
  /** v0.8.4+: numeric "minimum" threshold dimension (used by Traffic Monitor
   *  shield score). Renders as a labeled <select> with operator-friendly
   *  preset values. Each option is a {value, label} pair so the displayed
   *  text can read "Score ≥ 50" instead of just "50". */
  min?: { label: string; options: Array<{ value: string; label: string }> };
}

export interface PanelFiltersProps {
  config: PanelFiltersConfig;
  /** Current URL state (provides current filter values). */
  values: UrlState;
  /** Called with a partial UrlState to merge — typically wired to writeHashState. */
  onChange: (patch: Partial<UrlState>) => void;
  /** Number of rows currently visible. */
  resultCount?: number;
  /** Total number of rows before filtering. When `resultCount < totalCount`,
   *  the widget renders "X of Y" so operators see how much they've narrowed. */
  totalCount?: number;
  /** Optional id label for showing the deep-link state ("Filtered to 1 row").
   *  When `values.id` is set, the widget makes that visible alongside the
   *  clear-all button. */
  showIdBadge?: boolean;
}

// ---------------------------------------------------------------------------
// MultiSelect — collapsible checkbox list rendered as a dropdown
// ---------------------------------------------------------------------------

function MultiSelect({
  label, options, selected, onChange, accent,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  accent: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click — standard dropdown UX.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (opt: string) => {
    if (selected.includes(opt)) onChange(selected.filter(s => s !== opt));
    else onChange([...selected, opt]);
  };

  const isActive = selected.length > 0;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={isActive ? `${label}: ${selected.join(", ")} — click to change` : `Filter by ${label.toLowerCase()}`}
        style={{
          fontSize: 11, padding: "3px 8px",
          background: isActive ? `${accent}14` : "transparent",
          border: `1px solid ${isActive ? accent : C.brd}`,
          borderRadius: 3, color: isActive ? accent : C.txS,
          fontFamily: F.mono, cursor: "pointer", whiteSpace: "nowrap",
          display: "flex", alignItems: "center", gap: 4,
        }}
      >
        <span>{label}</span>
        {isActive && <span style={{ fontWeight: 700 }}>· {selected.length}</span>}
        <span style={{ fontSize: 9, opacity: 0.7 }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 10,
            background: C.bgS, border: `1px solid ${C.brd}`, borderRadius: 4,
            padding: 6, minWidth: 160, maxHeight: 280, overflowY: "auto",
            boxShadow: `0 4px 12px rgba(0,0,0,0.4)`,
          }}
        >
          {options.length === 0 ? (
            <div style={{ fontSize: 11, color: C.txT, padding: 6, fontStyle: "italic" }}>No options</div>
          ) : options.map(opt => {
            const checked = selected.includes(opt);
            return (
              <label
                key={opt}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
                  fontSize: 11, color: checked ? C.tx : C.txS, cursor: "pointer",
                  borderRadius: 3, fontFamily: F.mono,
                  background: checked ? `${accent}10` : "transparent",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${accent}18`; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = checked ? `${accent}10` : "transparent"; }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt)}
                  style={{ accentColor: accent, cursor: "pointer" }}
                />
                <span>{opt}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PanelFilters — main widget
// ---------------------------------------------------------------------------

export function PanelFilters({ config, values, onChange, resultCount, totalCount, showIdBadge }: PanelFiltersProps) {
  // Active = anything that narrows the visible set. id counts; highlight does not
  // (highlight is a pulse-only deep-link, not a filter).
  // "Active" means the dimension narrows the visible set. min counts; min="" /
  // min="0" do not (those are the panel's own no-op convention).
  const minActive = !!values.min && values.min !== "0";

  const hasFilter = Boolean(
    values.q ||
    (values.severity?.length ?? 0) > 0 ||
    (values.source?.length ?? 0) > 0 ||
    (values.status?.length ?? 0) > 0 ||
    (values.scope?.length ?? 0) > 0 ||
    (values.actor?.length ?? 0) > 0 ||
    (values.confidence?.length ?? 0) > 0 ||
    minActive ||
    values.id,
  );

  const clearAll = () => {
    // Send empty values for each dimension this panel manages — the URL state
    // module deletes empty params, so this effectively unsets everything we own.
    onChange({
      q: "",
      severity: [],
      source: [],
      status: [],
      scope: [],
      actor: [],
      confidence: [],
      min: "",
      max: "",
      id: "",
      highlight: "",
    });
  };

  return (
    <div
      style={{
        display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8,
        padding: "8px 0", marginBottom: 10,
        borderBottom: `1px solid ${C.brd}33`,
      }}
    >
      {config.search && (
        <input
          type="text"
          placeholder={config.search.placeholder ?? "Search…"}
          value={values.q ?? ""}
          onChange={(e) => onChange({ q: e.target.value })}
          style={{
            fontSize: 11, padding: "3px 8px",
            background: C.bg, border: `1px solid ${values.q ? C.brand : C.brd}`,
            borderRadius: 3, color: C.tx, fontFamily: F.mono, outline: "none",
            minWidth: 200,
          }}
        />
      )}

      {config.severity && (
        <MultiSelect
          label="Severity"
          options={config.severity}
          selected={values.severity ?? []}
          onChange={(next) => onChange({ severity: next })}
          accent={C.danger}
        />
      )}

      {config.source && (
        <MultiSelect
          label="Source"
          options={config.source}
          selected={values.source ?? []}
          onChange={(next) => onChange({ source: next })}
          accent={C.purp}
        />
      )}

      {config.status && (
        <MultiSelect
          label="Status"
          options={config.status}
          selected={values.status ?? []}
          onChange={(next) => onChange({ status: next })}
          accent={C.brand}
        />
      )}

      {config.scope && (
        <MultiSelect
          label="Scope"
          options={config.scope}
          selected={values.scope ?? []}
          onChange={(next) => onChange({ scope: next })}
          accent={C.info}
        />
      )}

      {config.actor && (
        <MultiSelect
          label="Actor"
          options={config.actor}
          selected={values.actor ?? []}
          onChange={(next) => onChange({ actor: next })}
          accent={C.cyan}
        />
      )}

      {config.confidence && (
        <MultiSelect
          label="Confidence"
          options={config.confidence}
          selected={values.confidence ?? []}
          onChange={(next) => onChange({ confidence: next })}
          accent={C.green}
        />
      )}

      {config.min && (
        // v0.8.4: numeric "minimum" range dimension. Single-select <select>
        // (operator picks one threshold); URL stores the raw string. The
        // panel's filter logic does the parseInt + comparison.
        <select
          value={values.min ?? "0"}
          onChange={(e) => onChange({ min: e.target.value })}
          title={`Filter rows where the ${config.min.label.toLowerCase()} value is at or above the selected threshold`}
          style={{
            fontSize: 11, padding: "3px 8px",
            background: minActive ? `${C.warn}14` : "transparent",
            border: `1px solid ${minActive ? C.warn : C.brd}`,
            borderRadius: 3, color: minActive ? C.warn : C.txS,
            fontFamily: F.mono, cursor: "pointer", outline: "none",
          }}
        >
          {config.min.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {/* Spacer pushes the count + clear-all to the right */}
      <div style={{ flex: 1 }} />

      {showIdBadge && values.id && (
        <span
          title={`Filtered to row id "${values.id}" via deep-link. Clear all filters to see the full list.`}
          style={{
            fontSize: 10, fontFamily: F.mono, color: C.cyan,
            padding: "2px 6px", borderRadius: 3,
            background: `${C.cyan}14`, border: `1px solid ${C.cyan}44`,
            whiteSpace: "nowrap",
          }}
        >
          deep-link: id={values.id.slice(0, 12)}{values.id.length > 12 ? "…" : ""}
        </span>
      )}

      {typeof resultCount === "number" && (
        <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono, whiteSpace: "nowrap" }}>
          {typeof totalCount === "number" && totalCount !== resultCount
            ? `${resultCount} of ${totalCount}`
            : `${resultCount} result${resultCount === 1 ? "" : "s"}`}
        </span>
      )}

      {hasFilter && (
        <button
          type="button"
          onClick={clearAll}
          title="Remove all filters and the deep-link id (resets the view to the full list)"
          style={{
            fontSize: 10, fontFamily: F.sans, fontWeight: 700, letterSpacing: "0.04em",
            padding: "3px 8px", borderRadius: 3,
            background: "transparent", border: `1px solid ${C.warn}`, color: C.warn,
            cursor: "pointer", textTransform: "uppercase",
          }}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
