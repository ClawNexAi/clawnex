'use client';
import { useState } from 'react';
import { C, F } from '../constants';
import { Badge, Dot } from '../shared';

export function NativeAgentFleetConnector({ type, title, configHint, connectors, refresh }: {
  type: 'pi' | 'codex' | 'claude'; title: string; configHint: string;
  connectors: Array<{ id: string; type: string; name: string; configPath: string; available: boolean; error: string | null }>;
  refresh: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false), [name, setName] = useState(`${title} Local`);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const instances = connectors.filter(c => c.type === type);
  const inputStyle = { width: '100%', padding: '8px 10px', background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 13, boxSizing: 'border-box' as const };
  const buttonStyle = { padding: '8px 16px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
  const command = async (id?: string) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/config/coding-agent-connectors${id ? `?id=${encodeURIComponent(id)}` : ''}`, {
        method: id ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, ...(id ? {} : { body: JSON.stringify({ type, name: name.trim() }) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Connector operation failed.');
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Connector operation failed.'); }
    finally { setBusy(false); }
  };
  return <div style={{ marginBottom: 20, fontSize: 12 }}>
    <div role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
      style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: open ? 10 : 0, paddingBottom: 6, borderBottom: `1px solid ${C.glassBorderSubtle}`, cursor: 'pointer' }}>
      <span aria-hidden="true" style={{ fontSize: 10, color: C.txT, display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>{'▶'}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color: C.cyan, letterSpacing: '0.04em' }}>{title.toUpperCase()}</span>
      <Badge color={instances.some(c => c.available) ? C.green : C.txT} label={instances.some(c => c.available) ? 'LIVE' : 'NOT CONFIGURED'} />
    </div>
    {open && <>
      {instances.map(c => <div key={c.id} style={{ padding: '12px 14px', marginBottom: 8, background: C.glassSurfTrans, borderRadius: 8, border: `1px solid ${C.glassBorderSubtle}`, borderLeft: `3px solid ${c.available ? C.green : C.danger}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><Dot color={c.available ? C.green : C.danger} size={8} /><span style={{ fontSize: 14, fontWeight: 700, color: C.tx }}>{c.name}</span><Badge color={C.cyan} label="GLOBAL CONFIG" /></div>
          <button disabled={busy} onClick={() => void command(c.id)} style={{ ...buttonStyle, background: C.danger, color: '#fff', padding: '4px 10px', fontSize: 12 }}>Remove</button>
        </div>
        <div style={{ fontSize: 12, color: C.txT, fontFamily: F.mono, overflowWrap: 'anywhere' }}>{c.configPath}</div>
        {c.error && <p role="alert" style={{ fontSize: 11, color: C.danger }}>{c.error}</p>}
      </div>)}
      {!instances.length && <div style={{ padding: 14, background: `${C.cyan}06`, borderRadius: 8, border: `1px dashed ${C.cyan}33`, marginTop: 8 }}>
        <label style={{ fontSize: 11, color: C.txT }}>NAME<input aria-label={`${title} connector name`} value={name} onChange={e => setName(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} /></label>
        <p style={{ fontSize: 11, color: C.txS, marginBottom: 8 }}>Uses the native global <span style={{ fontFamily: F.mono }}>{configHint}</span>. Project, environment, command-line and sandbox overrides are outside coverage. No model is selected automatically.</p>
        <button disabled={busy || !name.trim()} onClick={() => void command()} style={{ ...buttonStyle, width: '100%', background: C.cyan, color: '#fff' }}>+ Add {title}</button>
      </div>}
      {error && <p role="alert" style={{ color: C.danger, fontSize: 11 }}>{error}</p>}
    </>}
  </div>;
}
