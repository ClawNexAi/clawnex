/**
 * GET /api/config/modules — list all modules with enabled state, core flag, and dependents
 * PUT /api/config/modules — enable or disable a module { tabId, enabled }
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import {
  getEnabledModules,
  setModuleEnabled,
  getModuleDependencies,
  getCoreModules,
  getAllTabIds,
} from '@/lib/services/module-service';
import type { TabId } from '@/lib/services/module-service';
import { logEvent } from '@/lib/services/audit-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    const enabled = getEnabledModules();
    const coreModules = getCoreModules();
    const allTabs = getAllTabIds();

    const TAB_LABELS: Record<string, string> = {
      fleet: "Fleet Command", instance: "Instance Detail", correlations: "Correlations",
      securityPosture: "Security Posture", shield: "Prompt Shield", shieldTests: "Shield Tests",
      accessControl: "Access Control", agents: "Agents & Sessions", workspace: "Agent Workspace",
      tokenCost: "Token & Cost Intel", toolsAccess: "Tools & Access",
      modelsCost: "Models & Cost", infrastructure: "Infrastructure", alertsIncidents: "Alerts & Incidents",
      auditEvidence: "Audit & Evidence", executiveReports: "Executive Reports", accessLists: "Access Lists",
      trafficMonitor: "Traffic Monitor", configuration: "Configuration",
    };

    const modules: Record<string, { label: string; enabled: boolean; core: boolean; dependents: TabId[] }> = {};

    for (const tabId of allTabs) {
      modules[tabId] = {
        label: TAB_LABELS[tabId] || tabId,
        enabled: enabled[tabId],
        core: coreModules.includes(tabId),
        dependents: getModuleDependencies(tabId),
      };
    }

    return NextResponse.json({ modules });
  } catch (err) {
    console.error('[Modules API] Error getting modules:', err);
    return NextResponse.json({ error: 'Failed to get modules' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
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
    const { tabId, enabled } = body as { tabId?: string; enabled?: boolean };

    if (!tabId || typeof tabId !== 'string') {
      return NextResponse.json({ error: 'Expected { tabId: string, enabled: boolean }' }, { status: 400 });
    }

    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'Expected { tabId: string, enabled: boolean }' }, { status: 400 });
    }

    // Validate tabId is a known module
    const allTabs = getAllTabIds();
    if (!allTabs.includes(tabId as TabId)) {
      return NextResponse.json({ error: `Unknown module: ${tabId}` }, { status: 400 });
    }

    const result = setModuleEnabled(tabId as TabId, enabled);

    if (result.success) {
      logEvent(
        'operator',
        enabled ? 'module_enabled' : 'module_disabled',
        'module',
        tabId,
        `Module "${tabId}" ${enabled ? 'enabled' : 'disabled'}${result.warning ? ` — ${result.warning}` : ''}`,
        'dashboard'
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[Modules API] Error setting module:', err);
    return NextResponse.json({ error: 'Failed to update module' }, { status: 500 });
  }
}
