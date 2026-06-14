// POST /api/auth/passkey/register/complete
//
// Authenticated endpoint — verifies the browser's attestation response
// and persists the new passkey credential row. Marks 'passkey' as an
// enrolled provider on the operator if it wasn't already.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/rbac/guard";
import { completeRegistration } from "@/lib/services/auth/providers/passkey";
import { run } from "@/lib/db/index";
import { getOperatorById } from "@/lib/services/operator-service";
import {
  parseEnrolledProviders,
  serializeEnrolledProviders,
  publicOrigin,
} from "@/lib/services/auth";
import { logEvent } from "@/lib/services/audit-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHALLENGE_COOKIE = "clawnex_passkey_chal";

export async function POST(request: NextRequest) {
  const session = requireSession(request);
  if (session instanceof NextResponse) return session;

  const challengeId = request.cookies.get(CHALLENGE_COOKIE)?.value;
  if (!challengeId) {
    return NextResponse.json(
      { error: "Missing or expired challenge cookie" },
      { status: 400 },
    );
  }

  try {
    const body = await request.json();
    const { response: attestation, label } = body;
    if (!attestation) {
      return NextResponse.json(
        { error: "Missing 'response' field" },
        { status: 400 },
      );
    }

    const result = await completeRegistration({
      challengeId,
      response: attestation,
      label: typeof label === "string" ? label.slice(0, 80) : undefined,
      // Use the canonical public origin (AUTH_EXPECTED_ORIGIN env) or fall
      // back to the request origin in dev. Was previously captured as ''
      // at module load when env was unset → WebAuthn rejected every passkey.
      expectedOrigin: publicOrigin(request),
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Mark 'passkey' as enrolled if not already on the operator's CSV list.
    const operator = getOperatorById(session.operator.id);
    if (operator) {
      const current = parseEnrolledProviders(operator.auth_providers);
      if (!current.includes("passkey")) {
        const next = serializeEnrolledProviders([...current, "passkey"]);
        run(
          "UPDATE operators SET auth_providers = ?, updated_at = datetime('now') WHERE id = ?",
          [next, operator.id],
        );
      }
    }

    logEvent(
      session.operator.username,
      "passkey_enrolled",
      "operator",
      session.operator.id,
      `Passkey enrolled (label="${result.credential.label ?? "unnamed"}")`,
      "auth",
    );

    const ok = NextResponse.json({
      ok: true,
      credentialId: result.credential.id,
    });
    // Clear the challenge cookie regardless of outcome.
    ok.cookies.delete(CHALLENGE_COOKIE);
    return ok;
  } catch (err) {
    console.error("[passkey/register/complete]", err);
    return NextResponse.json(
      { error: "Failed to complete registration" },
      { status: 500 },
    );
  }
}
