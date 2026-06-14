"use client";

/**
 * PolicyEditModal — Stage 6 authoring affordance for the v1 Policy Framework.
 *
 * Two modes:
 *   - create: POST /api/policies          (operator authors a new custom policy)
 *   - edit:   PATCH /api/policies/[id]    (rename / re-describe an existing CUSTOM policy)
 *
 * Vendor policies (source === 'curated' | 'system') do NOT open this modal.
 * Their disable/delete flow lives in Task 21 (typed-phrase confirm) — this
 * modal explicitly refuses an edit-mode mount for vendor input as a defensive
 * second guard (the card-side button is disabled, but cheap to double-check).
 *
 * Visual idiom mirrors BreakGlassDialog (ConfigurationPanel.tsx:152): fixed
 * overlay with click-to-close backdrop, click-stop on the inner card,
 * Escape-to-cancel keyboard handler, and the same C.pnl / C.brd / C.danger
 * palette. Form fields reuse the same input styling so the dashboard reads as
 * one coherent surface.
 *
 * Spec §3.8.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { C, F } from '../constants';
import type { Policy } from '@/lib/shield/types';

export type PolicyEditMode =
  | { kind: 'create' }
  | { kind: 'edit'; policy: Policy };

interface Props {
  mode: PolicyEditMode;
  onClose: () => void;
  /** Called after a successful save so the parent card can refetch. */
  onSaved: () => void;
}

export function PolicyEditModal({ mode, onClose, onSaved }: Props) {
  // Defensive second guard — Task 18 explicitly does not handle vendor policies.
  // Card-side disables the [Edit] button for source !== 'custom', but if some
  // future caller wires this up wrong, fail closed rather than silently PATCH
  // a vendor row (which the API would 403 anyway).
  if (mode.kind === 'edit' && mode.policy.source !== 'custom') {
    return null;
  }

  const isEdit = mode.kind === 'edit';
  const initialName = isEdit ? mode.policy.name : '';
  const initialDescription = isEdit ? (mode.policy.description ?? '') : '';

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  // Field-scoped errors so we can render them inline beneath the offending
  // input. `general` covers network errors and unexpected non-field failures.
  const [nameError, setNameError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the name field ONCE on open. Empty deps — must not re-fire
  // on parent re-renders, otherwise typing in another field re-focuses Name
  // and the cursor jumps back. Bug: parent passes onClose as an inline arrow,
  // so [onClose] deps would re-fire every render.
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  // Escape-to-close is its own effect — re-binds when onClose identity changes
  // (cheap), but doesn't disturb focus.
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

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setNameError(null);
    setGeneralError(null);

    // Description: empty string → null so we never persist whitespace-only
    // descriptions. This matches the API's nullable-description contract.
    const trimmedDescription = description.trim();
    const descriptionPayload = trimmedDescription.length === 0 ? null : trimmedDescription;

    try {
      const url = isEdit ? `/api/policies/${mode.policy.id}` : '/api/policies';
      const method = isEdit ? 'PATCH' : 'POST';
      const body = isEdit
        ? { name: trimmedName, description: descriptionPayload }
        : { name: trimmedName, description: descriptionPayload };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        onSaved();
        onClose();
        return;
      }

      // Map the API's error shape to field-scoped messages. The POST route
      // returns "name is required" (400) and "a policy with that name already
      // exists" (409); the PATCH route returns shape-typed errors (400) such
      // as `field "name" must be non-empty string`. Anything else surfaces in
      // the general slot so it isn't silently swallowed.
      let errMsg = `Save failed (${res.status})`;
      try {
        const data = await res.json();
        if (typeof data?.error === 'string') errMsg = data.error;
      } catch { /* non-JSON body — keep the status fallback */ }

      const looksLikeNameError =
        res.status === 409 ||
        /\bname\b/i.test(errMsg);

      if (looksLikeNameError) {
        setNameError(errMsg);
      } else {
        setGeneralError(errMsg);
      }
    } catch {
      setGeneralError('Network error');
    } finally {
      setSaving(false);
    }
  };

  // Portal-render so position:fixed escapes any ancestor stacking-context trap
  // (transform/filter/will-change on a parent dashboard wrapper). Mounted-state
  // guard keeps SSR from crashing on document.body access.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="policy-edit-modal-title"
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
          width: 480, maxWidth: '90vw',
          background: `linear-gradient(135deg, ${C.glassPanel} 0%, ${C.glassPanel2} 100%)`,
          borderRadius: 16,
          border: `1px solid ${C.glassBorderCyan}`, borderTop: `3px solid ${C.cyan}`, padding: 24,
          boxShadow: C.glassShadow,
        }}
      >
        <div
          id="policy-edit-modal-title"
          style={{ fontSize: 16, fontWeight: 800, color: C.cyan, marginBottom: 4, fontFamily: F.disp }}
        >
          {isEdit ? 'Edit Policy' : 'Add Policy'}
        </div>
        <div style={{ fontSize: 12, color: C.txS, marginBottom: 16, lineHeight: 1.5 }}>
          {isEdit
            ? 'Rename or update the description for this custom policy. Source, lifecycle, and version are immutable in v1.'
            : 'Create a new custom policy. You can add rules to it from the Policies & Rules card after saving.'}
        </div>

        {/* Name */}
        <div style={{ marginBottom: 12 }}>
          <label
            htmlFor="policy-edit-name"
            style={{ fontSize: 11, fontWeight: 700, color: C.txT, textTransform: 'uppercase', letterSpacing: '0.05em' }}
          >
            Name (required)
          </label>
          <input
            id="policy-edit-name"
            ref={nameInputRef}
            value={name}
            onChange={e => { setName(e.target.value); if (nameError) setNameError(null); }}
            placeholder="e.g. Customer-PII-Strict"
            style={{
              width: '100%', marginTop: 4, padding: '8px 10px',
              background: C.glassSurfTrans,
              border: `1px solid ${nameError ? C.danger : C.glassBorderSubtle}`,
              borderRadius: 6,
              color: C.tx, fontFamily: F.mono, fontSize: 13, outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {nameError && (
            <div style={{ fontSize: 11, color: C.danger, marginTop: 4, fontFamily: F.mono }}>
              {nameError}
            </div>
          )}
        </div>

        {/* Description */}
        <div style={{ marginBottom: 16 }}>
          <label
            htmlFor="policy-edit-description"
            style={{ fontSize: 11, fontWeight: 700, color: C.txT, textTransform: 'uppercase', letterSpacing: '0.05em' }}
          >
            Description (optional)
          </label>
          <textarea
            id="policy-edit-description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What this policy enforces and why."
            style={{
              width: '100%', marginTop: 4, padding: '8px 10px', minHeight: 70, resize: 'vertical',
              background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6,
              color: C.tx, fontFamily: F.mono, fontSize: 12, outline: 'none', boxSizing: 'border-box',
            }}
          />
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
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Policy'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
