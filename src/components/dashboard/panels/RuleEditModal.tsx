"use client";

/**
 * RuleEditModal — Stage 6 authoring affordance for individual policy rules.
 *
 * Two modes:
 *   - create: POST   /api/policies/[id]/rules            (add a rule to a custom policy)
 *   - edit:   PATCH  /api/policies/[id]/rules/[ruleId]   (modify an existing custom rule)
 *
 * Vendor rules (rules whose parent policy.source !== 'custom') do NOT open this
 * modal. The card-side disables the per-row [EDIT] button and hides the
 * [+ Add Rule] affordance entirely on vendor policies; this modal is a
 * second guard — see the early-return below.
 *
 * Visual idiom mirrors PolicyEditModal (PoliciesAndRulesCard.tsx wired Task 18):
 * fixed overlay with click-to-close backdrop, click-stop on the inner card,
 * Escape-to-cancel keyboard handler, and the same C.pnl / C.brd / C.danger
 * palette. Field-scoped error slots follow the same shape so the dashboard
 * reads as one coherent surface.
 *
 * The [Test Pattern] button (Task 20) opens PolicyTestModal — operator
 * probes sample text against the policy's saved rules. Permission gating
 * mirrors the /api/auth/me role-fetch idiom already used by
 * ConfigurationPanel for the operator-management card: if RBAC is on and
 * the operator's role lacks policies:test, the button is hidden entirely
 * (admin + security_manager only — see src/lib/rbac/permissions.ts). If
 * RBAC is off (single-operator install, /api/auth/me returns id='system'),
 * the button stays visible — the API's localhost guard is the gate.
 *
 * Spec §3.8.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { C, F } from '../constants';
import type { Policy, PolicyRule, RuleAction, RuleDirection } from '@/lib/shield/types';
import { PolicyTestModal } from './PolicyTestModal';

export type RuleEditMode =
  | { kind: 'create'; policy: Policy }
  | { kind: 'edit'; policy: Policy; rule: PolicyRule };

interface Props {
  mode: RuleEditMode;
  onClose: () => void;
  /** Called after a successful save so the parent card can refetch the rule list. */
  onSaved: () => void;
}

type SeverityValue = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

// Friendly action labels (spec §3.8). Submit value is the lowercase key —
// the API rejects anything outside this set since Round-3 type lockdown.
const ACTION_LABELS: Record<RuleAction, string> = {
  score:  'Score (count toward verdict)',
  block:  'Block on match',
  review: 'Review on match',
  redact: 'Redact match in output',
  allow:  'Allow (suppress detection)',
};

const SEVERITY_OPTIONS: SeverityValue[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const ACTION_OPTIONS: RuleAction[] = ['score', 'block', 'review', 'redact', 'allow'];

export function RuleEditModal({ mode, onClose, onSaved }: Props) {
  // Defensive second guard — neither create nor edit applies to vendor
  // policies (the API would 403 anyway). Card-side already disables the
  // affordance, but fail closed if some future caller wires this wrong.
  if (mode.policy.source !== 'custom') {
    return null;
  }

  const isEdit = mode.kind === 'edit';
  const initial = isEdit ? mode.rule : null;

  // SSR-safe portal mount guard.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [name, setName] = useState(initial?.name ?? '');
  const [pattern, setPattern] = useState(initial?.pattern ?? '');
  const [isRegex, setIsRegex] = useState(initial?.is_regex ?? false);
  const [flags, setFlags] = useState(initial?.flags ?? '');
  // Direction is stored as two booleans in the form (UX: checkboxes per spec)
  // and joined to the API enum at submit time. Both → 'both', either alone →
  // that value, neither → save disabled with validation message.
  const initialDirection: RuleDirection = initial?.direction ?? 'outbound';
  const [inbound, setInbound] = useState(initialDirection === 'inbound' || initialDirection === 'both');
  const [outbound, setOutbound] = useState(initialDirection === 'outbound' || initialDirection === 'both');
  const [severity, setSeverity] = useState<SeverityValue>(initial?.severity ?? 'MEDIUM');
  const [action, setAction] = useState<RuleAction>(initial?.action ?? 'score');
  const [exceptions, setExceptions] = useState(initial?.exceptions ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  // Advanced toggle hides the rarely-used `flags` field by default. Most
  // operators won't need to set regex flags; surfacing them only on demand
  // keeps the default form approachable. Open by default if editing a rule
  // that already has flags so the operator can see what they're inheriting.
  const [showAdvanced, setShowAdvanced] = useState(Boolean(initial?.flags));

  const [saving, setSaving] = useState(false);
  // Field-scoped errors so we can render them inline beneath the offending
  // input. `general` covers network errors and unexpected non-field failures.
  const [nameError, setNameError] = useState<string | null>(null);
  const [patternError, setPatternError] = useState<string | null>(null);
  const [directionError, setDirectionError] = useState<string | null>(null);
  const [severityError, setSeverityError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Test Pattern (Task 20) — null until /api/auth/me settles. We deliberately
  // don't render the button until then so the affordance doesn't flash visible
  // → hidden for non-permitted operators. The roles granted policies:test are
  // admin + security_manager (see src/lib/rbac/permissions.ts:27,40); when RBAC
  // is disabled (id='system') we keep the button visible — the API's localhost
  // guard is the operative gate in that mode.
  const [canTest, setCanTest] = useState<boolean | null>(null);
  const [testOpen, setTestOpen] = useState(false);

  // Auto-focus the name field ONCE on open. Empty deps — must not re-fire
  // on parent re-renders or every keystroke in another field re-focuses Name
  // and the cursor jumps back (parent passes onClose as an inline arrow, so
  // [onClose] deps would re-fire every render).
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  // Escape-to-close — separate effect so focus stays put across re-renders.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // One-shot permission probe. Mirrors the ConfigurationPanel idiom:
  // GET /api/auth/me, treat id='system' as "RBAC off, allow", otherwise
  // gate by role. Failure closes the door (canTest=false) — the worst
  // case is a missing button, not an exposed affordance.
  useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        const r = await fetch('/api/auth/me');
        if (!r.ok) { if (!cancelled) setCanTest(false); return; }
        const me = await r.json();
        if (cancelled) return;
        if (me?.id === 'system') {
          // RBAC disabled — let the localhost-guard on the API decide.
          setCanTest(true);
          return;
        }
        setCanTest(me?.role === 'admin' || me?.role === 'security_manager');
      } catch {
        if (!cancelled) setCanTest(false);
      }
    }
    void probe();
    return () => { cancelled = true; };
  }, []);

  const trimmedName = name.trim();
  const trimmedPattern = pattern.trim();
  const directionOk = inbound || outbound;
  const canSave = trimmedName.length > 0 && trimmedPattern.length > 0 && directionOk && !saving;

  function clearFieldErrors() {
    setNameError(null);
    setPatternError(null);
    setDirectionError(null);
    setSeverityError(null);
    setActionError(null);
    setGeneralError(null);
  }

  // Map the joined-API direction enum from the two checkbox booleans.
  // Caller must guarantee directionOk before invoking — this is only
  // reached after canSave gating.
  function joinDirection(): RuleDirection {
    if (inbound && outbound) return 'both';
    if (inbound) return 'inbound';
    return 'outbound';
  }

  // Map an API error response onto the appropriate field slot.
  // Code-aware copy for safe-regex2 rejections (UNSAFE / BAD_SYNTAX /
  // TOO_LONG); name slot for rule_key conflicts (rule_key is auto-derived
  // from name, so the operator's lever is the name field). Other 400
  // errors get routed by keyword to the relevant input.
  function applyApiError(status: number, errMsg: string, code: string | undefined) {
    if (status === 409) {
      setNameError('A rule with this name already exists in the policy.');
      return;
    }
    if (code === 'UNSAFE') {
      setPatternError('Pattern flagged as catastrophic backtracking risk. Simplify or use a literal substring instead.');
      return;
    }
    if (code === 'BAD_SYNTAX') {
      setPatternError(`Invalid regex syntax: ${errMsg}`);
      return;
    }
    if (code === 'TOO_LONG') {
      setPatternError('Pattern exceeds 1024-character limit');
      return;
    }
    if (/rule_key/i.test(errMsg)) {
      setNameError(
        "Rule name must contain at least one letter. Provide a name like 'block-secret' or supply an explicit rule_key.",
      );
      return;
    }
    if (/\bdirection\b/i.test(errMsg)) {
      setDirectionError(errMsg);
      return;
    }
    if (/\bseverity\b/i.test(errMsg)) {
      setSeverityError(errMsg);
      return;
    }
    if (/\baction\b/i.test(errMsg)) {
      setActionError(errMsg);
      return;
    }
    if (/\bpattern\b/i.test(errMsg)) {
      setPatternError(errMsg);
      return;
    }
    if (/\bname\b/i.test(errMsg)) {
      setNameError(errMsg);
      return;
    }
    setGeneralError(errMsg);
  }

  const handleSave = async () => {
    if (!canSave) {
      // Surface the direction validation message synchronously when the
      // operator hits Save with no direction box checked — `canSave`
      // already disables the button visually, but a screen-reader
      // user pressing Enter from a focused field still hits this path.
      if (!directionOk) setDirectionError('Select at least one direction (inbound, outbound, or both).');
      return;
    }
    setSaving(true);
    clearFieldErrors();

    try {
      // PATCH sends the full set on edit too — simpler than diffing client-
      // side, and the API treats every field as optional, so re-asserting
      // the current value is a no-op. Saves a class of "I unchecked then
      // re-checked" diff bugs.
      const payload: Record<string, unknown> = {
        name: trimmedName,
        pattern: trimmedPattern,
        is_regex: isRegex,
        direction: joinDirection(),
        severity,
        action,
        exceptions,
        enabled,
      };
      // Only send flags when regex mode is on; under literal mode flags
      // are meaningless and the API would just normalize them away.
      if (isRegex) {
        payload.flags = flags;
      }

      const url = isEdit
        ? `/api/policies/${mode.policy.id}/rules/${mode.rule.id}`
        : `/api/policies/${mode.policy.id}/rules`;
      const method = isEdit ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onSaved();
        onClose();
        return;
      }

      // Pull error + code (safe-regex2 rejections include `code`); route to
      // the right slot via applyApiError. Non-JSON body falls through to
      // the status-code fallback.
      let errMsg = `Save failed (${res.status})`;
      let code: string | undefined;
      try {
        const data = await res.json();
        if (typeof data?.error === 'string') errMsg = data.error;
        if (typeof data?.code === 'string') code = data.code;
      } catch { /* non-JSON body — keep the status fallback */ }

      applyApiError(res.status, errMsg, code);
    } catch {
      setGeneralError('Network error');
    } finally {
      setSaving(false);
    }
  };

  // Shared field-level styling so each row reads the same. Computed inline
  // (rather than CSS-in-JS objects shared across files) to keep this modal
  // self-contained and match PolicyEditModal's idiom.
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: C.txT,
    textTransform: 'uppercase', letterSpacing: '0.05em',
  };
  const inputBaseStyle: React.CSSProperties = {
    width: '100%', marginTop: 4, padding: '8px 10px',
    background: C.glassSurfTrans, borderRadius: 6,
    color: C.tx, fontFamily: F.mono, fontSize: 13, outline: 'none',
    boxSizing: 'border-box',
  };
  const errorStyle: React.CSSProperties = {
    fontSize: 11, color: C.danger, marginTop: 4, fontFamily: F.mono,
  };

  // Portal-render so position:fixed escapes any ancestor stacking-context trap.
  // SSR-safe via mounted-state guard.
  if (!mounted) return null;
  return createPortal(
    <>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rule-edit-modal-title"
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
        background: 'rgba(4,7,14,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 560, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto',
          background: `linear-gradient(135deg, ${C.glassPanel} 0%, ${C.glassPanel2} 100%)`,
          borderRadius: 16,
          border: `1px solid ${C.glassBorderCyan}`, borderTop: `3px solid ${C.cyan}`, padding: 24,
          boxShadow: C.glassShadow,
        }}
      >
        <div
          id="rule-edit-modal-title"
          style={{ fontSize: 16, fontWeight: 800, color: C.cyan, marginBottom: 4, fontFamily: F.disp }}
        >
          {isEdit ? 'Edit Rule' : 'Add Rule'}
        </div>
        <div style={{ fontSize: 12, color: C.txS, marginBottom: 16, lineHeight: 1.5 }}>
          {isEdit
            ? `Update this rule in policy "${mode.policy.name}".`
            : `Add a new rule to policy "${mode.policy.name}".`}
        </div>

        {/* Name */}
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="rule-edit-name" style={labelStyle}>Name (required)</label>
          <input
            id="rule-edit-name"
            ref={nameInputRef}
            value={name}
            onChange={e => { setName(e.target.value); if (nameError) setNameError(null); }}
            placeholder="e.g. block-secret-token"
            style={{
              ...inputBaseStyle,
              border: `1px solid ${nameError ? C.danger : C.glassBorderSubtle}`,
            }}
          />
          {nameError && <div style={errorStyle}>{nameError}</div>}
        </div>

        {/* Pattern */}
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="rule-edit-pattern" style={labelStyle}>Pattern (required)</label>
          <input
            id="rule-edit-pattern"
            value={pattern}
            onChange={e => { setPattern(e.target.value); if (patternError) setPatternError(null); }}
            placeholder={isRegex ? 'e.g. sk-[A-Za-z0-9]{20,}' : 'e.g. internal-only'}
            style={{
              ...inputBaseStyle,
              border: `1px solid ${patternError ? C.danger : C.glassBorderSubtle}`,
            }}
          />
          {patternError && <div style={errorStyle}>{patternError}</div>}
        </div>

        {/* Pattern Type radio — Literal default per internal reviewer review #4 layer 1
            (operator-friendly). Switching to Regex shows the inline warning. */}
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Pattern Type</div>
          <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 12, color: C.tx, fontFamily: F.sans }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                name="rule-pattern-type"
                checked={!isRegex}
                onChange={() => { setIsRegex(false); if (patternError) setPatternError(null); }}
              />
              Literal
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                name="rule-pattern-type"
                checked={isRegex}
                onChange={() => { setIsRegex(true); if (patternError) setPatternError(null); }}
              />
              Regex
            </label>
          </div>
          {isRegex && (
            <div style={{ fontSize: 11, color: C.warn, marginTop: 6, fontFamily: F.mono }}>
              Advanced — invalid patterns can slow the scanner.
            </div>
          )}
        </div>

        {/* Advanced (regex flags) — toggled, hidden by default in literal mode. */}
        {isRegex && (
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setShowAdvanced(s => !s)}
              style={{
                background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                color: C.cyan, fontSize: 11, fontFamily: F.mono, letterSpacing: '0.04em',
              }}
            >
              {showAdvanced ? '▾' : '▸'} Advanced
            </button>
            {showAdvanced && (
              <div style={{ marginTop: 6 }}>
                <label htmlFor="rule-edit-flags" style={labelStyle}>Regex flags (optional)</label>
                <input
                  id="rule-edit-flags"
                  value={flags}
                  onChange={e => setFlags(e.target.value)}
                  placeholder='e.g. "i" for case-insensitive'
                  style={{ ...inputBaseStyle, border: `1px solid ${C.glassBorderSubtle}` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Direction — checkboxes per spec; both checked → API 'both', neither → save disabled. */}
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Direction (at least one required)</div>
          <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 12, color: C.tx, fontFamily: F.sans }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={inbound}
                onChange={e => { setInbound(e.target.checked); if (directionError) setDirectionError(null); }}
              />
              Inbound
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={outbound}
                onChange={e => { setOutbound(e.target.checked); if (directionError) setDirectionError(null); }}
              />
              Outbound
            </label>
          </div>
          {directionError && <div style={errorStyle}>{directionError}</div>}
        </div>

        {/* Severity dropdown — uppercase per API contract (Round-3 lockdown). */}
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="rule-edit-severity" style={labelStyle}>Severity</label>
          <select
            id="rule-edit-severity"
            value={severity}
            onChange={e => { setSeverity(e.target.value as SeverityValue); if (severityError) setSeverityError(null); }}
            style={{
              ...inputBaseStyle,
              border: `1px solid ${severityError ? C.danger : C.glassBorderSubtle}`,
            }}
          >
            {SEVERITY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {severityError && <div style={errorStyle}>{severityError}</div>}
        </div>

        {/* Action dropdown — friendly labels, lowercase value. */}
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="rule-edit-action" style={labelStyle}>Action</label>
          <select
            id="rule-edit-action"
            value={action}
            onChange={e => { setAction(e.target.value as RuleAction); if (actionError) setActionError(null); }}
            style={{
              ...inputBaseStyle,
              border: `1px solid ${actionError ? C.danger : C.glassBorderSubtle}`,
            }}
          >
            {ACTION_OPTIONS.map(a => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
          </select>
          {actionError && <div style={errorStyle}>{actionError}</div>}
        </div>

        {/* Exceptions — multi-line, one literal substring per line. Free-form
            string at the API; the scanner splits on newlines internally. */}
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="rule-edit-exceptions" style={labelStyle}>Exceptions (optional, one per line)</label>
          <textarea
            id="rule-edit-exceptions"
            value={exceptions}
            onChange={e => setExceptions(e.target.value)}
            placeholder="example-allowed-substring"
            style={{
              ...inputBaseStyle,
              minHeight: 60, resize: 'vertical',
              fontSize: 12,
              border: `1px solid ${C.glassBorderSubtle}`,
            }}
          />
        </div>

        {/* Enabled */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.tx, fontFamily: F.sans, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
            />
            Enabled
          </label>
        </div>

        {generalError && (
          <div style={{ fontSize: 12, color: C.danger, marginBottom: 12, fontFamily: F.mono }}>
            {generalError}
          </div>
        )}

        {/* Buttons row — [Test Pattern] opens PolicyTestModal (Task 20).
            Hidden entirely when the operator's role lacks policies:test
            (admin + security_manager only when RBAC is on). Until the
            permission probe settles we render an invisible spacer so the
            button row layout doesn't jitter when the affordance appears. */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
          {canTest === true ? (
            <button
              type="button"
              onClick={() => setTestOpen(true)}
              style={{
                padding: '8px 14px', borderRadius: 6, border: `1px solid ${C.cyan}40`,
                background: `${C.cyan}14`, color: C.cyan, fontSize: 12, fontFamily: F.sans,
                cursor: 'pointer',
              }}
            >
              Test Pattern
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 18px', borderRadius: 6, border: `1px solid ${C.cyan}`,
                background: 'transparent', color: C.cyan, fontSize: 13, fontFamily: F.sans, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              style={{
                padding: '8px 18px', borderRadius: 6, border: 'none',
                background: canSave ? `linear-gradient(135deg, ${C.cyan} 0%, ${C.green} 100%)` : C.glassSurfTrans,
                color: canSave ? '#04070e' : C.txT,
                fontSize: 13, fontWeight: 800, fontFamily: F.sans,
                cursor: canSave ? 'pointer' : 'not-allowed',
                opacity: canSave ? 1 : 0.5,
              }}
            >
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Rule'}
            </button>
          </div>
        </div>
      </div>
    </div>
    {testOpen && (
      <PolicyTestModal
        policyId={mode.policy.id}
        policyName={mode.policy.name}
        defaultPattern={trimmedPattern || undefined}
        onClose={() => setTestOpen(false)}
      />
    )}
    </>,
    document.body,
  );
}
