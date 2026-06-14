// Operator credentials data-access — passkeys + GitHub identity links.
//
// Backed by the operator_credentials table (added in v0.9.0 schema).
// Each row represents one enrolled credential of a specific type:
//   - passkey: WebAuthn authenticator (credential_id, public_key, counter)
//   - github_link: GitHub user binding (github_user_id, github_username)
//
// This module is intentionally CRUD-only — the per-provider verifier
// modules (passkey.ts, github.ts) own the cryptography and call into
// here for storage. Keeps SQL out of the provider files and provider
// logic out of the data layer.
//
// Spec: docs/superpowers/specs/2026-04-23-multi-auth-providers-design.md §3.4

import { v4 as uuid } from "uuid";
import { queryOne, queryAll, run } from "../../db/index";

/** Row shape mirroring the operator_credentials table. Nullable columns
 *  vary by credential_type — passkey uses credential_id/public_key/counter,
 *  github_link uses github_user_id/github_username. */
export interface CredentialRecord {
  id: string;
  operator_id: string;
  credential_type: "passkey" | "github_link";
  credential_id: string | null;
  public_key: string | null;
  counter: number | null;
  transports: string | null;
  github_user_id: number | null;
  github_username: string | null;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
}

// ---------------------------------------------------------------------------
// Passkey CRUD
// ---------------------------------------------------------------------------

/** Insert a new passkey credential after a successful registration ceremony. */
export function insertPasskey(args: {
  operatorId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  label?: string;
}): CredentialRecord {
  const id = uuid();
  run(
    `INSERT INTO operator_credentials
       (id, operator_id, credential_type, credential_id, public_key, counter, transports, label)
     VALUES (?, ?, 'passkey', ?, ?, ?, ?, ?)`,
    [
      id,
      args.operatorId,
      args.credentialId,
      args.publicKey,
      args.counter,
      args.transports?.join(",") ?? null,
      args.label ?? null,
    ],
  );
  const row = queryOne<CredentialRecord>(
    "SELECT * FROM operator_credentials WHERE id = ?",
    [id],
  );
  if (!row) throw new Error("Failed to insert passkey credential");
  return row;
}

/** Look up a passkey by its WebAuthn credential ID — used during the
 *  authentication ceremony to fetch the public key for signature verification. */
export function findPasskeyByCredentialId(credentialId: string): CredentialRecord | null {
  return (
    queryOne<CredentialRecord>(
      `SELECT * FROM operator_credentials
       WHERE credential_type = 'passkey' AND credential_id = ?`,
      [credentialId],
    ) ?? null
  );
}

/** List an operator's passkeys for the Auth & Devices settings card. */
export function listPasskeysForOperator(operatorId: string): CredentialRecord[] {
  return queryAll<CredentialRecord>(
    `SELECT * FROM operator_credentials
     WHERE operator_id = ? AND credential_type = 'passkey'
     ORDER BY created_at DESC`,
    [operatorId],
  );
}

/** Update the WebAuthn signature counter after a successful authentication.
 *  The counter must monotonically increase — a server seeing a value <=
 *  the stored one indicates a cloned authenticator and we MUST reject. */
export function updatePasskeyCounter(credentialId: string, newCounter: number): void {
  run(
    `UPDATE operator_credentials
     SET counter = ?, last_used_at = datetime('now')
     WHERE credential_type = 'passkey' AND credential_id = ?`,
    [newCounter, credentialId],
  );
}

// ---------------------------------------------------------------------------
// GitHub link CRUD
// ---------------------------------------------------------------------------

/** Insert a GitHub identity link after a successful OAuth handshake. */
export function insertGithubLink(args: {
  operatorId: string;
  githubUserId: number;
  githubUsername: string;
}): CredentialRecord {
  const id = uuid();
  run(
    `INSERT INTO operator_credentials
       (id, operator_id, credential_type, github_user_id, github_username)
     VALUES (?, ?, 'github_link', ?, ?)`,
    [id, args.operatorId, args.githubUserId, args.githubUsername],
  );
  const row = queryOne<CredentialRecord>(
    "SELECT * FROM operator_credentials WHERE id = ?",
    [id],
  );
  if (!row) throw new Error("Failed to insert GitHub link");
  return row;
}

/** Look up the operator who owns a given GitHub user id — used during
 *  the OAuth callback to map the verified GitHub identity to a ClawNex
 *  operator. Returns null if no operator has linked this GitHub account
 *  (we do NOT auto-create operators — admin must pre-provision). */
export function findGithubLinkByUserId(githubUserId: number): CredentialRecord | null {
  return (
    queryOne<CredentialRecord>(
      `SELECT * FROM operator_credentials
       WHERE credential_type = 'github_link' AND github_user_id = ?`,
      [githubUserId],
    ) ?? null
  );
}

/** Mark a GitHub link as just-used (mirrors recordLogin for local). */
export function touchGithubLink(githubUserId: number): void {
  run(
    `UPDATE operator_credentials
     SET last_used_at = datetime('now')
     WHERE credential_type = 'github_link' AND github_user_id = ?`,
    [githubUserId],
  );
}

// ---------------------------------------------------------------------------
// Generic
// ---------------------------------------------------------------------------

/** Delete any credential by its row id. Used by the operator settings UI
 *  when the user revokes a passkey or unlinks GitHub. */
export function deleteCredential(id: string): void {
  run("DELETE FROM operator_credentials WHERE id = ?", [id]);
}

/** Delete every credential owned by an operator. Used when an admin
 *  deletes the operator account — operator_credentials has ON DELETE
 *  CASCADE, but this helper exists for explicit cleanup before delete. */
export function deleteAllCredentialsForOperator(operatorId: string): void {
  run("DELETE FROM operator_credentials WHERE operator_id = ?", [operatorId]);
}
