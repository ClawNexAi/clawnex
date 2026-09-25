'use client';

import { useCallback, useEffect, useState } from 'react';
import { C, F } from '../constants';
import { CollapsibleCard } from '../shared';
import { GlobalFilterSelect } from '../GlobalFilterSelect';
import { ModelReadinessControl } from './ModelReadinessControl';
import type { ConnectorRoutingResponse } from '@/lib/services/connector-routing-inventory';
import type { SessionLauncherId } from '@/lib/services/session-launchers';

const button = { padding: '8px 12px', borderRadius: 6, border: `1px solid ${C.brand}66`, background: `${C.brand}16`, color: C.brand, fontFamily: F.disp, fontSize: 12, cursor: 'pointer' };
const primaryButton = { ...button, background: C.brand, color: C.bg, borderColor: C.brand, fontWeight: 700 };
const protocolLabel = { responses: 'Responses API', messages: 'Messages API', chat: 'Chat Completions' } as const;

export function SessionLauncherPanel({ focusedCard, refreshToken }: { focusedCard?: string | null; refreshToken?: string }) {
  const [data, setData] = useState<ConnectorRoutingResponse | null>(null);
  const [model, setModel] = useState('');
  const [harness, setHarness] = useState<SessionLauncherId | ''>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const response = await fetch('/api/connector-routing');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to read session launcher compatibility.');
    setData(result); setError('');
  }, []);
  useEffect(() => { void refresh().catch(reason => setError(String(reason.message || reason))); }, [refresh, refreshToken]);
  const selectedModel = data?.availableModels.find(item => item.alias === model);
  const selectedHarness = data?.sessionLaunchers.find(item => item.id === harness);
  const ready = !!selectedModel?.ready;
  const copy = async () => {
    if (!selectedHarness?.installed || !selectedModel?.ready) return;
    const quoted = `'${selectedModel.alias.replaceAll("'", `'"'"'`)}'`;
    await navigator.clipboard.writeText(`$HOME/.local/bin/clawnex run ${selectedHarness.id} --model ${quoted}`);
    setMessage(`Copied the ${selectedHarness.label} launch command.`);
  };

  return <CollapsibleCard title="CODING SESSION LAUNCHER" accent={C.cyan} defaultOpen={false} focusKey="sessionLauncher" focusedCard={focusedCard}>
    <div style={{ fontSize: 12, fontFamily: F.disp, lineHeight: 1.6 }}>
      <p style={{ color: C.txS, marginTop: 0 }}>Choose a tested model and an installed coding harness. The session runs through ClawNex without changing the harness&apos;s normal configuration or login.</p>
      {error && <p role="alert" style={{ color: C.warn }}>{error}</p>}
      {data && <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}><GlobalFilterSelect ariaLabel="Inspected session model" variant="form" minWidth={0} value={model} onChange={value => { setModel(value); setMessage(''); }} style={{ width: '100%' }}
          options={[{ value: '', label: 'Choose a configured ClawNex model' }, ...data.availableModels.map(item => ({ value: item.alias, label: item.name }))]} /></div>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}><GlobalFilterSelect ariaLabel="Coding harness" variant="form" minWidth={0} value={harness} onChange={value => { setHarness(value as SessionLauncherId); setMessage(''); }} style={{ width: '100%' }}
          options={[{ value: '', label: 'Choose a coding harness' }, ...data.sessionLaunchers.map(item => ({ value: item.id, label: `${item.label} · ${item.installed ? 'installed' : 'not installed'}` }))]} /></div>
        <button aria-label="Copy coding session launch command" style={ready && selectedHarness?.installed ? primaryButton : { ...button, opacity: 0.45, cursor: 'not-allowed' }}
          disabled={!ready || !selectedHarness?.installed} onClick={() => void copy()}>Copy launch command</button>
      </div>}
      {selectedModel && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <ModelReadinessControl providerId={selectedModel.providerId} modelAlias={selectedModel.alias} providerName={selectedModel.name}
          ready={selectedModel.ready} onRefresh={refresh} onMessage={setMessage} />
        {selectedHarness && <span style={{ color: selectedHarness.installed ? C.green : C.warn }}>
          {selectedHarness.installed ? `Installed · ${protocolLabel[selectedHarness.protocol]} · normal safety controls` : `${selectedHarness.label} is not installed on this host`}
        </span>}
      </div>}
      {message && <p role="status" style={{ color: C.tx, marginBottom: 0 }}>{message}</p>}
    </div>
  </CollapsibleCard>;
}
