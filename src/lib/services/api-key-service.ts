/**
 * ClawNex Public API Key Service — manages API key lifecycle.
 *
 * Handles generation, validation, revocation, and scope checking for
 * public API keys. Keys use the format `cnx_` + 40 hex chars, and are
 * stored as SHA-256 hashes (never plaintext).
 *
 * Tables: api_keys
 *
 * @module services/api-key-service
 */

import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { run, queryAll, queryOne } from '../db/index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Row shape returned from the api_keys table (without key_hash). */
export interface ApiKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  rate_limit: number;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

/** Internal DB row (includes key_hash for lookup). */
interface ApiKeyRow {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string;
  rate_limit: number;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

/** Result of key generation — includes the plaintext key (shown once). */
export interface GenerateKeyResult {
  id: string;
  key: string;
  keyPrefix: string;
  name: string;
  scopes: string[];
  rateLimit: number;
  createdAt: string;
}

/** Result of key validation. */
export interface ValidateKeyResult {
  valid: boolean;
  keyRecord?: ApiKeyRecord;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Hash a plaintext API key with SHA-256. */
function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Convert a DB row to a public ApiKeyRecord (strips key_hash, parses scopes). */
function rowToRecord(row: ApiKeyRow): ApiKeyRecord {
  let scopes: string[] = [];
  try {
    scopes = JSON.parse(row.scopes);
  } catch {
    scopes = [];
  }
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    scopes,
    rate_limit: row.rate_limit,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Generate a new API key.
 *
 * Creates a random key with format `cnx_` + 40 hex chars, hashes it with
 * SHA-256 for storage, and saves to the api_keys table. The plaintext key
 * is returned once and never stored.
 *
 * @param name - Human-readable label for the key
 * @param scopes - Array of permission scopes (e.g. "shield:scan", "agents:read")
 * @param rateLimit - Requests per minute (default 60)
 * @returns The key record including the plaintext key (shown once)
 */
export function generateApiKey(
  name: string,
  scopes: string[],
  rateLimit: number = 60,
): GenerateKeyResult {
  const id = randomUUID();
  const rawKey = 'cnx_' + randomBytes(20).toString('hex');
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.substring(0, 12);
  const now = new Date().toISOString();

  run(
    `INSERT INTO api_keys (id, name, key_hash, key_prefix, scopes, rate_limit, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, keyHash, keyPrefix, JSON.stringify(scopes), rateLimit, now],
  );

  return {
    id,
    key: rawKey,
    keyPrefix,
    name,
    scopes,
    rateLimit,
    createdAt: now,
  };
}

/**
 * Validate an API key.
 *
 * Hashes the provided key and looks it up in the database. Checks that the
 * key has not been revoked and has not expired.
 *
 * @param key - The plaintext API key to validate
 * @returns Validation result with the key record on success
 */
export function validateApiKey(key: string): ValidateKeyResult {
  if (!key || typeof key !== 'string') {
    return { valid: false, error: 'Missing API key' };
  }

  const keyHash = hashKey(key);
  const row = queryOne<ApiKeyRow>(
    'SELECT * FROM api_keys WHERE key_hash = ?',
    [keyHash],
  );

  if (!row) {
    return { valid: false, error: 'Invalid API key' };
  }

  if (row.revoked_at) {
    return { valid: false, error: 'API key has been revoked' };
  }

  if (row.expires_at) {
    const expiresAt = new Date(row.expires_at).getTime();
    if (Date.now() >= expiresAt) {
      return { valid: false, error: 'API key has expired' };
    }
  }

  return { valid: true, keyRecord: rowToRecord(row) };
}

/**
 * Revoke an API key by ID.
 *
 * Sets the revoked_at timestamp, permanently disabling the key.
 *
 * @param id - The key ID to revoke
 * @returns Whether the revocation succeeded
 */
export function revokeApiKey(id: string): { success: boolean } {
  const now = new Date().toISOString();
  const result = run(
    'UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    [now, id],
  );
  return { success: result.changes > 0 };
}

/**
 * List all API keys.
 *
 * Returns all keys with their metadata (without hashes). Includes both
 * active and revoked keys.
 *
 * @returns Array of key records
 */
export function listApiKeys(): ApiKeyRecord[] {
  const rows = queryAll<ApiKeyRow>(
    'SELECT * FROM api_keys ORDER BY created_at DESC',
  );
  return rows.map(rowToRecord);
}

/**
 * Check whether a key record has the required scope.
 *
 * @param keyRecord - The validated key record
 * @param requiredScope - The scope string to check (e.g. "shield:scan")
 * @returns True if the key has the required scope
 */
export function checkScope(keyRecord: ApiKeyRecord, requiredScope: string): boolean {
  if (!requiredScope) return true;
  return keyRecord.scopes.includes(requiredScope);
}

/**
 * Update the last_used_at timestamp for a key.
 *
 * @param id - The key ID
 */
export function updateLastUsed(id: string): void {
  const now = new Date().toISOString();
  try {
    run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [now, id]);
  } catch {
    // Non-critical — don't let timestamp updates break requests
  }
}
