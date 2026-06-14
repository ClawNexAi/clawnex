"use client";

/**
 * MissionControlSetupBanner — empty-state banner shown at the top of Mission
 * Control when the operator has not yet completed the Welcome Wizard.
 *
 * WHY: operator flagged 2026-05-07 that an empty cockpit (zero alerts, 100/0
 * posture scores, no traffic) reads as "all clear" but actually means
 * "nothing's been observed yet." The banner makes the difference explicit
 * so operators don't mistake an unconfigured install for a green install.
 *
 * Behavior:
 *  - Renders only when setup is incomplete (wizard not dismissed). Demo mode
 *    short-circuits to "complete" so demos don't show the banner.
 *  - Can be dismissed for the current browser session (sessionStorage). Re-
 *    appears on the next visit if setup is still incomplete — operator can't
 *    accidentally hide it forever.
 *  - Single-line CTA links operators back to Fleet Command where the wizard
 *    lives. No state mutation here — this is a routing affordance only.
 *
 * Visual: warn-tinted left border + glass surface, matches the "Setup not
 * complete" warning ribbon already used inside Fleet Command for
 * consistency. Lives at the top of MC content so it's the first thing the
 * operator sees on entering the cockpit.
 */

import { useEffect, useState } from "react";
import { C, F } from "../../constants";
import type { TabId } from "../../types";
import type { NavigateOpts } from "../../url-state";

const SESSION_DISMISS_KEY = "clawnex.mcSetupBanner.dismissed";

export interface MissionControlSetupBannerProps {
  /** Setup-complete signal from useSetupComplete(). null = loading; true = complete; false = incomplete. */
  setupComplete: boolean | null;
  /** Navigation handler from the dashboard. */
  onNavigate: (tab: TabId, focusOrOpts?: NavigateOpts) => void;
}

export function MissionControlSetupBanner({
  setupComplete,
  onNavigate,
}: MissionControlSetupBannerProps): JSX.Element | null {
  const [sessionDismissed, setSessionDismissed] = useState<boolean>(false);

  // Read session-dismiss flag on mount. Per-browser-session only — wiped on
  // tab close so the banner reappears next visit if setup is still pending.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.sessionStorage.getItem(SESSION_DISMISS_KEY) === "1") {
        setSessionDismissed(true);
      }
    } catch {
      /* private mode / disabled storage — fail-open, banner stays visible */
    }
  }, []);

  // Don't render while still loading — avoids a flash on every page load.
  if (setupComplete === null) return null;
  // Setup is complete — banner is moot.
  if (setupComplete === true) return null;
  // Operator dismissed for this session.
  if (sessionDismissed) return null;

  function handleDismiss() {
    setSessionDismissed(true);
    try {
      window.sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function handleOpenWizard() {
    onNavigate("fleet");
  }

  return (
    <div
      role="status"
      style={{
        marginBottom: 12,
        padding: "10px 14px",
        background: `linear-gradient(180deg, ${C.glassPanel}, ${C.glassPanel2})`,
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        border: `1px solid ${C.warn}33`,
        borderLeft: `3px solid ${C.warn}`,
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
        {/* Warn-tinted dot to anchor the banner visually with Fleet's ReadinessBanner. */}
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: 999,
            background: C.warn,
            boxShadow: `0 0 8px ${C.warn}88`,
            flexShrink: 0,
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: F.sans,
              fontSize: 13,
              fontWeight: 700,
              color: C.tx,
              marginBottom: 2,
            }}
          >
            Setup is still in progress
          </div>
          <div
            style={{
              fontFamily: F.sans,
              fontSize: 12,
              color: C.txS,
              lineHeight: 1.5,
            }}
          >
            Mission Control populates from live traffic + scan results. Tiles
            below show <strong style={{ color: C.tx }}>0</strong> because nothing
            has been observed yet — not because everything is clear. Finish
            setup to start filling the cockpit.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {/* Primary CTA — open the wizard on Fleet Command. */}
        <button
          type="button"
          onClick={handleOpenWizard}
          style={{
            padding: "6px 14px",
            background: `linear-gradient(135deg, ${C.cyan}, ${C.glassGreen})`,
            border: 0,
            borderRadius: 10,
            color: "#06121f",
            fontSize: 11,
            fontFamily: F.sans,
            fontWeight: 850,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Open Setup ▸
        </button>
        {/* Secondary — dismiss for session. Reappears next visit if still pending. */}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss setup banner for this session"
          style={{
            background: "transparent",
            border: "none",
            color: C.txT,
            fontSize: 16,
            cursor: "pointer",
            padding: "0 4px",
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
