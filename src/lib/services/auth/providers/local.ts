// Local password auth provider — wraps operator-service password verification
// behind the shared AuthResult contract.
//
// This is the *break-glass* provider: it must remain available on every
// operator account so a lost passkey or unreachable GitHub doesn't lock
// people out. Bootstrap operators (created from CONFIG_TOKEN before any
// other provider is enrolled) only have local credentials.
//
// Policy concerns (rate-limit, lockout, audit, session) live in the
// /api/auth/login route — this module is intentionally small and just
// answers "is this username/password pair valid?". That keeps the route's
// security policy in one place even as new providers are added.
//
// Spec: docs/superpowers/specs/2026-04-23-multi-auth-providers-design.md §3.1

import {
  getOperatorByUsername,
  verifyPassword,
} from "../../operator-service";
import type { AuthResult } from "..";

/** Pre-computed bcrypt hash (12 rounds) used for the timing-safe dummy
 *  comparison when the username doesn't exist. Mirrors the constant in
 *  the login route — kept in both places so neither relies on the other
 *  to dodge user-enumeration timing attacks. */
const DUMMY_HASH = "$2a$12$LJ3m4ys3PweVGHBkgDJp4e4F3ELcUqoJZPfCxWO7FM/W/RCa3MNKS";

export interface LocalCredentials {
  username: string;
  password: string;
}

/**
 * Verify a username/password pair against the operators table. Always
 * runs bcrypt regardless of whether the user exists, so failure timing
 * doesn't reveal account existence.
 *
 * Returns a generic invalid_credentials failure for *all* credential-class
 * problems (missing user, wrong password, disabled account). The caller
 * decides whether to apply lockout penalties — typically yes for these
 * codes, no for provider_not_enrolled.
 */
export function authenticateLocal(creds: LocalCredentials): AuthResult {
  const operator = getOperatorByUsername(creds.username);

  const passwordValid = operator
    ? verifyPassword(creds.password, operator.password_hash)
    : verifyPassword(creds.password, DUMMY_HASH);

  if (!operator || !operator.is_active || !passwordValid) {
    return {
      ok: false,
      failure: { error: "Invalid credentials", code: "invalid_credentials" },
    };
  }

  return {
    ok: true,
    data: {
      operatorId: operator.id,
      username: operator.username,
      role: operator.role,
      provider: "local",
    },
  };
}
