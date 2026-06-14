/**
 * Trust Boundary + Blast Radius Audit
 *
 * Public API surface for the trust audit system.
 */

export { runTrustAudit } from './engine';
export { AUDIT_RULES } from './rules';
export { buildAuditContext } from './discovery';
export type {
  AuditReport,
  Finding,
  Severity,
  Surface,
  Agent,
  Capability,
  SensitiveAssetHint,
  AuditRule,
  AuditContext,
  MatrixEntry,
  RemediationItem,
} from './types';
