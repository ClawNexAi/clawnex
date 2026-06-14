/**
 * RBAC build-time configuration.
 *
 * This file exists because Next.js 14 Edge Runtime middleware cannot
 * read process.env from .env.local at runtime. The value here is
 * inlined by webpack at build time, making it available to middleware.ts.
 *
 * To enable RBAC: set this to true and rebuild.
 * To disable RBAC: set this to false and rebuild.
 *
 * The per-route guards (requireSession/requirePermission) also check
 * the RBAC_ENABLED env var at runtime, so both must agree.
 */
export const RBAC_BUILD_ENABLED = process.env.RBAC_ENABLED === 'true' || process.env.NEXT_PUBLIC_RBAC_ENABLED === 'true';
