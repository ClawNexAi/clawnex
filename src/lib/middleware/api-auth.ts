/**
 * ClawNex Public API Authentication Middleware.
 *
 * Reusable auth function called at the top of each /api/v1/* route.
 * Validates the API key, checks scopes, enforces rate limits, and
 * updates the last_used_at timestamp on success.
 *
 * Supports two header formats:
 * - `X-ClawNex-Key: cnx_...` (primary)
 * - `Authorization: Bearer cnx_...` (OpenAI-compatible)
 *
 * @module middleware/api-auth
 */

import { NextRequest } from 'next/server';
import {
  validateApiKey,
  checkScope,
  updateLastUsed,
  type ApiKeyRecord,
} from '../services/api-key-service';
import { checkRateLimit } from '../rate-limiter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of authenticating a public API request. */
export interface AuthResult {
  /** Whether authentication succeeded. */
  authenticated: boolean;
  /** The validated key record (present on success). */
  keyRecord?: ApiKeyRecord;
  /** Error message (present on failure). */
  error?: string;
  /** HTTP status code to return on failure. */
  status?: number;
  /** Rate limit headers to include in the response. */
  rateLimit?: {
    limit: number;
    remaining: number;
    reset: number;
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Authenticate a public API request.
 *
 * Extracts the API key from the request headers, validates it against the
 * database, checks the required scope, and enforces rate limits.
 *
 * @param request - The incoming Next.js request
 * @param requiredScope - The scope required for this endpoint (empty string for public)
 * @returns Authentication result
 */
export function authenticateRequest(
  request: NextRequest,
  requiredScope: string,
): AuthResult {
  // Extract API key from headers
  const clawNexKey = request.headers.get('x-clawnex-key');
  const authHeader = request.headers.get('authorization');

  let apiKey: string | null = null;

  if (clawNexKey) {
    apiKey = clawNexKey;
  } else if (authHeader?.startsWith('Bearer ')) {
    apiKey = authHeader.substring(7);
  }

  if (!apiKey) {
    return {
      authenticated: false,
      error: 'Missing API key. Provide X-ClawNex-Key header or Authorization: Bearer token.',
      status: 401,
    };
  }

  // Validate key
  const validation = validateApiKey(apiKey);
  if (!validation.valid || !validation.keyRecord) {
    return {
      authenticated: false,
      error: validation.error || 'Invalid API key',
      status: 401,
    };
  }

  const keyRecord = validation.keyRecord;

  // Check scope
  if (requiredScope && !checkScope(keyRecord, requiredScope)) {
    return {
      authenticated: false,
      error: `Insufficient scope. Required: ${requiredScope}`,
      status: 403,
    };
  }

  // Check rate limit
  const rateCheck = checkRateLimit(keyRecord.id, keyRecord.rate_limit);
  if (!rateCheck.allowed) {
    return {
      authenticated: false,
      error: 'Rate limit exceeded. Try again later.',
      status: 429,
      rateLimit: {
        limit: keyRecord.rate_limit,
        remaining: rateCheck.remaining,
        reset: rateCheck.resetAt,
      },
    };
  }

  // Update last used timestamp (fire-and-forget)
  updateLastUsed(keyRecord.id);

  return {
    authenticated: true,
    keyRecord,
    rateLimit: {
      limit: keyRecord.rate_limit,
      remaining: rateCheck.remaining,
      reset: rateCheck.resetAt,
    },
  };
}
