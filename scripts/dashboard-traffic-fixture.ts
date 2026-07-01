#!/usr/bin/env tsx
export * from "../src/lib/dev/dashboard-traffic-fixture";

import { runDashboardTrafficFixtureCli } from "../src/lib/dev/dashboard-traffic-fixture";

if (require.main === module) {
  try {
    runDashboardTrafficFixtureCli();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
