/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // The development indicator is rendered outside the dashboard shell and can
  // create a second, document-level scrollbar. ClawNex owns scrolling inside
  // its navigation and content panes, so keep the dev overlay disabled.
  devIndicators: false,
  // DAST 2026-05-15 #N2: drop the `X-Powered-By: Next.js` header from
  // HTML responses. API responses already strip it via headers() above,
  // but the SSR HTML route adds it back by default. Fingerprinting
  // reduction; not a load-bearing control.
  poweredByHeader: false,
  // Expose env vars to Edge Runtime (middleware.ts needs RBAC_ENABLED)
  env: {
    RBAC_ENABLED: process.env.RBAC_ENABLED || '',
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          // M1 (DAST 2026-05-14): preload added so Next-side HSTS matches
          // Caddy's. Even with the install-prod.sh Caddyfile dropping its
          // duplicate header block, Anvil (no Caddy) still needs a
          // preload-eligible HSTS for parity. preload submission is
          // separately gated by hstspreload.org, so this is safe to keep
          // regardless of submission state.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          // Content-Security-Policy is now set dynamically per-request by
          // src/middleware.ts so it can include a fresh nonce on every
          // response (CRIT #3 — nonce-based CSP, drop 'unsafe-inline').
        ],
      },
      {
        // M6 (DAST 2026-05-14): API JSON responses must not be cacheable.
        // Without no-store, intermediate proxies (browser cache, CDN,
        // corporate proxy) could keep responses with operator-scoped
        // data and replay them across sessions/users.
        source: '/api/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
    ];
  },
  serverExternalPackages: ['better-sqlite3', 'ws', 'bufferutil', 'utf-8-validate'],
  // Next 16.2.x can race while collecting standalone trace manifests when
  // static-generation workers are writing route .nft.json files in parallel.
  // Keep production builds deterministic; installers and CI value reliability
  // over shaving a few seconds off the build.
  experimental: {
    cpus: 1,
  },
  // DAST 2026-05-15 H3: Next.js standalone output traces every file
  // reachable from the project root and copies them into
  // .next/standalone/. The dev/test SQLite DB (clawnex.db + its
  // -wal/-shm/-journal files — and the legacy sentinel.db filename kept
  // around for pre-v0.9 installs) was getting bundled with the
  // build, leaking operator data via the deploy tarball. Exclude
  // the whole DB triple from output tracing so the bundle is
  // database-free; the runtime creates a fresh DB at the install
  // location on first launch.
  outputFileTracingExcludes: {
    '*': [
      '**/clawnex.db',
      '**/clawnex.db-wal',
      '**/clawnex.db-shm',
      '**/clawnex.db-journal',
      '**/sentinel.db',
      '**/sentinel.db-wal',
      '**/sentinel.db-shm',
      '**/sentinel.db-journal',
      '**/.env',
      '**/.env.*',
      '**/.git',
      '**/.git/**',
      '**/logs',
      '**/logs/**',
      '**/logs/**/*',
      '**/*.log',
      '**/*.jsonl',
      '**/docs/.claude',
      '**/docs/.claude/**',
      '**/docs/AGENTS.md',
      '**/docs/CLAUDE.md',
      '**/docs/coordination',
      '**/docs/coordination/**',
      '**/docs/internal',
      '**/docs/internal/**',
      '**/docs/proposals',
      '**/docs/proposals/**',
      '**/docs/qa',
      '**/docs/qa/**',
      '**/docs/out',
      '**/docs/out/**',
      '**/docs/social-campaigns',
      '**/docs/social-campaigns/**',
      '**/docs/superpowers',
      '**/docs/superpowers/**',
      '**/docs/tracking',
      '**/docs/tracking/**',
      '**/docs/training-workbooks',
      '**/docs/training-workbooks/**',
      '**/docs/*handoff*',
      '**/docs/*adversarial-review*',
      '**/docs/*overnight*',
      '**/litellm/config.yaml',
      '**/litellm/config*.yaml',
      '**/.deploy-build.log',
    ],
  },
  webpack: (config, { dev }) => {
    if (!dev) {
      // Mounted/cloud-synced volumes can make Webpack's production pack-file
      // cache observe generated files before they are fully visible, causing
      // intermittent ENOENT/partial JSON failures during installer builds.
      config.cache = false;
    }
    config.externals.push({
      'better-sqlite3': 'commonjs better-sqlite3',
      'bufferutil': 'commonjs bufferutil',
      'utf-8-validate': 'commonjs utf-8-validate',
    });
    return config;
  },
};

export default nextConfig;
