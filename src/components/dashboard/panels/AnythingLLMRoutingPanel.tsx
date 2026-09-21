'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { C, F } from '../constants';
import { CollapsibleCard } from '../shared';
import { ConfirmDialog } from '../ConfirmDialog';
import type { AnythingPlan, listAnythingConnectors, anythingModels } from '@/lib/services/anythingllm-routing';

type Instance = ReturnType<typeof listAnythingConnectors>[number];
type Data = { connectors: Instance[]; models: ReturnType<typeof anythingModels> };
const button = { padding: '8px 12px', borderRadius: 6, border: `1px solid ${C.cyan}66`, background: `${C.cyan}16`, color: C.cyan, fontFamily: F.disp, fontSize: 12, cursor: 'pointer' };
const input = { padding: '8px 10px', color: C.tx, background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, width: '100%', fontFamily: F.mono, fontSize: 13, boxSizing: 'border-box' as const };
const row = { display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 14 };
async function command(body: Record<string, unknown>) {
  const response = await fetch('/api/config/anythingllm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'AnythingLLM operation could not be confirmed.');
  return result.result;
}
function useAnything() {
  const [data, setData] = useState<Data>({ connectors: [], models: [] });
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const response = await fetch('/api/config/anythingllm');
    if (!response.ok) throw new Error('Cannot load AnythingLLM connectors.');
    setData(await response.json()); setError('');
  }, []);
  useEffect(() => {
    const update = () => { void refresh().catch(e => setError(e.message)); };
    update(); window.addEventListener('clawnex:anythingllm', update);
    return () => window.removeEventListener('clawnex:anythingllm', update);
  }, [refresh]);
  return { data, error, refresh };
}

export function AnythingLLMFleetConnector({ onCountChange }: { onCountChange: (count: number) => void }) {
  const { data, error } = useAnything();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [name, setName] = useState('AnythingLLM'), [managementUrl, setManagementUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  useEffect(() => { onCountChange(data.connectors.length); }, [data.connectors.length, onCountChange]);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} style={{ marginBottom: 20, fontSize: 12 }}>
    <summary style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: open ? 10 : 0, paddingBottom: 6, borderBottom: `1px solid ${C.glassBorderSubtle}`, cursor: 'pointer', listStyle: 'none' }}>
      <span aria-hidden="true" style={{ fontSize: 10, color: C.txT, display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>{'▶'}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color: C.cyan, letterSpacing: '0.04em' }}>ANYTHINGLLM</span>
    </summary>
    {data.connectors.map(instance => <p key={instance.id} style={{ color: C.tx, fontSize: 12 }}><strong>{instance.name}</strong> — {instance.managementUrl}<br />Registered · review chat routing below</p>)}
    <form onSubmit={event => { event.preventDefault(); setBusy(true); setMessage(''); void command({ action: 'add', name, managementUrl, apiKey }).then(() => {
      setApiKey(''); setMessage('Connected. Open AnythingLLM Routing to choose models and review changes.'); window.dispatchEvent(new Event('clawnex:anythingllm'));
    }).catch(e => setMessage(e.message)).finally(() => setBusy(false)); }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, margin: '12px 0' }}>
        <label style={{ color: C.txS, fontSize: 12 }}>Instance name<input aria-label="AnythingLLM instance name" required maxLength={120} value={name} onChange={e => setName(e.target.value)} style={input} /></label>
        <label style={{ color: C.txS, fontSize: 12 }}>AnythingLLM address<input aria-label="AnythingLLM address" type="url" required placeholder="http://127.0.0.1:19322" value={managementUrl} onChange={e => setManagementUrl(e.target.value)} style={input} /></label>
        <label style={{ color: C.txS, fontSize: 12 }}>AnythingLLM developer API key<input aria-label="AnythingLLM API key" type="password" autoComplete="new-password" required value={apiKey} onChange={e => setApiKey(e.target.value)} style={input} /></label>
      </div>
      <p style={{ color: C.txS, fontSize: 12 }}>For AnythingLLM installed on the same host as ClawNex. Create an API key in AnythingLLM Settings → Developer API. Registration only discovers configuration; chat routes directly to the local LiteLLM proxy.</p>
      <div style={row}><button type="submit" disabled={busy} style={button}>{busy ? 'Connecting…' : 'Add AnythingLLM'}</button></div>
    </form>
    {(error || message) && <p role="status" style={{ color: C.txS }}>{error || message}</p>}
  </details>;
}

export function AnythingLLMRoutingPanel({ focusedCard }: { focusedCard?: string | null }) {
  const { data, error, refresh } = useAnything();
  const [selectedId, setSelectedId] = useState('');
  const instance = data.connectors.find(c => c.id === selectedId) || data.connectors[0];
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [plan, setPlan] = useState<AnythingPlan | null>(null);
  const reviewOrigin = useRef<HTMLElement | null>(null);
  const run = async (task: () => Promise<void>) => { setBusy(true); setMessage(''); try { await task(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Operation failed.'); } finally { setBusy(false); } };
  const select = (key: string, selected: boolean, model: string) => run(async () => { setPlan(null); await command({ action: 'select', id: instance.id, key, selected, model }); await refresh(); });
  const review = (operation: 'apply' | 'restore') => {
    reviewOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return run(async () => { const result: AnythingPlan = await command({ action: 'prepare', id: instance.id, operation }); await refresh(); setPlan(result); });
  };
  const modelSelect = (key: string) => <select aria-label={`ClawNex model for ${key}`} disabled={busy} style={{ ...input, maxWidth: 500 }} value={instance.choices[key]?.model || ''}
    onChange={e => void select(key, instance.choices[key]?.selected || false, e.target.value)}>
    <option value="">Choose a configured ClawNex model</option>
    {data.models.map(m => <option key={`${m.providerId}:${m.alias}`} value={m.alias}>{m.name}{m.ready ? ' · tested' : ' · test required'}</option>)}
  </select>;
  const owned = instance ? Object.keys(instance.ownership).length : 0;
  return <CollapsibleCard title="ANYTHINGLLM ROUTING" accent={C.cyan} defaultOpen={false} focusKey="anythingllmRouting" focusedCard={focusedCard}>
    <div style={{ fontFamily: F.disp, fontSize: 12, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
    {error && <p role="alert" style={{ color: C.warn }}>{error}</p>}
    {!instance ? <p style={{ color: C.txS }}>Add an AnythingLLM instance in Fleet Connectors to configure chat routing.</p> : <>
      <select aria-label="AnythingLLM instance" value={instance.id} disabled={busy} onChange={e => { setSelectedId(e.target.value); setPlan(null); setMessage(''); }} style={{ ...input, maxWidth: 500, marginBottom: 12 }}>
        {data.connectors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <p style={{ color: C.txS, fontSize: 12, lineHeight: 1.6 }}>Select → Review → Apply → Send a chat → Verify. Default chat is selected initially; workspace overrides are opt-in. Selections alone do not change traffic.</p>
      <p style={{ color: C.tx, fontSize: 12 }}>Proxy base URL: <code>{instance.proxyBaseUrl}</code></p>
      <div style={row}>
        <button style={button} disabled={busy} onClick={() => void review('apply')}>Review connection changes</button>
        <button style={button} disabled={busy} onClick={() => void run(async () => { setPlan(null); await command({ action: 'refresh', id: instance.id }); await refresh(); setMessage('Workspaces refreshed. New overrides remain unselected.'); })}>Refresh workspaces</button>
        <button style={button} disabled={busy || !owned} onClick={() => void run(async () => { const result = await command({ action: 'verify', id: instance.id }); await refresh(); setMessage(result.detail); })}>Verify connection</button>
        <button style={{ ...button, color: C.warn }} disabled={busy || !owned} onClick={() => void review('restore')}>Restore direct connection</button>
      </div>
      {busy && <p role="status" style={{ color: C.txS }}>Working…</p>}
      {message && <p role="status" style={{ color: C.tx, lineHeight: 1.6 }}>{message}</p>}
      <div style={{ border: `1px solid ${C.brd}`, borderRadius: 6, padding: 12, marginBottom: 12 }}>
        <label style={{ color: C.tx, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }}><input type="checkbox" aria-label="Route AnythingLLM default chat" disabled={busy} checked={instance.choices.default.selected} onChange={e => void select('default', e.target.checked, instance.choices.default.model)} />Default chat provider</label>
        <p style={{ color: C.txS, fontSize: 12 }}>Current: {instance.snapshot.provider} / {instance.snapshot.defaultModel || 'provider default'}</p>
        {modelSelect('default')}
      </div>
      <h4 style={{ color: C.tx, fontSize: 13, fontWeight: 700, margin: '12px 0 8px' }}>Workspaces ({instance.snapshot.workspaces.length})</h4>
      {!instance.snapshot.workspaces.length && <p style={{ color: C.txS }}>No workspaces yet. Create one in AnythingLLM, then refresh here.</p>}
      {instance.snapshot.workspaces.map(workspace => {
        const key = `workspace:${workspace.id}`, owner = instance.ownership[key];
        const inherited = !workspace.provider && !workspace.model && !owner;
        const unsupported = workspace.provider === 'anythingllm-router' || workspace.routerId !== null;
        const configured = !!owner && instance.slotIntact && workspace.provider === owner.after.provider && workspace.model === owner.after.model;
        return <div key={workspace.id} style={{ border: `1px solid ${C.brd}`, borderRadius: 6, padding: 12, marginBottom: 8 }}>
          <label style={{ display: 'flex', flexWrap: 'wrap', gap: 8, color: C.tx, alignItems: 'center', fontSize: 13 }}>
            {!inherited && <input type="checkbox" aria-label={`Route workspace ${workspace.name}`} disabled={busy || unsupported} checked={instance.choices[key]?.selected || false} onChange={e => void select(key, e.target.checked, instance.choices[key]?.model || '')} />}
            <strong>{workspace.name}</strong><span style={{ marginLeft: 'auto', color: C.txS, fontSize: 12 }}>{inherited ? 'Uses default' : unsupported ? 'Model router · unsupported' : configured ? 'Configured · verify instance traffic' : workspace.provider === 'litellm' && instance.slotIntact ? 'Uses shared ClawNex connection' : 'Explicit override · outside managed route'}</span>
          </label>
          <p style={{ color: C.txS, fontSize: 12 }}>{inherited ? `Follows ${instance.snapshot.provider} automatically.` : `Current: ${workspace.provider || 'default provider'} / ${workspace.model || 'provider default'}`}</p>
          {!inherited && !unsupported && modelSelect(key)}
          {(workspace.agentProvider || workspace.agentModel) && <p style={{ color: C.warn, fontSize: 12 }}>Agent override: {workspace.agentProvider || 'inherited provider'} / {workspace.agentModel || 'provider default'} — outside chat-routing coverage.</p>}
        </div>;
      })}
      <p style={{ color: C.txS, fontSize: 12 }}>Verify checks the saved local proxy settings and loaded models. Confirm actual requests in Traffic Monitor; this provider does not send an instance identity header. Agent overrides and embeddings are outside chat-routing scope.</p>
      {instance.slotReserved && <p style={{ color: instance.slotIntact ? C.txS : C.warn, fontSize: 12 }}>{instance.slotIntact ? 'The separate LiteLLM connection is reserved for ClawNex. Restore returns managed chat routes to their original providers and retains this connection for reuse.' : 'The shared ClawNex connection changed in AnythingLLM. Resolve that conflict before applying or restoring routes.'}</p>}
    </>}
    </div>
    <ConfirmDialog open={!!plan} title="Review AnythingLLM chat routing" confirmLabel={plan?.prerequisites.length ? 'Resolve prerequisites first' : 'Apply reviewed changes'} danger={plan?.operation === 'restore'} returnFocusTo={reviewOrigin.current}
      body={<><p>{plan?.changes.length} route changes. No application restart is required.</p>
        <p>Chat proxy: <code>{plan?.slot.base}</code></p>
        <ul>{plan?.changes.map(c => <li key={c.key}>{c.name}: {c.before.provider || 'default'} → {c.after.provider || 'default'}{c.after.model ? ` / ${c.after.model}` : ''}</li>)}</ul>
        <p>Affected workspaces: {plan?.affectedWorkspaces.join(', ') || 'None'}</p>
        {!!plan?.retired.length && <p>{plan.retired.length} deleted workspace record(s) will be retired. No workspace will be recreated.</p>}
        {!!plan?.prerequisites.length && <ul style={{ color: C.warn }}>{plan.prerequisites.map((p, i) => <li key={i}>{p}</li>)}</ul>}
        <p>Original provider credentials remain unchanged. A separate LiteLLM connection is reserved for ClawNex and retained after restore. New inherited workspaces will follow the default automatically.</p></>}
      onCancel={() => setPlan(null)} onConfirm={() => {
        const approved = plan; setPlan(null); if (!approved) return;
        if (approved.prerequisites.length) { setMessage(approved.prerequisites.join(' ')); return; }
        void run(async () => { const result = await command({ action: 'execute', planId: approved.id, approved: true }); await refresh(); setMessage(result.detail); });
      }} />
  </CollapsibleCard>;
}
