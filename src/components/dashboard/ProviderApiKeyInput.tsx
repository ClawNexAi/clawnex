"use client";

import React, { useEffect, useId, useState } from 'react';
import { C } from './constants';

/** Only accepts the operator's unsaved input, never a fetched/stored key. */
export function ProviderApiKeyInput({ label, value, onChange, placeholder, inputStyle, disabled = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputStyle: React.CSSProperties;
  disabled?: boolean;
}) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { if (!value) setRevealed(false); }, [value]);
  const visible = revealed && value.length > 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 88px', gap: 8, width: '100%', minWidth: 0 }}>
      <input id={id} aria-label={label} type={visible ? 'text' : 'password'}
        autoComplete="new-password" autoCapitalize="none" spellCheck={false}
        value={value} placeholder={placeholder} disabled={disabled}
        onChange={event => onChange(event.target.value)}
        style={{ ...inputStyle, width: '100%', minWidth: 0, boxSizing: 'border-box' }} />
      <button type="button" aria-controls={id} aria-pressed={visible}
        aria-label={`${visible ? 'Hide' : 'Show'} key: ${label}`}
        disabled={disabled || !value} onClick={() => setRevealed(current => !current)}
        style={{ padding: '6px 8px', color: C.tx, background: C.glassSurfTrans,
          border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6,
          fontSize: 12, cursor: disabled || !value ? 'default' : 'pointer' }}>
        {visible ? 'Hide key' : 'Show key'}
      </button>
    </div>
  );
}
