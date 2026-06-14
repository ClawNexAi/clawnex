// useBlastRadiusData — thin wrapper over the canonical useDataState hook,
// typed to the PermissivenessReport shape. Fetches /api/permissiveness
// with cache: "no-store" so the hook's own staleness logic drives refresh.

import { useCallback } from "react";
import { useDataState } from "../../shared";
import type { PermissivenessReport } from "@/lib/services/permissiveness/types";
import { BLAST_RADIUS_DEMO } from "../../mock-data";

async function fetchPermissiveness(refresh = false): Promise<PermissivenessReport> {
  const url = `/api/permissiveness${refresh ? "?refresh=true" : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PermissivenessReport;
}

/**
 * Demo-mode short-circuit. When the caller passes `demoMode: true`, the
 * hook returns BLAST_RADIUS_DEMO instead of hitting /api/permissiveness.
 * The seeded report has 6 surfaces, 2 dangerous combos, 4 posture lints
 * cross-referenced with AGENTS_DATA so links from this panel land
 * coherently in the rest of the demo. Header counts in the parent
 * dashboard remain LIVE (Phase 5 boundary contract).
 */
export function useBlastRadiusData(opts?: { demoMode?: boolean }) {
  const demoMode = Boolean(opts?.demoMode);
  const query = useDataState<PermissivenessReport>({
    fetcher: async () => {
      if (demoMode) return BLAST_RADIUS_DEMO as unknown as PermissivenessReport;
      return fetchPermissiveness(false);
    },
    refreshIntervalMs: demoMode ? 0 : 60_000,
    staleAfterMs: 2 * 60_000,
  });

  const forceRefresh = useCallback(async () => {
    if (demoMode) {
      query.refresh();
      return;
    }
    try {
      await fetchPermissiveness(true);
    } finally {
      query.refresh();
    }
  }, [query, demoMode]);

  return { ...query, forceRefresh };
}
