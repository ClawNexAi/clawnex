"use client";

/**
 * PolicyDisableConfirm — Stage 7 Safety+Audit guard for disabling
 * vendor-shipped (curated/system) policies.
 *
 * Why a typed-phrase modal: vendor policies ship verified Shield
 * coverage with different runtime semantics — ClawNex Default is the
 * curated operator-visible AUDIT MIRROR of ALL_RULES (wire-inert in
 * v1; disabling it removes the mirror row from Configuration →
 * Policies & Rules, but the 163 built-in detections still run from
 * source), while Generic Egress Starter is a wire-active system
 * policy whose disable DOES strip outbound starter DLP/policy
 * detection. The typed-phrase modal exists to prevent accidental
 * disables of either — the runtime cost differs per policy but both
 * disables affect the operator's deployed posture. The API requires
 *   { enabled: false, confirm_phrase: <exact server-defined string>, reason: <≥10 chars> }
 * for vendor disables; this modal is the operator-facing surface that
 * forces the operator to type the exact phrase the server expects + state
 * a reason ≥10 chars before the PATCH lands.
 *
 * Source-of-truth choice (internal reviewer review #2): the expected phrase is NOT
 * hardcoded in the client. On mount we PATCH `{ enabled: false }` once
 * with no confirm_phrase to deliberately trip the API's 400 response,
 * which carries `expected_phrase` in the body. Operators trust what the
 * server actually enforces — if the server's DISABLE_PHRASES map ever
 * changes, this modal automatically reflects that without a client
 * deploy. Audit trail records `confirm_phrase_matched: true` + the
 * operator-provided reason; the typed phrase itself is never persisted
 * (internal reviewer review #5).
 *
 * Re-enable does NOT use this modal — re-enabling restores protection,
 * so the parent card PATCHes `{ enabled: true }` directly without
 * friction.
 *
 * Visual idiom mirrors PolicyEditModal + RuleEditModal: fixed overlay,
 * click-to-close backdrop, click-stop on the inner card, Escape-to-cancel
 * keyboard handler. Primary button is rendered in C.danger (red) instead
 * of C.cyan to make the destructive nature visually obvious — operator
 * should feel friction here.
 *
 * Spec §3.3 + §3.8.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { C, F } from '../constants';

interface Props {
  policyId: string;
  policyName: string;
  /** Closes the modal — both Cancel and post-success paths call this. */
  onClose: () => void;
  /** Called after a successful disable so the parent card can refetch. */
  onSuccess: () => void;
}

export function PolicyDisableConfirm({ policyId, policyName, onClose, onSuccess }: Props) {
  // SSR-safe portal mount guard.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Expected phrase comes from the server's 400 response (see probe below).
  // Empty until the probe settles; the [Confirm Disable] button is gated
  // on this being non-empty so the operator can never submit a phrase
  // before we know what the server expects.
  const [expectedPhrase, setExpectedPhrase] = useState<string>('');
  const [phrase, setPhrase] = useState('');
  const [reason, setReason] = useState('');

  const [submitting, setSubmitting] = useState(false);
  // probing covers the on-mount probe plus the re-probe after a phrase
  // mismatch — when true the form is disabled so the operator can't
  // submit against a stale `expectedPhrase`.
  const [probing, setProbing] = useState(true);
  const [probeError, setProbeError] = useState<string | null>(null);

  // Field-scoped errors so we can render them inline beneath the offending
  // input. `general` covers network errors and unexpected non-field failures
  // (including the 403 path we don't expect to hit but defend against).
  const [phraseError, setPhraseError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const phraseInputRef = useRef<HTMLTextAreaElement | null>(null);

  /**
   * probeExpectedPhrase — PATCH `{ enabled: false }` with no confirm_phrase
   * to deliberately trip the API's 400 response and read `expected_phrase`
   * from the body. Called once on mount and again after a phrase-mismatch
   * 400 (defensive — if the server's DISABLE_PHRASES map were live-edited
   * between probe and submit, the second probe surfaces the new phrase).
   *
   * The probe is non-mutating: the API rejects the request before
   * persisting anything (see /api/policies/[id]/route.ts:138-143).
   */
  async function probeExpectedPhrase() {
    setProbing(true);
    setProbeError(null);
    try {
      const res = await fetch(`/api/policies/${policyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      if (res.status === 400) {
        const data = await res.json().catch(() => ({} as Record<string, unknown>));
        if (typeof data?.expected_phrase === 'string' && data.expected_phrase.length > 0) {
          setExpectedPhrase(data.expected_phrase);
        } else {
          // Body shape changed unexpectedly — surface so we don't silently
          // ship a modal whose confirm button can never become valid.
          setProbeError('Could not retrieve the disable phrase from the server. Cancel and retry.');
        }
      } else if (res.status === 403) {
        // Vendor policy without a registered disable phrase, or RBAC denial.
        // Either way the operator can't proceed from here.
        setProbeError('This policy cannot be disabled via the dashboard.');
      } else if (res.ok) {
        // Defensive — if for some reason the API accepted `{ enabled: false }`
        // without a phrase (regression in the vendor guard), the policy is
        // already disabled. Tell the parent so it refetches and close.
        onSuccess();
        onClose();
      } else {
        setProbeError(`Server returned ${res.status}. Cancel and retry.`);
      }
    } catch {
      setProbeError('Network error contacting the server. Cancel and retry.');
    } finally {
      setProbing(false);
    }
  }

  // Mount: focus the phrase field + wire Escape-to-close + run the probe.
  // The dependency list intentionally omits the probe/onClose callbacks —
  // they're stable for the lifetime of this modal instance and including
  // them would re-run the probe on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    phraseInputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    void probeExpectedPhrase();
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const trimmedPhrase = phrase.trim();
  const trimmedReason = reason.trim();
  const reasonLength = trimmedReason.length;
  const reasonOk = reasonLength >= 10;
  const phraseOk = expectedPhrase.length > 0 && trimmedPhrase.toLowerCase() === expectedPhrase.toLowerCase();
  const canSubmit = phraseOk && reasonOk && !submitting && !probing;

  const handleConfirm = async () => {
    if (!canSubmit) {
      // Surface field validation if the operator gets here via keyboard
      // even though the button is visually disabled.
      if (!phraseOk) setPhraseError('Phrase does not match. Type the phrase exactly as shown.');
      if (!reasonOk) setReasonError('Reason must be at least 10 characters.');
      return;
    }
    setSubmitting(true);
    setPhraseError(null);
    setReasonError(null);
    setGeneralError(null);

    try {
      const res = await fetch(`/api/policies/${policyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: false,
          confirm_phrase: trimmedPhrase,
          reason: trimmedReason,
        }),
      });

      if (res.ok) {
        onSuccess();
        onClose();
        return;
      }

      // Pull the API's error message + (where present) the refreshed
      // expected_phrase. Route to the right field by keyword.
      let errMsg = `Disable failed (${res.status})`;
      let serverExpectedPhrase: string | null = null;
      try {
        const data = await res.json();
        if (typeof data?.error === 'string') errMsg = data.error;
        if (typeof data?.expected_phrase === 'string') serverExpectedPhrase = data.expected_phrase;
      } catch { /* non-JSON body — keep the status fallback */ }

      if (res.status === 400 && /confirm_phrase/i.test(errMsg)) {
        // Re-sync the expected phrase from the response (defensive — same
        // reason the on-mount probe runs).
        if (serverExpectedPhrase) setExpectedPhrase(serverExpectedPhrase);
        setPhraseError('Phrase does not match. Type the phrase exactly as shown.');
      } else if (res.status === 400 && /reason/i.test(errMsg)) {
        setReasonError(errMsg);
      } else if (res.status === 403) {
        // The vendor allow-list (`enabled` / `confirm_phrase` / `reason`)
        // should make this unreachable, but surface generically if it ever
        // fires rather than silently failing.
        setGeneralError(errMsg);
      } else {
        setGeneralError(errMsg);
      }
    } catch {
      setGeneralError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  // Portal-render so position:fixed escapes any ancestor stacking-context trap.
  if (!mounted) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="policy-disable-confirm-title"
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
          width: 520, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto',
          background: `linear-gradient(135deg, ${C.glassPanel} 0%, ${C.glassPanel2} 100%)`,
          borderRadius: 16,
          border: `1px solid ${C.glassBorderCyan}`,
          // Red top border to telegraph destructive action.
          borderTop: `3px solid ${C.danger}`,
          padding: 24,
          boxShadow: C.glassShadow,
        }}
      >
        <div
          id="policy-disable-confirm-title"
          style={{ fontSize: 16, fontWeight: 800, color: C.danger, marginBottom: 4, fontFamily: F.disp }}
        >
          Disable Vendor Policy
        </div>
        <div style={{ fontSize: 12, color: C.txS, marginBottom: 16, lineHeight: 1.5 }}>
          You are about to disable the vendor-shipped policy{' '}
          <span style={{ color: C.tx, fontWeight: 700 }}>{policyName}</span>.
          This removes its detection coverage from the Shield until you re-enable it.
          Type the phrase below exactly as shown and provide a reason (≥10 chars) to confirm.
        </div>

        {/* Expected phrase callout — code-styled so it reads as the literal
            value to type, not as instructional copy. */}
        <div style={{ marginBottom: 12 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: C.txT,
            textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4,
          }}>
            Type this phrase
          </div>
          <div style={{
            padding: '8px 12px', background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`,
            borderRadius: 6, fontFamily: F.mono, fontSize: 13, color: C.tx,
            userSelect: 'all',
            // Visually muted while we're probing so the operator can tell
            // the value isn't ready yet.
            opacity: probing ? 0.5 : 1,
          }}>
            {probing ? 'Loading…' : (expectedPhrase || '—')}
          </div>
          {probeError && (
            <div style={{ fontSize: 11, color: C.danger, marginTop: 4, fontFamily: F.mono }}>
              {probeError}
            </div>
          )}
        </div>

        {/* Confirm phrase input */}
        <div style={{ marginBottom: 12 }}>
          <label
            htmlFor="policy-disable-phrase"
            style={{
              fontSize: 11, fontWeight: 700, color: C.txT,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}
          >
            Confirmation phrase
          </label>
          <textarea
            id="policy-disable-phrase"
            ref={phraseInputRef}
            value={phrase}
            onChange={e => { setPhrase(e.target.value); if (phraseError) setPhraseError(null); }}
            placeholder="Type the phrase shown above"
            disabled={probing || submitting}
            style={{
              width: '100%', marginTop: 4, padding: '8px 10px', minHeight: 44, resize: 'vertical',
              background: C.glassSurfTrans,
              border: `1px solid ${phraseError ? C.danger : C.glassBorderSubtle}`,
              borderRadius: 6,
              color: C.tx, fontFamily: F.mono, fontSize: 13, outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {phraseError && (
            <div style={{ fontSize: 11, color: C.danger, marginTop: 4, fontFamily: F.mono }}>
              {phraseError}
            </div>
          )}
        </div>

        {/* Reason input — counter doubles as the validation hint until the
            operator hits the 10-char minimum, then flips informative. */}
        <div style={{ marginBottom: 16 }}>
          <label
            htmlFor="policy-disable-reason"
            style={{
              fontSize: 11, fontWeight: 700, color: C.txT,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}
          >
            Reason (≥10 chars)
          </label>
          <textarea
            id="policy-disable-reason"
            value={reason}
            onChange={e => { setReason(e.target.value); if (reasonError) setReasonError(null); }}
            placeholder="Why are you disabling this policy? (audit trail)"
            disabled={probing || submitting}
            style={{
              width: '100%', marginTop: 4, padding: '8px 10px', minHeight: 60, resize: 'vertical',
              background: C.glassSurfTrans,
              border: `1px solid ${reasonError ? C.danger : C.glassBorderSubtle}`,
              borderRadius: 6,
              color: C.tx, fontFamily: F.mono, fontSize: 12, outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <div style={{
            fontSize: 11, marginTop: 4, fontFamily: F.mono,
            color: reasonOk ? C.txT : C.warn,
          }}>
            {reasonLength}/10 characters {reasonOk ? '✓' : 'minimum'}
          </div>
          {reasonError && (
            <div style={{ fontSize: 11, color: C.danger, marginTop: 4, fontFamily: F.mono }}>
              {reasonError}
            </div>
          )}
        </div>

        {generalError && (
          <div style={{ fontSize: 12, color: C.danger, marginBottom: 12, fontFamily: F.mono }}>
            {generalError}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
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
            onClick={handleConfirm}
            disabled={!canSubmit}
            style={{
              padding: '8px 18px', borderRadius: 6, border: 'none',
              background: canSubmit ? C.danger : C.glassSurfTrans, color: canSubmit ? '#fff' : C.txT,
              fontSize: 13, fontWeight: 800, fontFamily: F.sans,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              opacity: canSubmit ? 1 : 0.5,
            }}
          >
            {submitting ? 'Disabling…' : 'Confirm Disable'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
