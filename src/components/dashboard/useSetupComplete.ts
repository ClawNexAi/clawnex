"use client";

/**
 * useSetupComplete — small shared hook that returns whether the operator has
 * dismissed the Welcome Wizard (i.e., setup is "complete" from their POV).
 *
 * WHY: Mission Control needs to know whether the cockpit is showing real
 * post-setup data or empty/zero placeholders that look like "all clear" but
 * actually mean "nothing's been observed yet." Same signal also drives the
 * sidebar nav "(setup pending)" badge so operators don't mistake an empty
 * Mission Control for a green one.
 *
 * Implementation: polls `/api/config/defaults` (fast, cached server-side)
 * for the `wizard_dismissed` flag. The flag is set to `"1"` by the Welcome
 * Wizard "Get Started" button after all steps are complete (or skipped),
 * matching the FleetCommandPanel.tsx logic at the same endpoint.
 *
 * Return values:
 *   null    — still loading (first fetch hasn't returned yet)
 *   true    — wizard has been dismissed; setup is complete
 *   false   — wizard not dismissed; setup is in progress / incomplete
 *
 * Demo mode short-circuits to `true` so demos don't display setup nags.
 *
 * operator-flagged 2026-05-07: empty Mission Control on a fresh install reads
 * as "all clear" because every KPI shows 0. The setup-state signal lets the
 * UI render an empty-state banner instead of pretending the cockpit is live.
 */

import { useEffect, useState } from "react";

export function useSetupComplete(demoMode: boolean): boolean | null {
  const [complete, setComplete] = useState<boolean | null>(null);

  useEffect(() => {
    if (demoMode) {
      setComplete(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/config/defaults");
        if (cancelled) return;
        if (!res.ok) {
          // Fail-open: don't nag the operator if config endpoint is down.
          setComplete(true);
          return;
        }
        const d = await res.json();
        const dismissed =
          d?.settings?.wizard_dismissed === "1" ||
          d?.settings?.wizard_dismissed === "true";
        setComplete(dismissed);
      } catch {
        if (!cancelled) setComplete(true); // fail-open
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [demoMode]);

  return complete;
}
