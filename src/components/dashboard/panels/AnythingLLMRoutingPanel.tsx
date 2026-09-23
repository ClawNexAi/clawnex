'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { C, F } from '../constants';
import { Badge, Dot, CollapsibleCard } from '../shared';
import { ConfirmDialog } from '../ConfirmDialog';
import { GlobalFilterSelect } from '../GlobalFilterSelect';
import { Tooltip } from '../tooltip';
import { ModelReadinessControl } from './ModelReadinessControl';
import type { AnythingPlan, listAnythingConnectors, anythingModels } from '@/lib/services/anythingllm-routing';

type Instance = ReturnType<typeof listAnythingConnectors>[number] & { available?: boolean; error?: string | null };
type Data = { connectors: Instance[]; models: ReturnType<typeof anythingModels> };
const button = { padding: '8px 12px', borderRadius: 6, border: `1px solid ${C.cyan}66`, background: `${C.cyan}16`, color: C.cyan, fontFamily: F.disp, fontSize: 12, cursor: 'pointer' };
const input = { padding: '8px 10px', color: C.tx, background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, width: '100%', fontFamily: F.mono, fontSize: 13, boxSizing: 'border-box' as const };
const row = { display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 14 };
const actionButton = (disabled: boolean, color = C.cyan) => ({ ...button, color: disabled ? C.txT : color, borderColor: disabled ? C.glassBorderSubtle : `${color}66`, background: disabled ? C.glassSurfTrans : `${color}16`, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1 });
const tipButton = { border: 0, background: 'transparent', color: C.cyan, padding: '0 2px', fontSize: 12, lineHeight: 1, cursor: 'help' };

function InfoTip({ label, content }: { label: string; content: React.ReactNode }) {
  return <Tooltip placement="top" variant="detail" content={content}>
    <button type="button" aria-label={`Help: ${label}`} style={tipButton}>ⓘ</button>
  </Tooltip>;
}
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
  const { data, error, refresh } = useAnything();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [name, setName] = useState('AnythingLLM'), [managementUrl, setManagementUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const ready = !!name.trim() && !!managementUrl.trim() && !!apiKey.trim() && !busy;
  const live = !error && data.connectors.some(instance => instance.available);
  const fleetButton = { padding: '8px 16px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
  const update = async (body: Record<string, unknown>) => {
    setBusy(true); setMessage('');
    try {
      await command(body); setApiKey(''); await refresh();
      window.dispatchEvent(new Event('clawnex:anythingllm'));
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Connector operation failed.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { onCountChange(data.connectors.length); }, [data.connectors.length, onCountChange]);
  return <div style={{ marginBottom: 20, fontSize: 12 }}>
    <div role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(!open); } }} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: open ? 10 : 0, paddingBottom: 6, borderBottom: `1px solid ${C.glassBorderSubtle}`, cursor: 'pointer' }}>
      <span aria-hidden="true" style={{ fontSize: 10, color: C.txT, display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>{'▶'}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color: C.cyan, letterSpacing: '0.04em' }}>ANYTHINGLLM</span>
      <Badge color={live ? C.green : C.txT} label={live ? 'LIVE' : data.connectors.length || error ? 'ERROR' : 'NOT CONFIGURED'} />
    </div>
    {open && <>
    {data.connectors.map(instance => <div key={instance.id} style={{ padding: '12px 14px', marginBottom: 8, background: C.glassSurfTrans, borderRadius: 8, border: `1px solid ${C.glassBorderSubtle}`, borderLeft: `3px solid ${instance.available && !error ? C.green : C.danger}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Dot color={instance.available && !error ? C.green : C.danger} glow={!!instance.available && !error} size={8} />
          <span style={{ fontSize: 14, fontWeight: 700, color: C.tx }}>{instance.name}</span>
          <Badge color={instance.available && !error ? C.green : C.danger} label={instance.available && !error ? 'CONNECTED' : 'ERROR'} />
        </div>
        <button disabled={busy} onClick={() => void update({ action: 'remove', id: instance.id })} style={{ ...fleetButton, background: C.danger, color: '#fff', padding: '4px 10px', fontSize: 12 }}>Remove</button>
      </div>
      <div style={{ fontSize: 12, color: C.txT, fontFamily: F.mono, overflowWrap: 'anywhere' }}>{instance.managementUrl}</div>
      {instance.error && <p role="alert" style={{ color: C.danger, fontSize: 11 }}>{instance.error}</p>}
    </div>)}
    {!data.connectors.length && !error && <form onSubmit={event => { event.preventDefault(); if (ready) void update({ action: 'add', name, managementUrl, apiKey }); }} style={{ padding: 14, background: `${C.cyan}06`, borderRadius: 8, border: `1px dashed ${C.cyan}33`, marginTop: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 8, marginBottom: 8 }}>
        <label style={{ color: C.txT, fontSize: 11 }}>NAME<input aria-label="AnythingLLM instance name" required maxLength={120} value={name} onChange={e => setName(e.target.value)} style={input} /></label>
        <label style={{ color: C.txT, fontSize: 11 }}>ADDRESS<input aria-label="AnythingLLM address" type="url" required placeholder="http://127.0.0.1:19322" value={managementUrl} onChange={e => setManagementUrl(e.target.value)} style={input} /></label>
        <label style={{ color: C.txT, fontSize: 11 }}><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>DEVELOPER API KEY <InfoTip label="AnythingLLM Developer API key" content={<span>Create this key in <strong>AnythingLLM → Settings → Developer API</strong>, then paste it here. ClawNex uses it to read providers and workspaces and apply reviewed routing settings.</span>} /></span><input aria-label="AnythingLLM API key" aria-describedby="anythingllm-key-help" type="password" autoComplete="new-password" required value={apiKey} onChange={e => setApiKey(e.target.value)} style={input} /></label>
      </div>
      <p id="anythingllm-key-help" style={{ color: C.txS, fontSize: 11, marginBottom: 8 }}>Create this key in AnythingLLM Settings → Developer API. ClawNex uses it to read providers and workspaces and apply routing settings. Use the address of AnythingLLM on this host.</p>
      <button type="submit" disabled={!ready} style={{ ...fleetButton, width: '100%', background: ready ? C.cyan : C.glassSurfTrans, color: '#fff', cursor: ready ? 'pointer' : 'not-allowed' }}>{busy ? 'Connecting…' : '+ Add AnythingLLM'}</button>
    </form>
    }
    {(error || message) && <p role="alert" style={{ color: C.danger, fontSize: 11 }}>{error || message}</p>}
    </>}
  </div>;
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
  const modelSelect = (key: string) => {
    const alias = instance.choices[key]?.model || '';
    const selectedModel = data.models.find(model => model.alias === alias);
    return <div style={{ width: '100%', maxWidth: 680, display: 'flex', alignItems: 'stretch', gap: 8, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 320px', minWidth: 0 }}><GlobalFilterSelect ariaLabel={`ClawNex model for ${key}`} variant="form" minWidth={0} disabled={busy} style={{ width: '100%' }} value={alias}
        onChange={value => void select(key, instance.choices[key]?.selected || false, value)}
        options={[{ value: '', label: 'Choose a configured ClawNex model' }, ...data.models.map(m => ({ value: m.alias, label: m.name }))]} /></div>
      {selectedModel && <ModelReadinessControl key={`${selectedModel.providerId}:${selectedModel.alias}`} providerId={selectedModel.providerId}
        modelAlias={selectedModel.alias} providerName={selectedModel.name.split(' / ')[0]} ready={selectedModel.ready}
        disabled={busy} onRefresh={refresh} onMessage={setMessage} />}
    </div>;
  };
  const owned = instance ? Object.keys(instance.ownership).length : 0;
  return <CollapsibleCard title="ANYTHINGLLM ROUTING" accent={C.cyan} defaultOpen={false} focusKey="anythingllmRouting" focusedCard={focusedCard}>
    <div style={{ fontFamily: F.disp, fontSize: 12, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
    {error && <p role="alert" style={{ color: C.warn }}>{error}</p>}
    {!instance ? <p style={{ color: C.txS }}>Add an AnythingLLM instance in Fleet Connectors to configure chat routing.</p> : <>
      <GlobalFilterSelect ariaLabel="AnythingLLM instance" variant="form" minWidth={0} value={instance.id} disabled={busy} onChange={value => { setSelectedId(value); setPlan(null); setMessage(''); }} style={{ width: '100%', maxWidth: 500, marginBottom: 12 }}
        options={data.connectors.map(c => ({ value: c.id, label: c.name }))} />
      <p style={{ color: C.txS, fontSize: 12, lineHeight: 1.6 }}>Select → Review → Apply → Send a chat → Verify. Default chat is selected initially; workspace overrides are opt-in. Selections alone do not change traffic.</p>
      <p style={{ color: C.tx, fontSize: 12 }}>Proxy base URL: <code>{instance.proxyBaseUrl}</code></p>
      <div style={row}>
        <button style={actionButton(busy)} disabled={busy} onClick={() => void review('apply')}>Review connection changes</button>
        <button style={actionButton(busy)} disabled={busy} onClick={() => void run(async () => { setPlan(null); await command({ action: 'refresh', id: instance.id }); await refresh(); setMessage('Workspaces refreshed. New overrides remain unselected.'); })}>Refresh workspaces</button>
        <Tooltip content={owned ? 'Check the managed AnythingLLM route and loaded models.' : 'Unavailable because no AnythingLLM route is currently managed by ClawNex.'}><button aria-label={owned ? 'Verify AnythingLLM connection' : 'Verify connection unavailable because no AnythingLLM route is managed by ClawNex'} style={actionButton(busy || !owned)} disabled={busy || !owned} onClick={() => void run(async () => { const result = await command({ action: 'verify', id: instance.id }); await refresh(); setMessage(result.detail); })}>Verify connection</button></Tooltip>
        <Tooltip content={owned ? 'Restore managed chat routes to their original provider and model.' : 'Unavailable because no managed AnythingLLM route remains to restore.'}><button aria-label={owned ? 'Restore AnythingLLM direct connection' : 'Restore direct connection unavailable because no managed AnythingLLM route remains'} style={actionButton(busy || !owned, C.warn)} disabled={busy || !owned} onClick={() => void review('restore')}>Restore direct connection</button></Tooltip>
      </div>
      {busy && <p role="status" style={{ color: C.txS }}>Working…</p>}
      {message && <p role="status" style={{ color: C.tx, lineHeight: 1.6 }}>{message}</p>}
      <div style={{ border: `1px solid ${C.brd}`, borderRadius: 6, padding: 12, marginBottom: 12 }}>
        <label style={{ color: C.tx, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }}><input type="checkbox" aria-label="Route AnythingLLM default chat" disabled={busy} checked={instance.choices.default.selected} onChange={e => void select('default', e.target.checked, instance.choices.default.model)} />Default chat provider</label>
        <p style={{ color: C.txS, fontSize: 12 }}>Current: {instance.snapshot.provider} / {instance.snapshot.defaultModel || 'provider default'}</p>
        {modelSelect('default')}
      </div>
      <h4 style={{ color: C.tx, fontSize: 13, fontWeight: 700, margin: '12px 0 8px', display: 'flex', alignItems: 'center', gap: 4 }}>Workspaces ({instance.snapshot.workspaces.length}) <InfoTip label="AnythingLLM workspaces" content={<span>AnythingLLM workspaces are separate chat areas. Each workspace can follow the instance-wide <strong>Default chat provider</strong> above or define its own provider and model override.</span>} /></h4>
      {!instance.snapshot.workspaces.length && <p style={{ color: C.txS }}>No workspaces yet. Create one in AnythingLLM, then refresh here.</p>}
      {instance.snapshot.workspaces.map(workspace => {
        const key = `workspace:${workspace.id}`, owner = instance.ownership[key];
        const inherited = !workspace.provider && !workspace.model && !owner;
        const unsupported = workspace.provider === 'anythingllm-router' || workspace.routerId !== null;
        const configured = !!owner && instance.slotIntact && workspace.provider === owner.after.provider && workspace.model === owner.after.model;
        return <div key={workspace.id} style={{ border: `1px solid ${C.brd}`, borderRadius: 6, padding: 12, marginBottom: 8 }}>
          <label style={{ display: 'flex', flexWrap: 'wrap', gap: 8, color: C.tx, alignItems: 'center', fontSize: 13 }}>
            {!inherited && <input type="checkbox" aria-label={`Route workspace ${workspace.name}`} disabled={busy || unsupported} checked={instance.choices[key]?.selected || false} onChange={e => void select(key, e.target.checked, instance.choices[key]?.model || '')} />}
            <strong>{workspace.name}</strong><span style={{ marginLeft: 'auto', color: C.txS, fontSize: 12 }}>{inherited ? <Tooltip placement="left" variant="detail" content={<span>This workspace has no provider or model override. It follows the <strong>Default chat provider</strong> and model shown above, including future changes to that default.</span>}><span>Uses default</span></Tooltip> : unsupported ? 'Model router · unsupported' : configured ? 'Configured · verify instance traffic' : workspace.provider === 'litellm' && instance.slotIntact ? 'Uses shared ClawNex connection' : 'Explicit override · outside managed route'}</span>
          </label>
          <p style={{ color: C.txS, fontSize: 12 }}>{inherited ? 'Follows the Default chat provider above.' : `Current: ${workspace.provider || 'default provider'} / ${workspace.model || 'provider default'}`}</p>
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
