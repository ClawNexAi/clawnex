export type DashboardRequestInput = RequestInfo | URL;

function isSameOriginApiRequest(input: DashboardRequestInput, origin: string): boolean {
  const rawUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

  try {
    const requestUrl = new URL(rawUrl, origin);
    const dashboardOrigin = new URL(origin).origin;
    return requestUrl.origin === dashboardOrigin && requestUrl.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/**
 * Redirect an already-mounted dashboard when its server session disappears.
 * This is limited to same-origin API responses so unrelated upstream 401s
 * cannot evict the operator from ClawNex.
 */
export function handleDashboardUnauthorized(
  response: Pick<Response, "status">,
  input: DashboardRequestInput,
  origin: string,
  onUnauthorized: () => void,
): boolean {
  if (response.status !== 401 || !isSameOriginApiRequest(input, origin)) return false;
  onUnauthorized();
  return true;
}
