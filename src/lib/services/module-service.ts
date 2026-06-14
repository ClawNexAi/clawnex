/**
 * ClawNex Module Toggle Service
 *
 * Manages which dashboard modules (tabs) are enabled or disabled.
 * Enterprise operators can toggle modules on/off to customize the
 * sidebar navigation for their deployment.
 *
 * - Core modules (fleet, infrastructure, configuration) cannot be disabled.
 * - Some modules have dependency relationships — disabling a parent
 *   module returns a warning about affected dependents.
 * - Module state is persisted in config_defaults as `module_{tabId}_enabled`.
 * - All modules default to enabled ("true") when no config entry exists.
 *
 * @module services/module-service
 */

import { getSetting, setSetting } from './config-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All valid tab identifiers in the ClawNex dashboard. */
export type TabId =
  | "fleet"
  | "instance"
  | "correlations"
  | "securityPosture"
  | "shield"
  | "shieldTests"
  | "accessControl"
  | "agents"
  | "workspace"
  | "tokenCost"
  | "toolsAccess"
  | "modelsCost"
  | "infrastructure"
  | "alertsIncidents"
  | "auditEvidence"
  | "executiveReports"
  | "accessLists"
  | "trafficMonitor"
  | "configuration";

/** All known tab IDs for iteration. */
const ALL_TABS: TabId[] = [
  "fleet", "instance", "correlations", "securityPosture",
  "shield", "shieldTests", "accessControl", "agents",
  "workspace", "tokenCost", "toolsAccess",
  "modelsCost", "infrastructure", "alertsIncidents", "auditEvidence",
  "executiveReports", "accessLists", "trafficMonitor", "configuration",
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Core modules that cannot be disabled by operators. */
const CORE_MODULES: TabId[] = ["fleet", "infrastructure", "configuration"];

/**
 * Dependency map: disabling the key module affects the listed dependents.
 * The dependents still function independently, but a warning is surfaced
 * so operators understand the relationship.
 */
const MODULE_DEPS: Partial<Record<TabId, TabId[]>> = {
  shield: ["shieldTests", "trafficMonitor"],
  agents: ["workspace", "tokenCost"],
  accessControl: ["accessLists"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the config_defaults key used to store a module's enabled state. */
function moduleKey(tabId: TabId): string {
  return `module_${tabId}_enabled`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads the enabled/disabled state of every dashboard module from
 * config_defaults. Modules without a stored value default to enabled.
 *
 * @returns A record mapping each TabId to its enabled boolean.
 */
export function getEnabledModules(): Record<TabId, boolean> {
  const result = {} as Record<TabId, boolean>;
  for (const tabId of ALL_TABS) {
    const val = getSetting(moduleKey(tabId));
    // Default to true if no setting exists
    result[tabId] = val !== "false";
  }
  return result;
}

/**
 * Enables or disables a dashboard module.
 *
 * Core modules (fleet, infrastructure, configuration) cannot be disabled.
 * If the module has dependents defined in MODULE_DEPS, a warning is
 * returned listing those dependents.
 *
 * @param tabId  - The module to toggle.
 * @param enabled - Whether the module should be enabled.
 * @returns An object with `success` and an optional `warning` string.
 */
export function setModuleEnabled(
  tabId: TabId,
  enabled: boolean
): { success: boolean; warning?: string } {
  // Refuse to disable core modules
  if (!enabled && CORE_MODULES.includes(tabId)) {
    return {
      success: false,
      warning: `Cannot disable core module "${tabId}". Core modules (${CORE_MODULES.join(", ")}) are always enabled.`,
    };
  }

  setSetting(moduleKey(tabId), String(enabled));

  // If disabling, check for dependents and warn
  if (!enabled) {
    const dependents = MODULE_DEPS[tabId];
    if (dependents && dependents.length > 0) {
      return {
        success: true,
        warning: `Disabling "${tabId}" may affect dependent modules: ${dependents.join(", ")}. Consider disabling them as well.`,
      };
    }
  }

  return { success: true };
}

/**
 * Returns the list of modules that depend on the given module.
 *
 * @param tabId - The module to look up dependents for.
 * @returns An array of TabIds that depend on the given module.
 */
export function getModuleDependencies(tabId: TabId): TabId[] {
  return MODULE_DEPS[tabId] || [];
}

/**
 * Quick check for whether a single module is enabled.
 *
 * @param tabId - The module to check.
 * @returns `true` if the module is enabled (or has no stored setting).
 */
export function isModuleEnabled(tabId: TabId): boolean {
  const val = getSetting(moduleKey(tabId));
  return val !== "false";
}

/**
 * Returns the list of core module IDs that cannot be disabled.
 */
export function getCoreModules(): TabId[] {
  return [...CORE_MODULES];
}

/**
 * Returns all known tab IDs.
 */
export function getAllTabIds(): TabId[] {
  return [...ALL_TABS];
}
