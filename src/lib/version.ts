// Single source of truth for the ClawNex version string.
//
// Every surface that reports a version (HTTP /api/health, /api/v1/health,
// /api/health/detailed, /api/system/migrate manifest, MCP server ident,
// /api/chat system prompt, dashboard header chip) imports from this module
// instead of hand-carrying its own literal. A release now requires a single
// version bump in package.json — the tsconfig `resolveJsonModule: true`
// flag plus Next.js's build-time tree-shaking propagate it everywhere
// without leaking the full package.json into client bundles.
//
// History: before this module existed, a v0.9.1 → v0.9.2 bump left
// /api/health and /api/health/detailed reporting v0.9.1 because two
// literals were missed (commit 8797d2c — caught only on dev-server
// restart when the dev server's health probe disagreed with the rest
// of the surface). This module exists so that never happens again.

import pkg from "../../package.json";

/** Full semver string including pre-release suffix, e.g. "0.10.0-alpha". */
export const CLAWNEX_VERSION: string = pkg.version;

/** Short version without pre-release suffix, e.g. "0.9.2".
 *  Used by the MCP server ident where tooling expects plain semver. */
export const CLAWNEX_VERSION_SHORT: string = pkg.version.replace(/-.*$/, "");

/** Pre-release channel suffix ("alpha" / "beta" / ""). */
export const CLAWNEX_CHANNEL: string = (() => {
  const match = /-([a-z]+)(?:\.\d+)?$/i.exec(pkg.version);
  return match ? match[1] : "";
})();
