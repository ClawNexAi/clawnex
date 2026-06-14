// DELETE /api/auth/github/unlink
//
// Authenticated endpoint — removes the current operator's GitHub link.
// Also clears 'github' from the operators.auth_providers CSV.

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/rbac/guard";
import { run, queryAll } from "@/lib/db/index";
import { getOperatorById } from "@/lib/services/operator-service";
import {
  parseEnrolledProviders,
  serializeEnrolledProviders,
} from "@/lib/services/auth";
import { checkRateLimit } from "@/lib/rate-limiter";
import { config } from "@/lib/config";
import { logEvent } from "@/lib/services/audit-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest) {
  const session = requireSession(request);
  if (session instanceof NextResponse) return session;

  const ip = (request as unknown as { ip?: string }).ip || "unknown";
  const rl = checkRateLimit(`gh-unlink:${ip}`, config.rbac.loginRateLimitPerMinute);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
  }

  const links = queryAll<{ id: string; github_username: string }>(
    `SELECT id, github_username FROM operator_credentials
     WHERE operator_id = ? AND credential_type = 'github_link'`,
    [session.operator.id],
  );

  if (links.length === 0) {
    return NextResponse.json({ ok: true, removed: 0 });
  }

  for (const link of links) {
    run("DELETE FROM operator_credentials WHERE id = ?", [link.id]);
  }

  const operator = getOperatorById(session.operator.id);
  if (operator) {
    const next = parseEnrolledProviders(operator.auth_providers).filter((p) => p !== "github");
    run(
      "UPDATE operators SET auth_providers = ?, updated_at = datetime('now') WHERE id = ?",
      [serializeEnrolledProviders(next), operator.id],
    );
  }

  logEvent(
    session.operator.username,
    "github_unlinked",
    "operator",
    session.operator.id,
    `Unlinked GitHub (${links.map((l) => "@" + l.github_username).join(", ")})`,
    "auth",
  );

  return NextResponse.json({ ok: true, removed: links.length });
}
