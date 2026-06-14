// In-memory challenge store for WebAuthn ceremonies.
//
// WebAuthn registration + authentication both require the server to:
//   1. Generate a random challenge
//   2. Send it to the browser
//   3. Verify the browser's signed response references the same challenge
//
// The challenge must survive the round-trip but expire quickly (5-min TTL
// per spec §3.3). We store keyed by a short-lived cookie value rather than
// per-operator because authentication is anonymous (resident-key flow —
// the browser picks the credential, server doesn't know who the operator
// is until verification succeeds).
//
// Single-instance only. For multi-replica deploys (post-launch concern), a
// DB-backed store keyed by the same cookie would replace this map.
//
// Spec: docs/superpowers/specs/2026-04-23-multi-auth-providers-design.md §3.3

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface StoredChallenge {
  /** The base64url-encoded challenge bytes the browser must echo back. */
  challenge: string;
  /** Timestamp when this challenge becomes invalid. */
  expiresAt: number;
  /** Optional operator id — set during registration ceremony when we know
   *  who is registering (authenticated request). NULL during anonymous
   *  authentication ceremony (we discover the operator from the credential
   *  the browser returns). */
  operatorId: string | null;
  /** Ceremony purpose — used by the verifier to reject mismatched flows
   *  (e.g. an authentication response can't satisfy a registration challenge). */
  purpose: "registration" | "authentication";
}

const store = new Map<string, StoredChallenge>();

/**
 * Store a challenge keyed by a short-lived ID. Returns the same id for
 * convenience so callers can write it into a Set-Cookie or response body.
 */
export function putChallenge(
  id: string,
  challenge: string,
  purpose: StoredChallenge["purpose"],
  operatorId: string | null = null,
): string {
  // Sweep expired entries on every write to keep the map tidy without a
  // separate timer. O(n) but n is bounded by concurrent in-flight ceremonies.
  const now = Date.now();
  store.forEach((v, k) => {
    if (v.expiresAt < now) store.delete(k);
  });
  store.set(id, {
    challenge,
    expiresAt: now + CHALLENGE_TTL_MS,
    operatorId,
    purpose,
  });
  return id;
}

/**
 * Retrieve and delete a challenge by id. Returns null if missing or expired.
 * Always one-shot — a verified challenge can never be replayed.
 */
export function takeChallenge(id: string): StoredChallenge | null {
  const entry = store.get(id);
  if (!entry) return null;
  store.delete(id);
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}

/** Test helper — clear the entire store. Production code never calls this. */
export function _clearAllChallenges(): void {
  store.clear();
}

/** Diagnostic — current in-flight challenge count. */
export function challengeStoreSize(): number {
  return store.size;
}
