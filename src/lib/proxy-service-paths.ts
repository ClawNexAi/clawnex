// Shared with Edge middleware. Credential validation stays in Node handlers.
export function isProxyServiceEndpoint(pathname: string, method: string): boolean {
  return (method === 'POST' && pathname === '/api/shield/scan') ||
    (method === 'GET' && (pathname === '/api/proxy/block-mode' || pathname === '/api/break-glass/status'));
}
