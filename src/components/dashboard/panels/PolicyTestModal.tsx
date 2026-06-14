"use client";

/**
 * PolicyTestModal — Stage 6 closer for the v1 Policy Framework (Task 20).
 *
 * Operator probe: paste sample text, hit [Test], see which of the policy's
 * SAVED rules would match. Surfaces matchCount + first sample per match,
 * and flags any match that the rule's exceptions would suppress at wire-
 * time (so the operator understands the gap between "matched in test" and
 * "fired on traffic").
 *
 * Opened from RuleEditModal's [Test Pattern] button. The endpoint
 * (POST /api/policies/:id/test, Task 16) evaluates SAVED rules in the
 * policy — NOT the operator's unsaved candidate. v1 limitation surfaced
 * inline below the input so operators don't get confused by an "obvious"
 * pattern that doesn't match because it isn't saved yet.
 *
 * RBAC: server enforces policies:test (admin + security_manager only).
 * The button itself is hidden on RuleEditModal for operators that lack
 * the permission (mirrors the /api/auth/me role-fetch pattern already
 * used by ConfigurationPanel for the operator-management card). This
 * modal additionally surfaces a clean 403 message if anyone reaches it
 * without permission — defense in depth, matches RuleEditModal's
 * applyApiError idiom.
 *
 * Visual idiom mirrors RuleEditModal/PolicyEditModal: same backdrop,
 * Escape-to-cancel, click-out dismiss, C.pnl/C.brd palette, cyan accent.
 *
 * Spec §3.8.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { C, F } from '../constants';

interface MatchedRule {
  rule_key: string;
  name: string;
  matchCount: number;
  samples: string[];
  suppressed_by_exception?: boolean;
}

interface Props {
  policyId: string;
  policyName: string;
  /**
   * Optional pre-fill for the textarea. When opened from RuleEditModal we
   * seed it with the rule's pattern as a quick test stub — operator can
   * edit before submitting. Undefined → textarea starts empty.
   */
  defaultPattern?: string;
  onClose: () => void;
}

export function PolicyTestModal({ policyId, policyName, defaultPattern, onClose }: Props) {
  // SSR-safe portal mount guard.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [text, setText] = useState(defaultPattern ?? '');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null → operator hasn't run a test yet (don't render results section);
  // empty array → ran but nothing matched (render the muted "no rules
  // matched" copy). Distinguishing the two states avoids a confusing
  // "no matches" flash on initial open.
  const [matched, setMatched] = useState<MatchedRule[] | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-focus the textarea ONCE on open. Empty deps — must not re-fire
  // on parent re-renders or typing elsewhere would yank focus back.
  useEffect(() => {
    textareaRef.current?.focus();
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

  const canTest = text.length > 0 && !running;

  const handleTest = async () => {
    if (!canTest) return;
    setRunning(true);
    setError(null);
    setMatched(null);

    try {
      const res = await fetch(`/api/policies/${policyId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (res.ok) {
        const data = await res.json();
        setMatched(Array.isArray(data?.matched) ? data.matched : []);
        return;
      }

      // Defense-in-depth 403 copy — server-side guard already enforces
      // policies:test, but a non-permitted operator who somehow reaches
      // this modal sees a clean message instead of a raw status code.
      if (res.status === 403) {
        setError("You don't have permission to run pattern tests. Requires the policies:test permission (Admin or Security Manager).");
        return;
      }

      let errMsg = `Test failed (${res.status})`;
      try {
        const data = await res.json();
        if (typeof data?.error === 'string') errMsg = data.error;
      } catch { /* non-JSON body — keep the status fallback */ }
      setError(errMsg);
    } catch {
      setError('Network error');
    } finally {
      setRunning(false);
    }
  };

  // Shared field-level styling — kept inline (rather than imported from a
  // shared module) so this modal stays self-contained and matches the
  // self-contained style of RuleEditModal/PolicyEditModal.
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: C.txT,
    textTransform: 'uppercase', letterSpacing: '0.05em',
  };
  const inputBaseStyle: React.CSSProperties = {
    width: '100%', marginTop: 4, padding: '8px 10px',
    background: C.glassSurfTrans, borderRadius: 6,
    color: C.tx, fontFamily: F.mono, fontSize: 13, outline: 'none',
    boxSizing: 'border-box',
    border: `1px solid ${C.glassBorderSubtle}`,
  };

  // Portal-render so position:fixed escapes any ancestor stacking-context trap.
  if (!mounted) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="policy-test-modal-title"
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000,
        background: 'rgba(4,7,14,0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 600, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto',
          background: `linear-gradient(135deg, ${C.glassPanel} 0%, ${C.glassPanel2} 100%)`,
          borderRadius: 16,
          border: `1px solid ${C.glassBorderCyan}`, borderTop: `3px solid ${C.cyan}`, padding: 24,
          boxShadow: C.glassShadow,
        }}
      >
        <div
          id="policy-test-modal-title"
          style={{ fontSize: 16, fontWeight: 800, color: C.cyan, marginBottom: 4, fontFamily: F.disp }}
        >
          Test Pattern
        </div>
        <div style={{ fontSize: 12, color: C.txS, marginBottom: 4, lineHeight: 1.5 }}>
          Probe sample text against the rules already saved in policy &quot;{policyName}&quot;.
        </div>
        {/* v1 limitation note — the endpoint runs against SAVED rules only.
            Operators iterating on a candidate pattern in RuleEditModal will
            otherwise expect their unsaved value to participate in the test
            and be confused when it doesn't. */}
        <div style={{ fontSize: 11, color: C.txT, marginBottom: 16, lineHeight: 1.5, fontFamily: F.mono }}>
          Note: tests rules already saved in this policy. Save your rule first to include it.
        </div>

        {/* Sample input — multi-line so operators can paste realistic
            request bodies, JSON blobs, etc. */}
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="policy-test-input" style={labelStyle}>Sample input</label>
          <textarea
            id="policy-test-input"
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Paste sample text to scan against this policy's rules…"
            style={{
              ...inputBaseStyle,
              minHeight: 120, resize: 'vertical',
              fontSize: 12,
            }}
          />
        </div>

        {error && (
          <div style={{ fontSize: 12, color: C.danger, marginBottom: 12, fontFamily: F.mono }}>
            {error}
          </div>
        )}

        {/* Results section — three states:
            1. matched === null   → no test run yet, render nothing
            2. matched.length === 0 → ran, no hits, muted copy
            3. matched.length > 0 → list each match w/ key, name, count, sample,
               and a (suppressed by exception) badge where applicable */}
        {matched !== null && (
          <div style={{
            marginBottom: 16, paddingTop: 12,
            borderTop: `1px solid ${C.glassBorderSubtle}`,
          }}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>
              Results {matched.length > 0 && <span style={{ color: C.cyan }}>({matched.length} matched)</span>}
            </div>
            {matched.length === 0 ? (
              <div style={{ fontSize: 12, color: C.txT, fontFamily: F.mono }}>
                No rules matched this input.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {matched.map(m => (
                  <div
                    key={m.rule_key}
                    style={{
                      padding: '8px 10px', borderRadius: 6,
                      background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`,
                      fontFamily: F.mono, fontSize: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ color: C.cyan, fontWeight: 700 }}>{m.rule_key}</span>
                      <span style={{ color: C.txS }}>{m.name}</span>
                      <span style={{
                        marginLeft: 'auto',
                        padding: '0 6px', borderRadius: 3, fontSize: 10,
                        background: `${C.cyan}20`, color: C.cyan,
                      }}>
                        {m.matchCount} {m.matchCount === 1 ? 'match' : 'matches'}
                      </span>
                      {m.suppressed_by_exception && (
                        <span
                          title="Rule technically matched, but its exceptions list contains a substring of this input — the wire-time evaluator would suppress this detection."
                          style={{
                            padding: '0 6px', borderRadius: 3, fontSize: 10,
                            background: `${C.txT}20`, color: C.txT,
                            fontStyle: 'italic',
                          }}
                        >
                          (suppressed by exception)
                        </span>
                      )}
                    </div>
                    {m.samples.length > 0 && (
                      <div style={{
                        marginTop: 4, fontSize: 11, color: C.txS,
                        opacity: 0.8, wordBreak: 'break-all',
                      }}>
                        sample: {m.samples[0].slice(0, 80)}{m.samples[0].length > 80 ? '…' : ''}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Buttons row — [Test] primary, [Close] dismiss. Mirrors the
            Cancel/primary row in RuleEditModal/PolicyEditModal. */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 18px', borderRadius: 6, border: `1px solid ${C.cyan}`,
              background: 'transparent', color: C.cyan, fontSize: 13, fontFamily: F.sans, cursor: 'pointer',
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={!canTest}
            style={{
              padding: '8px 18px', borderRadius: 6, border: 'none',
              background: canTest ? `linear-gradient(135deg, ${C.cyan} 0%, ${C.green} 100%)` : C.glassSurfTrans,
              color: canTest ? '#04070e' : C.txT,
              fontSize: 13, fontWeight: 800, fontFamily: F.sans,
              cursor: canTest ? 'pointer' : 'not-allowed',
              opacity: canTest ? 1 : 0.5,
            }}
          >
            {running ? 'Testing…' : 'Test'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
