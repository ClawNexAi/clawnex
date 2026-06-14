/**
 * Access Lists API
 * GET    /api/access-lists -- list all access list entries
 * POST   /api/access-lists -- add a new entry
 * DELETE /api/access-lists -- remove an entry by id
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { queryAll, run } from "@/lib/db/index";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AccessListEntry {
  id: string;
  list_type: string;
  entry_type: string;
  value: string;
  reason: string | null;
  added_by: string | null;
  created_at: string;
}

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'access_lists:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { searchParams } = new URL(request.url);
    const listType = searchParams.get("list_type"); // "allow" | "deny"
    const entryType = searchParams.get("entry_type"); // "IP" | "DOMAIN" | "USER"

    let sql = "SELECT * FROM access_lists";
    const params: string[] = [];
    const conditions: string[] = [];

    if (listType) {
      conditions.push("list_type = ?");
      params.push(listType);
    }
    if (entryType) {
      conditions.push("entry_type = ?");
      params.push(entryType);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY created_at DESC";

    const entries = queryAll<AccessListEntry>(sql, params);

    return NextResponse.json({
      entries,
      count: entries.length,
    });
  } catch (err) {
    console.error("[API /access-lists GET] Error:", err);
    return NextResponse.json({ error: "Failed to fetch access lists" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'access_lists:manage');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    const { list_type, entry_type, value, reason } = body as {
      list_type?: string;
      entry_type?: string;
      value?: string;
      reason?: string;
    };

    if (!list_type || !entry_type || !value) {
      return NextResponse.json(
        { error: "Missing required fields: list_type, entry_type, value" },
        { status: 400 },
      );
    }

    if (!["allow", "deny"].includes(list_type)) {
      return NextResponse.json({ error: "list_type must be 'allow' or 'deny'" }, { status: 400 });
    }

    if (!["IP", "DOMAIN", "USER"].includes(entry_type)) {
      return NextResponse.json({ error: "entry_type must be 'IP', 'DOMAIN', or 'USER'" }, { status: 400 });
    }

    const id = randomUUID();
    run(
      `INSERT INTO access_lists (id, list_type, entry_type, value, reason, added_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, list_type, entry_type, value, reason || null, getOperatorFromRequest(request)?.username || "operator", new Date().toISOString()],
    );

    return NextResponse.json({ id, list_type, entry_type, value, reason });
  } catch (err) {
    console.error("[API /access-lists POST] Error:", err);
    return NextResponse.json({ error: "Failed to add access list entry" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'access_lists:manage');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing 'id' parameter" }, { status: 400 });
    }

    run("DELETE FROM access_lists WHERE id = ?", [id]);

    return NextResponse.json({ deleted: id });
  } catch (err) {
    console.error("[API /access-lists DELETE] Error:", err);
    return NextResponse.json({ error: "Failed to delete access list entry" }, { status: 500 });
  }
}
