"use client";

// ConfirmDialog — themed modal overlay used in place of the browser's native
// `confirm()` dialog. Built so destructive panel actions (remove a model,
// remove a provider, etc.) can prompt the operator with a confirmation that
// fits the dashboard's dark theme + danger palette instead of the OS modal.
//
// Why a modal (not the inline Uninstall pattern): inline confirmation works
// for permanent cards but doesn't fit small per-chip remove buttons that sit
// in dense rows. The modal centers attention on the action without disrupting
// the surrounding layout. operator-approved approach (2026-04-24).

import { useEffect, useId, useRef } from "react";
import { createPortal } from 'react-dom';
import { C, F } from "./constants";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Body text — string or React node. Use plain strings for simple cases;
   *  pass JSX when you want bold model names or other emphasis. */
  body: React.ReactNode;
  /** Confirm button label. Defaults to "Remove" because most callers are
   *  destructive — pass "OK" or similar for affirmative confirmations. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Render the confirm button in the danger palette (red). Defaults to true
   *  since this dialog primarily replaces destructive confirm() calls. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Origin captured before an asynchronous preparation disabled its button. */
  returnFocusTo?: HTMLElement | null;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Remove",
  cancelLabel = "Cancel",
  danger = true,
  onConfirm,
  onCancel,
  returnFocusTo,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const titleId = useId();

  // Start on Cancel; keep keyboard navigation inside the dialog and restore
  // the originating control when it closes.
  useEffect(() => {
    if (!open) return;
    const previousFocus = returnFocusTo || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    cancelBtnRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelRef.current();
      }
      if (e.key === 'Tab') {
        const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary, a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])].filter(control => control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previousFocus?.focus(); };
  }, [open, returnFocusTo]);

  if (!open || typeof document === 'undefined') return null;

  const accent = danger ? C.danger : C.brand;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        // Backdrop — dark with subtle blur so the dashboard behind feels muted
        // but still visible as context.
        background: "rgba(4, 7, 14, 0.72)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        // Stop the click-to-close from triggering when the user clicks inside
        // the card itself. Only clicks on the backdrop dismiss.
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 460,
          maxHeight: 'calc(100dvh - 48px)',
          overflowY: 'auto',
          width: "100%",
          background: C.srf,
          border: `1px solid ${accent}44`,
          borderRadius: 12,
          padding: "20px 22px",
          boxShadow: `0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px ${accent}18`,
          fontFamily: F.disp,
        }}
      >
        <div
          id={titleId}
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: accent,
            letterSpacing: "0.02em",
            marginBottom: 8,
          }}
        >
          {title}
        </div>

        <div
          style={{
            fontSize: 12,
            color: C.txS,
            lineHeight: 1.55,
            marginBottom: 18,
          }}
        >
          {body}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            ref={cancelBtnRef}
            onClick={onCancel}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: `1px solid ${C.brd}`,
              background: "transparent",
              color: C.txS,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: F.disp,
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmBtnRef}
            onClick={onConfirm}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              border: "none",
              background: accent,
              color: danger ? "#fff" : C.bg,
              fontSize: 12,
              fontWeight: 700,
              fontFamily: F.disp,
              cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>, document.body
  );
}
