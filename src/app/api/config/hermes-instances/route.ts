/**
 * Hermes Instances API
 * GET  /api/config/hermes-instances — list all Hermes instances
 * POST /api/config/hermes-instances — add a new Hermes instance
 * DELETE /api/config/hermes-instances?id=xxx — remove a Hermes instance
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { queryAll, queryOne, run } from "@/lib/db/index";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { logEvent } from "@/lib/services/audit-logger";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { diagnoseHermes } from "@/lib/services/hermes-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HermesInstanceRow {
  id: string;
  name: string;
  home_path: string;
  is_active: number;
  status: string;
  last_checked_at: string | null;
  last_error: string | null;
  session_count: number;
  created_at: string;
  updated_at: string;
}

function resolveHermesHomePath(homePath: string): { ok: true; path: string } | { ok: false; error: string } {
  const trimmed = homePath.trim();
  if (!trimmed) return { ok: false, error: "Home path is required" };

  const expanded = trimmed === "~"
    ? os.homedir()
    : trimmed.startsWith("~/")
      ? path.join(os.homedir(), trimmed.slice(2))
      : trimmed;
  const resolved = path.resolve(expanded);
  const home = path.resolve(os.homedir());

  if (resolved !== home && !resolved.startsWith(home + path.sep)) {
    return { ok: false, error: "Hermes home path must be inside this user's home directory" };
  }

  return { ok: true, path: resolved };
}

function resolveRealHermesHomePath(homePath: string): { ok: true; path: string } | { ok: false; error: string } {
  const pathResult = resolveHermesHomePath(homePath);
  if (!pathResult.ok) return pathResult;

  try {
    const realPath = fs.realpathSync(pathResult.path);
    const realHome = fs.realpathSync(os.homedir());
    if (realPath !== realHome && !realPath.startsWith(realHome + path.sep)) {
      return { ok: false, error: "Hermes home path must resolve inside this user's home directory" };
    }
    return { ok: true, path: realPath };
  } catch {
    return { ok: true, path: pathResult.path };
  }
}

function checkHermesPath(homePath: string): { available: boolean; error?: string; diagnostics?: ReturnType<typeof diagnoseHermes> } {
  const pathResult = resolveRealHermesHomePath(homePath);
  if (!pathResult.ok) return { available: false, error: pathResult.error };
  const resolved = pathResult.path;
  const diagnostics = diagnoseHermes(resolved);
  return {
    available: diagnostics.available,
    error: diagnostics.available ? undefined : diagnostics.statusDetail || diagnostics.status,
    diagnostics,
  };
}

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const instances = queryAll<HermesInstanceRow>(
      "SELECT * FROM hermes_instances ORDER BY created_at ASC"
    );

    // Check status for each instance
    const enriched = instances.map(inst => {
      const check = checkHermesPath(inst.home_path);
      return {
        ...inst,
        available: check.available,
        statusDetail: check.error || null,
        diagnostics: check.diagnostics || null,
      };
    });

    return NextResponse.json({ instances: enriched, total: enriched.length });
  } catch (err) {
    console.error("[API/hermes-instances] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:write');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    const { name, homePath } = body as { name?: string; homePath?: string };

    if (!name?.trim() || !homePath?.trim()) {
      return NextResponse.json({ error: "Name and home path are required" }, { status: 400 });
    }

    const pathResult = resolveHermesHomePath(homePath);
    if (!pathResult.ok) {
      return NextResponse.json({ error: pathResult.error }, { status: 400 });
    }
    const resolved = pathResult.path;
    const check = checkHermesPath(resolved);

    const existing = queryOne<HermesInstanceRow>(
      "SELECT * FROM hermes_instances WHERE home_path = ?",
      [resolved]
    );
    if (existing) {
      return NextResponse.json({
        error: "Hermes instance already exists for this home path",
        instance: {
          id: existing.id,
          name: existing.name,
          homePath: existing.home_path,
          status: existing.status,
        },
      }, { status: 409 });
    }

    const id = `hermes-${Date.now()}`;

    run(
      `INSERT INTO hermes_instances (id, name, home_path, is_active, status) VALUES (?, ?, ?, 1, ?)`,
      [id, name.trim(), resolved, check.available ? "connected" : "error"]
    );

    if (!check.available) {
      run("UPDATE hermes_instances SET last_error = ? WHERE id = ?", [check.error || "Unknown", id]);
    }

    logEvent("operator", "hermes_instance_added", "hermes", "dashboard", `Added Hermes instance "${name.trim()}" at ${resolved}`);

    return NextResponse.json({
      ok: true,
      instance: {
        id,
        name: name.trim(),
        homePath: resolved,
        status: check.available ? "connected" : "error",
        available: check.available,
        error: check.error,
        diagnostics: check.diagnostics || null,
      },
    }, { status: 201 });
  } catch (err) {
    console.error("[API/hermes-instances] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:write');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });

    const existing = queryOne<HermesInstanceRow>("SELECT * FROM hermes_instances WHERE id = ?", [id]);
    if (!existing) return NextResponse.json({ error: "Instance not found" }, { status: 404 });

    run("DELETE FROM hermes_instances WHERE id = ?", [id]);
    logEvent("operator", "hermes_instance_removed", "hermes", "dashboard", `Removed Hermes instance "${existing.name}" (${existing.home_path})`);

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[API/hermes-instances] DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
