/**
 * ClawNex Operator Service — CRUD for operator accounts.
 *
 * Uses bcryptjs (12 rounds) for password hashing. All queries use the
 * synchronous better-sqlite3 helpers from db/index.
 *
 * Tables: operators
 *
 * @module services/operator-service
 */

import { hashSync, compareSync } from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { queryOne, queryAll, run } from '../db/index';
import type { OperatorRecord, Role } from '../rbac/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BCRYPT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Operator record without the password hash — safe for API responses. */
export type SafeOperator = Omit<OperatorRecord, 'password_hash'>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip password_hash from a record before returning. */
function stripHash(op: OperatorRecord): SafeOperator {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash, ...safe } = op;
  return safe;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new operator account.
 * @returns The created record (without password_hash)
 */
export function createOperator(
  username: string,
  password: string,
  role: Role,
  createdBy?: string,
): SafeOperator {
  const id = uuid();
  const passwordHash = hashSync(password, BCRYPT_ROUNDS);
  const now = new Date().toISOString();

  run(
    `INSERT INTO operators (id, username, password_hash, role, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, username, passwordHash, role, createdBy ?? null, now, now],
  );

  const record = queryOne<OperatorRecord>(
    'SELECT * FROM operators WHERE id = ?',
    [id],
  );
  if (!record) throw new Error('Failed to create operator');
  return stripHash(record);
}

/** Get an operator by ID. */
export function getOperatorById(id: string): OperatorRecord | null {
  return queryOne<OperatorRecord>('SELECT * FROM operators WHERE id = ?', [id]) ?? null;
}

/** Get an operator by username (case-insensitive). */
export function getOperatorByUsername(username: string): OperatorRecord | null {
  return queryOne<OperatorRecord>(
    'SELECT * FROM operators WHERE username = ?',
    [username],
  ) ?? null;
}

/** List all operators (without password hashes). */
export function listOperators(): SafeOperator[] {
  const rows = queryAll<OperatorRecord>('SELECT * FROM operators ORDER BY created_at ASC');
  return rows.map(stripHash);
}

/** Update operator fields. */
export function updateOperator(
  id: string,
  fields: { displayName?: string; role?: Role; isActive?: boolean },
): void {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (fields.displayName !== undefined) {
    sets.push('display_name = ?');
    params.push(fields.displayName);
  }
  if (fields.role !== undefined) {
    sets.push('role = ?');
    params.push(fields.role);
  }
  if (fields.isActive !== undefined) {
    sets.push('is_active = ?');
    params.push(fields.isActive ? 1 : 0);
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  run(`UPDATE operators SET ${sets.join(', ')} WHERE id = ?`, params);
}

/** Change an operator's password. */
export function changePassword(id: string, newPassword: string): void {
  const passwordHash = hashSync(newPassword, BCRYPT_ROUNDS);
  run(
    "UPDATE operators SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
    [passwordHash, id],
  );
}

/** Verify a plaintext password against a bcrypt hash. */
export function verifyPassword(plaintext: string, hash: string): boolean {
  return compareSync(plaintext, hash);
}

/** Count operators (used for bootstrap check). */
export function operatorCount(): number {
  const row = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM operators');
  return row?.count ?? 0;
}

/** Increment failed login counter. */
export function incrementFailedLogin(id: string): void {
  run(
    "UPDATE operators SET failed_login_count = failed_login_count + 1, updated_at = datetime('now') WHERE id = ?",
    [id],
  );
}

/** Reset failed login counter to 0. */
export function resetFailedLogin(id: string): void {
  run(
    "UPDATE operators SET failed_login_count = 0, updated_at = datetime('now') WHERE id = ?",
    [id],
  );
}

/** Record a successful login. */
export function recordLogin(id: string): void {
  run(
    `UPDATE operators SET
       last_login_at = datetime('now'),
       login_count = login_count + 1,
       failed_login_count = 0,
       updated_at = datetime('now')
     WHERE id = ?`,
    [id],
  );
}
