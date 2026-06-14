// Passkey (WebAuthn) auth provider.
//
// Implements the four ceremony halves the route layer composes into the
// browser-facing endpoints:
//   - registration begin   → /api/auth/passkey/register/begin
//   - registration complete → /api/auth/passkey/register/complete
//   - authentication begin → /api/auth/passkey/authenticate/begin
//   - authentication complete → /api/auth/passkey/authenticate/complete
//
// Stateful pieces (challenges + stored credentials) live in challenge-store.ts
// and credentials-service.ts respectively — this module is the bridge
// between @simplewebauthn/server and our storage.
//
// Resident-key (discoverable credential) flow: the *authentication* ceremony
// does NOT take a username. The browser picks the credential, signs the
// challenge, and we look up the operator from the credential's stored
// operator_id. This is the modern UX (browser pops "Sign in with passkey"
// without a username field), and it's why the challenge store is keyed
// by an anonymous session cookie rather than operator id.
//
// Spec: docs/superpowers/specs/2026-04-23-multi-auth-providers-design.md §3.2

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";

import { config } from "../../../config";
import { putChallenge, takeChallenge } from "../challenge-store";
import {
  insertPasskey,
  findPasskeyByCredentialId,
  listPasskeysForOperator,
  updatePasskeyCounter,
  type CredentialRecord,
} from "../credentials-service";
import { getOperatorById } from "../../operator-service";
import type { AuthResult } from "..";

const RP_ID = config.auth.rpID;
const RP_NAME = config.auth.rpName;
// NOTE: `expectedOrigin` is intentionally NOT captured here. config.ts allows
// AUTH_EXPECTED_ORIGIN to be empty so that `publicOrigin(request)` can fall
// back to the request's own origin in dev. If we cached an empty string at
// module load and passed it straight to WebAuthn's verifier, every passkey
// ceremony would fail with "origin mismatch" on hosts that didn't set the
// env var. Callers must pass `expectedOrigin` (typically via publicOrigin()).

// ---------------------------------------------------------------------------
// Registration ceremony
// ---------------------------------------------------------------------------

/**
 * Generate registration options for an authenticated operator. The route
 * caller is responsible for confirming the request is authenticated
 * (you can't register a passkey for someone else) and for storing the
 * returned challengeId in a short-lived cookie.
 *
 * Excludes already-registered credential IDs so the browser won't let
 * the operator enroll the same authenticator twice.
 */
export async function buildRegistrationOptions(
  operatorId: string,
  username: string,
): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string }> {
  const existing = listPasskeysForOperator(operatorId);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: username,
    userID: new TextEncoder().encode(operatorId),
    attestationType: "none",
    excludeCredentials: existing
      .filter((c) => c.credential_id)
      .map((c) => ({
        id: c.credential_id as string,
        transports: c.transports
          ? (c.transports.split(",") as AuthenticatorTransportFuture[])
          : undefined,
      })),
    authenticatorSelection: {
      residentKey: "preferred",
      // UV required for a security-focused admin dashboard — accepting a
      // passkey signature without PIN/biometric would let a stolen hardware
      // key authenticate as the operator (adversarial review finding #2,
      // 2026-04-24). Modern platform authenticators (Touch ID, Windows Hello,
      // YubiKey 5 with PIN) satisfy this automatically; legacy keys without
      // UV support won't enroll. Acceptable trade-off for an admin flow.
      userVerification: "required",
    },
  });

  const challengeId = newChallengeId();
  putChallenge(challengeId, options.challenge, "registration", operatorId);

  return { options, challengeId };
}

/**
 * Verify the browser's registration response and persist the new credential.
 * Returns the stored credential row on success or a structured failure.
 */
export async function completeRegistration(args: {
  challengeId: string;
  response: RegistrationResponseJSON;
  expectedOrigin: string;
  label?: string;
}): Promise<
  | { ok: true; credential: CredentialRecord }
  | { ok: false; error: string }
> {
  const stored = takeChallenge(args.challengeId);
  if (!stored || stored.purpose !== "registration") {
    return { ok: false, error: "Challenge expired or not found" };
  }
  if (!stored.operatorId) {
    return { ok: false, error: "Registration challenge missing operator binding" };
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: args.response,
      expectedChallenge: stored.challenge,
      expectedOrigin: args.expectedOrigin,
      expectedRPID: RP_ID,
      // Enforce UV bit at verify time to match the "required" hint in
      // options. Pairs with the authenticatorSelection setting above.
      requireUserVerification: true,
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: "Registration verification failed" };
  }

  const { credential } = verification.registrationInfo;

  const stored2 = insertPasskey({
    operatorId: stored.operatorId,
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports,
    label: args.label,
  });

  return { ok: true, credential: stored2 };
}

// ---------------------------------------------------------------------------
// Authentication ceremony
// ---------------------------------------------------------------------------

/**
 * Generate authentication options for the resident-key flow. No username
 * required — the browser will surface enrolled passkeys for this RP and
 * the user picks one.
 */
export async function buildAuthenticationOptions(): Promise<{
  options: PublicKeyCredentialRequestOptionsJSON;
  challengeId: string;
}> {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    // Match the registration policy — UV is required on every sign-in, not
    // just enrollment. A credential enrolled with UV can be re-presented
    // without UV by a stolen key; requiring UV at auth time too ensures
    // proof-of-possession alone never satisfies the admin flow.
    userVerification: "required",
  });

  const challengeId = newChallengeId();
  putChallenge(challengeId, options.challenge, "authentication", null);

  return { options, challengeId };
}

/**
 * Verify the browser's authentication response, increment the stored
 * counter, and resolve to the operator identity. The route turns the
 * AuthSuccess into a session cookie.
 *
 * Counter check: WebAuthn requires the new counter to be strictly greater
 * than the stored value (or both 0). A regression indicates a cloned
 * authenticator and we MUST refuse — verifyAuthenticationResponse handles
 * this internally and throws/returns verified=false on violation.
 */
export async function completeAuthentication(args: {
  challengeId: string;
  response: AuthenticationResponseJSON;
  expectedOrigin: string;
}): Promise<AuthResult> {
  const stored = takeChallenge(args.challengeId);
  if (!stored || stored.purpose !== "authentication") {
    return {
      ok: false,
      failure: { error: "Challenge expired or not found", code: "challenge_expired" },
    };
  }

  const credential = findPasskeyByCredentialId(args.response.id);
  if (!credential || !credential.credential_id || !credential.public_key) {
    return {
      ok: false,
      failure: { error: "Credential not registered", code: "invalid_credentials" },
    };
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: args.response,
      expectedChallenge: stored.challenge,
      expectedOrigin: args.expectedOrigin,
      expectedRPID: RP_ID,
      credential: {
        id: credential.credential_id,
        publicKey: isoBase64URL.toBuffer(credential.public_key),
        counter: credential.counter ?? 0,
        transports: credential.transports
          ? (credential.transports.split(",") as AuthenticatorTransportFuture[])
          : undefined,
      },
      // See registration path — UV enforced at verify time for admin safety.
      requireUserVerification: true,
    });
  } catch (err) {
    return {
      ok: false,
      failure: { error: (err as Error).message, code: "invalid_credentials" },
    };
  }

  if (!verification.verified) {
    return {
      ok: false,
      failure: { error: "Authentication failed", code: "invalid_credentials" },
    };
  }

  updatePasskeyCounter(
    credential.credential_id,
    verification.authenticationInfo.newCounter,
  );

  const operator = getOperatorById(credential.operator_id);
  if (!operator || !operator.is_active) {
    return {
      ok: false,
      failure: { error: "Operator not found or disabled", code: "user_disabled" },
    };
  }

  return {
    ok: true,
    data: {
      operatorId: operator.id,
      username: operator.username,
      role: operator.role,
      provider: "passkey",
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a short cookie-safe id for keying the in-memory challenge store. */
function newChallengeId(): string {
  // 16 bytes of randomness — base64url'd, no padding. Plenty of entropy
  // for a 5-minute-window cookie value.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return isoBase64URL.fromBuffer(bytes);
}
