/**
 * ClawNex RBAC Type Definitions.
 *
 * Roles, permissions, and record shapes for the operator identity system.
 *
 * @module rbac/types
 */

export type Role = 'admin' | 'security_manager' | 'operator' | 'viewer' | 'auditor';

export type Permission =
  | 'dashboard:view' | 'fleet:read' | 'agents:read' | 'tokens:read'
  | 'shield:read' | 'shield:scan' | 'shield:config'
  | 'alerts:read' | 'alerts:manage'
  | 'access_lists:read' | 'access_lists:manage'
  | 'break_glass:activate'
  | 'config:read' | 'config:write'
  | 'system:manage' | 'system:purge'
  | 'api_keys:read' | 'api_keys:manage'
  | 'operators:read' | 'operators:manage'
  | 'audit:read' | 'audit:clear'
  | 'reports:read' | 'reports:generate' | 'reports:export'
  | 'workspace:read' | 'chat:use' | 'voice:use'
  | 'risk:accept'
  | 'policies:read' | 'policies:write' | 'policies:test';

export interface OperatorRecord {
  id: string;
  username: string;
  display_name: string | null;
  email: string | null;
  password_hash: string;
  role: Role;
  is_active: number;
  last_login_at: string | null;
  login_count: number;
  failed_login_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** CSV of provider names this operator has enrolled — see services/auth.
   *  Defaults to "local" for accounts created before v0.9.0. */
  auth_providers: string;
}

export interface SessionRecord {
  id: string;
  operator_id: string;
  token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
}

export interface AuthenticatedOperator {
  id: string;
  username: string;
  displayName: string | null;
  role: Role;
}
