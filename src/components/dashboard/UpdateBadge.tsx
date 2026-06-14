"use client";

/**
 * Update Badge — top-of-header notifier for available updates.
 *
 * Surfaces "you should update X" notifications in a single click target
 * next to the version pill. Polls /api/config/updates (the same endpoint
 * the Configuration → Updates section uses) and aggregates the per-source
 * `updateAvailable` flags into a single count.
 *
 * v1 sources (already polled by /api/config/updates):
 *   - OpenClaw      (semver-based; live GitHub release tag)
 *   - DefenseClaw   (commit-date-based; rule pack ships bundled with ClawNex)
 *   - Host scanner  (local bundled scanner availability)
 *
 * ClawNex itself isn't tracked yet — there's no published release source
 * to poll against pre-OSS-launch. Once the OSS repo ships and a release
 * channel is published, add it to /api/config/updates and this component
 * picks it up automatically.
 *
 * UI states:
 *   - Loading / network error  → render nothing (no layout shift, no noise)
 *   - 0 updates available      → muted dot; tooltip shows "All up to date"
 *   - N updates available      → branded dot + count; click expands dropdown
 *
 * Click navigates to Configuration → Updates section via the dashboard
 * navigate() prop so operators can take action without losing context.
 *
 * @module dashboard/UpdateBadge
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { Dot } from "./shared";
import { C, F } from "./constants";

interface UpdateSource {
  name: string;
  installedVersion?: string;
  latestVersion?: string | null;
  currentVersion?: string;
  latestCommitDate?: string | null;
  ruleCount?: number;
  releaseUrl?: string | null;
  updateAvailable: boolean;
}

interface UpdateStatusResponse {
  openclaw?: UpdateSource;
  clawkeeper?: UpdateSource;
  defenseclaw?: UpdateSource;
  lastChecked: string;
}

const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes — matches Configuration panel cadence

function timeAgo(iso: string): string {
  if (!iso) return "never";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
  } catch {
    return "never";
  }
}

interface Props {
  /** Navigate to a configuration card. Same callback the wire-status chip uses. */
  navigate?: (tab: string, focusKey?: string) => void;
}

export function UpdateBadge({ navigate }: Props) {
  const [data, setData] = useState<UpdateStatusResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/config/updates");
      if (res.ok) setData(await res.json());
    } catch { /* ignore — keep last good data */ }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    // Listen for in-app refresh signals so the badge updates immediately when
    // an operator runs an update from the Configuration → Updates panel.
    // Without this, the badge stays stale on its 15-min schedule.
    const onRefresh = () => load();
    if (typeof window !== "undefined") {
      window.addEventListener("clawnex:updates-refreshed", onRefresh);
    }
    return () => {
      clearInterval(id);
      if (typeof window !== "undefined") {
        window.removeEventListener("clawnex:updates-refreshed", onRefresh);
      }
    };
  }, [load]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Force refresh — clears the server-side cache then re-fetches
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch("/api/config/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check" }),
      });
      await load();
    } catch { /* ignore */ }
    setRefreshing(false);
  }, [load]);

  if (!data) return null;

  // Sources are split by whether the operator can actually act on them
  // from inside ClawNex:
  //
  //   actionable: there's a working in-app update flow. Counted in the
  //               badge number, since the operator can clear it in-app.
  //   informational: there's no in-app update path. Shown in the dropdown
  //                  for awareness but NOT counted in the badge — would
  //                  otherwise produce numbers operators can't act on.
  //                    - The host scanner is bundled with ClawNex.
  //                    - OpenClaw upgrades happen outside ClawNex (the
  //                      "never touch OpenClaw" rule).
  //                    - DefenseClaw rules ship bundled with ClawNex
  //                      releases; only changing on a ClawNex version bump.
  const sources: Array<{
    key: string;
    src: UpdateSource | undefined;
    label: string;
    kind: "actionable" | "info";
  }> = [
    { key: "clawnex-clawkeeper", src: data.clawkeeper,  label: "Host Security Scanner", kind: "info" },
    { key: "clawnex-openclaw",   src: data.openclaw,    label: "OpenClaw",            kind: "info" },
    { key: "clawnex-defenseclaw", src: data.defenseclaw, label: "DefenseClaw rules",  kind: "info" },
  ];
  const actionableUpdates = sources.filter(s => s.kind === "actionable" && s.src?.updateAvailable);
  const count = actionableUpdates.length;

  const goToUpdates = () => {
    setOpen(false);
    if (navigate) navigate("configuration", "updates");
  };

  return (
    <div
      ref={containerRef}
      title={count > 0 ? `${count} update${count === 1 ? "" : "s"} available — click for details. Last checked ${timeAgo(data.lastChecked)}.` : `All up to date. Last checked ${timeAgo(data.lastChecked)}.`}
      style={{ position: "relative", display: "inline-flex", marginRight: 6 }}
    >
      {/* No <Tooltip> wrapper. The Tooltip system renders a 6px corner pip
          on any anchor with as="div" as a hover discoverability hint
          (BlockAnchorIndicator) — that pip lands on the top-right of the
          pill, directly overlapping the "S" of UPDATES. Native HTML title=""
          gives operators the same hover info without the visual collision.
          The dropdown (which actually opens on click) is the canonical
          place for the per-source breakdown + last-checked detail. */}
      <button
        onClick={() => setOpen(!open)}
        aria-label={count > 0 ? `${count} updates available` : "All up to date"}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: count > 0 ? C.brand : "transparent",
          border: `1px solid ${count > 0 ? C.brand : C.brd}`,
          borderRadius: 10, padding: "1px 8px", cursor: "pointer",
          color: count > 0 ? "#000" : C.txT,
          fontSize: 10, fontFamily: F.mono, fontWeight: 800, letterSpacing: "0.06em",
          outline: "none",
          lineHeight: 1.4,
          minHeight: 18,
        }}
      >
        {count > 0
          ? `${count} ${count === 1 ? "UPDATE" : "UPDATES"}`
          : "UPDATES"}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0,
          minWidth: 280, maxWidth: 340,
          background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8,
          boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
          padding: 10, zIndex: 1000,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.tx, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              {count > 0 ? `${count} Update${count === 1 ? "" : "s"} available` : "All up to date"}
            </span>
            <button
              onClick={refresh}
              disabled={refreshing}
              style={{
                fontSize: 9, fontFamily: F.mono, color: C.txT,
                background: "transparent", border: `1px solid ${C.brd}`,
                borderRadius: 4, padding: "2px 6px", cursor: refreshing ? "default" : "pointer",
                opacity: refreshing ? 0.5 : 1,
              }}
            >
              {refreshing ? "…" : "REFRESH"}
            </button>
          </div>

          {sources.map(({ key, src, label, kind }) => {
            if (!src) return null;
            const installed = src.installedVersion || src.currentVersion || "—";
            const latest = src.latestVersion || (src.latestCommitDate ? new Date(src.latestCommitDate).toISOString().slice(0, 10) : null);
            const available = src.updateAvailable;
            // Only actionable sources contribute to the badge count and get
            // the bright "update available" treatment. Informational rows
            // (OpenClaw, DefenseClaw rules) display the version delta but
            // are visually muted with an "INFO" tag so the operator
            // understands there's no in-app button to clear them.
            const isActionableUpdate = kind === "actionable" && available;
            return (
              <div key={key} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "6px 4px", marginBottom: 2,
                borderRadius: 4,
                background: isActionableUpdate ? `${C.brand}0a` : "transparent",
              }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: isActionableUpdate ? C.brand : C.tx }}>{label}</span>
                    {kind === "info" && (
                      <span style={{
                        fontSize: 8, fontWeight: 700, fontFamily: F.mono, letterSpacing: "0.06em",
                        color: C.txT, background: `${C.txT}14`,
                        border: `1px solid ${C.txT}33`, borderRadius: 2,
                        padding: "1px 4px",
                      }}>INFO</span>
                    )}
                  </div>
                  <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono }}>
                    {installed}{available && latest ? ` → ${latest}` : ""}
                  </span>
                </div>
                {isActionableUpdate && (
                  <Dot color={C.brand} size={6} glow />
                )}
              </div>
            );
          })}

          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.brd}`,
            fontSize: 10, color: C.txT, fontFamily: F.mono,
          }}>
            <span>Last checked: {timeAgo(data.lastChecked)}</span>
            {navigate && (
              <button
                onClick={goToUpdates}
                style={{
                  fontSize: 10, fontFamily: F.mono, color: C.brand,
                  background: "transparent", border: "none",
                  padding: 0, cursor: "pointer", textDecoration: "underline",
                }}
              >
                View details →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
