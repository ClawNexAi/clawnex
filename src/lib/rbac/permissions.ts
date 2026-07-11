/**
 * ClawNex RBAC Permission Matrix.
 *
 * Maps each role to its granted permissions. Used by the guard module
 * to enforce access control on API routes.
 *
 * @module rbac/permissions
 */

import type { Role, Permission } from './types';

const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  admin: new Set<Permission>([
    'dashboard:view', 'fleet:read', 'agents:read', 'tokens:read',
    'shield:read', 'shield:scan', 'shield:config',
    'alerts:read', 'alerts:manage',
    'access_lists:read', 'access_lists:manage',
    'break_glass:activate',
    'config:read', 'config:write',
    'system:manage', 'system:purge',
    'api_keys:read', 'api_keys:manage',
    'operators:read', 'operators:manage',
    'audit:read', 'audit:clear',
    'evidence:raw',
    'reports:read', 'reports:generate', 'reports:export',
    'workspace:read', 'chat:use', 'voice:use',
    'risk:accept',
    'policies:read', 'policies:write', 'policies:test',
  ]),
  security_manager: new Set<Permission>([
    'dashboard:view', 'fleet:read', 'agents:read', 'tokens:read',
    'shield:read', 'shield:scan', 'shield:config',
    'alerts:read', 'alerts:manage',
    'access_lists:read', 'access_lists:manage',
    'break_glass:activate',
    'config:read',
    'audit:read',
    'evidence:raw',
    'reports:read', 'reports:generate', 'reports:export',
    'workspace:read', 'chat:use', 'voice:use',
    'risk:accept',
    'policies:read', 'policies:write', 'policies:test',
  ]),
  operator: new Set<Permission>([
    'dashboard:view', 'fleet:read', 'agents:read', 'tokens:read',
    'shield:read', 'shield:scan',
    'alerts:read', 'alerts:manage',
    'access_lists:read',
    'config:read',
    'audit:read',
    'reports:read', 'reports:generate',
    'workspace:read', 'chat:use', 'voice:use',
    'policies:read',
  ]),
  viewer: new Set<Permission>([
    'dashboard:view', 'fleet:read', 'agents:read', 'tokens:read',
    'shield:read', 'alerts:read', 'access_lists:read', 'config:read',
    'policies:read',
  ]),
  auditor: new Set<Permission>([
    'dashboard:view', 'tokens:read',
    'audit:read',
    'reports:read', 'reports:generate', 'reports:export',
    'policies:read',
  ]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function getPermissions(role: Role): Permission[] {
  return Array.from(ROLE_PERMISSIONS[role] || []);
}

export const ALL_ROLES: Role[] = ['admin', 'security_manager', 'operator', 'viewer', 'auditor'];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  security_manager: 'Security Manager',
  operator: 'Operator',
  viewer: 'Viewer',
  auditor: 'Auditor',
};
