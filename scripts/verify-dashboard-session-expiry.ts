import assert from "node:assert/strict";
import { handleDashboardUnauthorized } from "../src/lib/dashboard/session-expiry";

const origin = "https://qa.clawnexai.com";
let redirects = 0;
const redirect = () => { redirects += 1; };

assert.equal(
  handleDashboardUnauthorized({ status: 401 }, "/api/cve/sync", origin, redirect),
  true,
  "same-origin API 401 invalidates the mounted dashboard",
);
assert.equal(redirects, 1, "the invalid-session redirect runs");

assert.equal(
  handleDashboardUnauthorized({ status: 403 }, "/api/config/model-pricing/sync", origin, redirect),
  false,
  "permission failures remain visible to the current page",
);
assert.equal(
  handleDashboardUnauthorized({ status: 401 }, "https://upstream.example/v1/models", origin, redirect),
  false,
  "an upstream 401 cannot evict the ClawNex operator",
);
assert.equal(
  handleDashboardUnauthorized({ status: 401 }, "/setup", origin, redirect),
  false,
  "non-API navigation responses do not trigger session handling",
);
assert.equal(redirects, 1, "only the same-origin API 401 redirected");

console.log("PASS: stale dashboard sessions redirect on same-origin API 401 responses");
