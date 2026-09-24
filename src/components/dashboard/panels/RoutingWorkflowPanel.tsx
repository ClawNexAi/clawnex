'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { C, F } from '../constants';
import { CollapsibleCard } from '../shared';
import { ConfirmDialog } from '../ConfirmDialog';
import { GlobalFilterSelect } from '../GlobalFilterSelect';
import { ModelReadinessControl } from './ModelReadinessControl';
import type { ConnectorId, ConnectorRoutingResponse, ConnectorRoutingItem } from '@/lib/services/connector-routing-inventory';
import type { RoutingPlan } from '@/lib/services/routing-workflow';
import type { RoutingVerification } from '@/lib/services/routing-reconciliation';

const button = { padding: '8px 12px', borderRadius: 6, border: `1px solid ${C.brand}66`, background: `${C.brand}16`, color: C.brand, fontFamily: F.disp, fontSize: 12, cursor: 'pointer' };
const primaryButton = { ...button, background: C.brand, color: C.bg, borderColor: C.brand, fontWeight: 700 };
const connectorPresentation: Record<ConnectorId, { title: string; accent: string; focusKey: string }> = {
  openclaw: { title: 'OpenClaw', accent: C.brand, focusKey: 'openclawRouting' },
  hermes: { title: 'Hermes', accent: C.purp, focusKey: 'hermesRouting' },
  claude: { title: 'Claude Code', accent: C.cyan, focusKey: 'claudeRouting' },
  codex: { title: 'Codex', accent: C.cyan, focusKey: 'codexRouting' },
  pi: { title: 'Pi', accent: C.cyan, focusKey: 'piRouting' },
  opencode: { title: 'OpenCode', accent: C.cyan, focusKey: 'opencodeRouting' },
};

export function RoutingProviderLabel({ providerId, displayName }: { providerId: string; displayName: string }) {
  const friendlyName = displayName.trim() || providerId;
  const showConfigId = friendlyName.toLocaleLowerCase() !== providerId.toLocaleLowerCase();
  return <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
    <strong>{friendlyName}</strong>
    {showConfigId && <span style={{ color: C.txS, fontSize: 10 }}>Config ID: <span style={{ fontFamily: F.mono }}>{providerId}</span></span>}
  </span>;
}

async function command(body: Record<string, unknown>) {
  const response = await fetch('/api/connector-routing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.error || result.result?.detail || 'The operation could not be completed. No success has been assumed.');
  return result;
}

function InstanceRouting({ connector, data, refresh, focusedCard }: {
  connector: ConnectorId; data: ConnectorRoutingResponse; refresh: () => Promise<void>; focusedCard?: string | null;
}) {
  const summary = data[connector];
  const sources = [...new Set(summary.items.filter(item => item.present).map(item => item.sourceId))];
  const native = ['pi', 'codex', 'claude'].includes(connector);
  if (!sources.length && summary.status === 'ok') sources.push(summary.sourceId);
  const [selectedSource, setSelectedSource] = useState('');
  const [initialModel, setInitialModel] = useState('');
  const sourceId = sources.includes(selectedSource) ? selectedSource : sources[0] || '';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [prerequisites, setPrerequisites] = useState<string[]>([]);
  const [plan, setPlan] = useState<RoutingPlan | null>(null);
  const reviewOrigin = useRef<HTMLElement | null>(null);
  const [verification, setVerification] = useState<{ key: string; result: RoutingVerification } | null>(null);
  const initialModelConfig = data.availableModels.find(model => model.alias === initialModel);
  const { title, accent, focusKey } = connectorPresentation[connector];
  const items = summary.items.filter(item => item.present && item.sourceId === sourceId && !['litellm', 'clawnex-litellm'].includes(item.providerId));
  const providers = new Map<string, ConnectorRoutingItem[]>();
  for (const item of items) providers.set(item.providerId, [...(providers.get(item.providerId) || []), item]);
  const groups = [...providers.entries()];
  const currentKey = JSON.stringify(items.map(item => [item.id, item.fingerprint, item.desiredRoute]));
  const currentVerification = verification?.key === currentKey ? verification.result : null;
  const routed = groups.filter(([, rows]) => rows.some(row => row.currentRoute === 'routed')).length;
  const recoveryOwned = native && items.some(item => typeof item.metadata.identityHash === 'string');
  const restoreAvailable = routed > 0 || recoveryOwned;
  const pending = items.some(item => ['provider-routing', 'model-inventory'].includes(item.capability) && item.desiredRoute !== item.currentRoute);
  const verificationPending = routed > 0 && !pending && currentVerification?.status !== 'verified';
  const excluded = groups.filter(([, rows]) => rows.every(row => ['read-only', 'unsupported'].includes(row.capability))).length;
  const emptyGuidance = connector === 'opencode' && summary.status === 'ok'
    ? 'OpenCode is connected, but its global config has no explicit OpenAI-compatible provider endpoint. Add a provider with options.baseURL and models in ~/.config/opencode/opencode.json(c), then refresh.'
    : native
      ? summary.status === 'ok' && connector !== 'pi'
        ? 'Choose the initial model above, then review the proposed global connection.'
        : summary.detail
      : 'No supported local configuration found. Add the instance in Fleet Connectors, then refresh. Remote instances require supported configuration access; they are not treated as local.';
  const run = async (task: () => Promise<void>) => {
    setBusy(true); setMessage(''); setPrerequisites([]);
    try { await task(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Operation could not be confirmed.'); }
    finally { setBusy(false); }
  };
  const review = (operation: 'apply' | 'restore') => {
    reviewOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return run(async () => {
    const result = await command({ action: 'prepare', connector, sourceId, operation });
    if (result.plan.prerequisites.length) {
      setPrerequisites(result.plan.prerequisites);
      setMessage('Prepare the replacement connection first. A model test is missing, expired, or no longer matches the loaded configuration. In Model Providers, test each affected model; readiness remains valid for 30 minutes unless configuration changes.');
    } else setPlan(result.plan);
    });
  };
  const apply = () => {
    const approved = plan;
    setPlan(null);
    if (!approved) return;
    void run(async () => {
      const result = await command({ action: 'execute-plan', planId: approved.id, approved: true });
      setMessage(`${result.result.detail} ${result.result.restartRequired ? 'Restart this agent instance before verifying its next request. No restart was performed automatically.' : ''}`);
      await refresh();
      window.dispatchEvent(new Event('clawnex:updates-refreshed'));
    });
  };
  const restartOpenClaw = () => void run(async () => {
    const response = await fetch('/api/openclaw/gateway/restart', { method: 'POST' });
    const result = await response.json();
    if (!response.ok || result.ok !== true) {
      const manual = typeof result.manualCommand === 'string' && result.manualCommand
        ? ` Manual command: ${result.manualCommand}` : '';
      throw new Error(`${result.detail || result.error || 'OpenClaw restart could not be confirmed.'}${manual}`);
    }
    setMessage(`${result.detail} Send one new OpenClaw request, then verify the connection.`);
  });

  return <CollapsibleCard title={`${title.toUpperCase()} ROUTING`} accent={accent}
    defaultOpen={false} focusKey={focusKey} focusedCard={focusedCard}>
    <div style={{ fontSize: 12, fontFamily: F.disp, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
    {['codex', 'claude'].includes(connector) && summary.status === 'ok' && (!groups.length || items.some(item => item.metadata.initialSetup)) && <div style={{ marginBottom: 12 }}>
      <div style={{ color: C.tx, fontSize: 12 }}>Initial model
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, flexWrap: 'wrap', margin: '6px 0 8px', maxWidth: 680 }}>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}><GlobalFilterSelect ariaLabel={`${title} initial model`} variant="form" minWidth={0} value={initialModel} disabled={busy} onChange={setInitialModel}
            style={{ width: '100%' }} options={[{ value: '', label: 'Choose a configured ClawNex model' }, ...data.availableModels.map(model => ({ value: model.alias, label: model.name }))]} /></div>
          {initialModelConfig && <ModelReadinessControl key={`${initialModelConfig.providerId}:${initialModelConfig.alias}`}
            providerId={initialModelConfig.providerId} modelAlias={initialModelConfig.alias} providerName={initialModelConfig.name}
            ready={initialModelConfig.ready} disabled={busy} onRefresh={refresh} onMessage={setMessage} />}
        </div>
      </div>
      <button style={button} disabled={busy || !initialModel} onClick={() => void run(async () => { await command({ action: 'choose-native-model', connector, modelAlias: initialModel }); setPlan(null); await refresh(); })}>Use selected model</button>
      <p style={{ color: C.txS, fontSize: 12, marginTop: 8 }}>Selection prepares a global provider. Review and Apply below writes its local proxy settings. Existing login, project settings and subscription credentials are preserved.</p>
      {connector === 'claude' && <p style={{ color: C.txS, fontSize: 12 }}>The chosen model will fill the default, Sonnet, Opus, Haiku, fast and subagent slots. Claude Code requires a working Messages API route.</p>}
    </div>}
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
      <strong style={{ color: C.tx }}>{currentVerification?.status === 'verified' ? 'Routed models verified' : routed ? 'Configured · verification required' : 'Direct connection'}</strong>
      <GlobalFilterSelect ariaLabel={`${title} instance`} variant="form" minWidth={0} disabled={busy || sources.length === 0} value={sourceId}
        onChange={value => { setSelectedSource(value); setMessage(''); setPlan(null); setPrerequisites([]); }}
        options={sources.length ? sources.map(source => ({ value: source, label: source === 'default' ? 'Local instance' : summary.items.find(item => item.sourceId === source)?.metadata.profileName as string || (native || connector === 'opencode' ? `${title} global configuration` : source) })) : [{ value: '', label: 'No local instance found' }]} />
    </div>
    <p style={{ color: C.txS, fontSize: 12, lineHeight: 1.6 }}>Prepare → Review → Apply → Verify<br />
      {routed} of {groups.length} provider routes configured through ClawNex. {excluded ? `${excluded} unsupported route(s) remain unchanged. Coverage is partial.` : ''}
      {' '}Connection status does not change your existing blocking, observe-only, or emergency-bypass policy.</p>
    <p style={{ color: C.txS, fontSize: 12 }}>Configure and test your upstream models first. Select provider routes below, then review the changes. Selecting a provider affects all of its models.</p>
    {['pi', 'codex', 'claude'].includes(connector) && <p style={{ color: C.txS, fontSize: 12 }}>{summary.detail}</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
      <button aria-label={`Review ${title} connection changes`} style={pending ? primaryButton : button} disabled={busy || !sourceId || !pending} onClick={() => void review('apply')}>Review connection changes</button>
      <button aria-label={`Refresh ${title} configuration`} style={button} disabled={busy} onClick={() => void run(refresh)}>Refresh configuration</button>
      {connector === 'openclaw' && <button aria-label="Restart OpenClaw instance" style={button}
        disabled={busy || !sourceId || pending} onClick={restartOpenClaw}>Restart OpenClaw instance</button>}
      <button aria-label={`Verify ${title} connection`} style={{ ...(verificationPending ? primaryButton : button), opacity: busy || !sourceId || !routed || pending ? 0.45 : 1 }} disabled={busy || !sourceId || routed === 0 || pending} onClick={() => void run(async () => {
        const result = await command({ action: 'verify', connector, sourceId });
        setVerification({ key: currentKey, result: result.verification });
      })}>Verify connection</button>
      <button aria-label={`Restore ${title} direct connection`}
        title={restoreAvailable ? 'Restore ClawNex-managed routes to their saved direct connection' : 'No ClawNex-managed route is available to restore'}
        style={{ ...button, color: C.warn, borderColor: `${C.warn}66`,
          opacity: busy || !sourceId || !restoreAvailable ? 0.45 : 1,
          cursor: busy || !sourceId || !restoreAvailable ? 'not-allowed' : 'pointer' }}
        disabled={busy || !sourceId || !restoreAvailable} onClick={() => void review('restore')}>Restore direct connection</button>
    </div>
    {busy && <p role="status" style={{ color: C.txS }}>Working…</p>}
    {message && <p role="status" style={{ color: C.tx, fontSize: 12, lineHeight: 1.6 }}>{message}</p>}
    {currentVerification && <p role="status" style={{ color: C.txS, fontSize: 12 }}>{currentVerification.detail}</p>}
    {prerequisites.length > 0 && <details open><summary style={{ color: C.warn }}>Connection prerequisites ({prerequisites.length})</summary>
      <ul style={{ color: C.txS, fontSize: 12 }}>{prerequisites.map(reason => <li key={reason}>{reason}</li>)}</ul></details>}
    <details open style={{ marginTop: 12 }}><summary style={{ cursor: 'pointer', color: C.tx, marginBottom: 8 }}>Providers and affected models</summary>
      {groups.map(([providerId, rows]) => {
        const writable = rows.filter(row => ['provider-routing', 'model-inventory'].includes(row.capability));
        const modelRows = [...new Map(rows.filter(row => row.itemType === 'model' && row.modelId).map(row => [row.modelId, row])).values()];
        const providerDisplayName = rows.find(row => row.itemType === 'provider')?.displayName || providerId;
        return <div key={providerId} style={{ padding: '10px 12px', border: `1px solid ${C.brd}`, borderRadius: 6, marginBottom: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.tx }}>
            <input type="checkbox" aria-label={`Route ${providerId} through ClawNex for ${title} ${sourceId}`} disabled={busy || !writable.length} checked={writable.some(row => row.desiredRoute === 'routed')}
              onChange={event => { const checked = event.target.checked; void run(async () => {
                await command({ action: 'select', connector, itemIds: writable.map(row => row.id), desiredRoute: checked ? 'routed' : 'direct' });
                await refresh();
              }); }} />
            {writable.length ? <>
              <span style={{ color: C.txS, fontSize: 11 }}>Route</span>
              <RoutingProviderLabel providerId={providerId} displayName={providerDisplayName} />
              <span style={{ color: C.txS, fontSize: 11 }}>through ClawNex</span>
            </> : <RoutingProviderLabel providerId={providerId} displayName={providerDisplayName} />}
            <span style={{ marginLeft: 'auto', color: C.txS, fontSize: 11 }}>{!writable.length ? 'Not supported · unchanged' : rows.some(row => row.currentRoute === 'routed') ? 'Configured' : 'Direct'}</span>
          </label>
          <details style={{ marginTop: 8, color: C.txS, fontSize: 12 }}><summary>{modelRows.length} affected model(s)</summary>
            {modelRows.map(model => {
              const readiness = data.modelReadiness[model.id];
              return <div key={model.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 0' }}>
                <span style={{ flex: '1 1 280px', minWidth: 0, overflowWrap: 'anywhere' }}>{model.modelId}</span>
                {readiness && <ModelReadinessControl key={`${readiness.providerId}:${readiness.modelAlias}`}
                  providerId={readiness.providerId} modelAlias={readiness.modelAlias} providerName={readiness.providerName}
                  ready={readiness.ready} disabled={busy} onRefresh={refresh} onMessage={setMessage} />}
              </div>;
            })}</details>
        </div>;
      })}
      {!groups.length && <p style={{ color: C.txS }}>{emptyGuidance}</p>}
    </details>
    <details style={{ marginTop: 12, color: C.txT, fontSize: 12 }}><summary>Technical details</summary><p>Instance: {sourceId || 'unavailable'}</p><p>Proxy: {data.litellmTarget}</p><p>{summary.detail}</p></details>
    </div>
    <ConfirmDialog open={plan !== null} title={`${plan?.operation === 'restore' ? 'Restore direct connection' : 'Apply reviewed connection changes'} — ${title}`}
      danger={plan?.operation === 'restore'} confirmLabel={plan?.operation === 'restore' ? 'Restore eligible routes' : 'Apply approved changes'}
      body={<><p>Instance: {plan?.sourceId}</p><p>{plan?.providers.length} provider route(s), {plan?.models.length} model(s). {plan?.exclusions} unsupported route(s) remain unchanged.</p>
        {connector === 'codex' && <p>Codex uses the HTTP Responses API. The TOML file is rewritten with its values preserved; comments and formatting are normalized.</p>}
        {connector === 'claude' && <p>Claude Code uses the local Messages API. Initial setup assigns the selected model to all model slots. Existing project and managed settings can override this global configuration.</p>}
        {native && plan?.operation === 'restore' && recoveryOwned && <p>Retained recovery records are checked even when the current endpoint has changed. Conflicting operator edits are preserved and reported.</p>}
        {['codex', 'claude'].includes(connector) && <p>Apply first sends a small test request through this client's API protocol for every affected model. A failed test leaves agent configuration unchanged.</p>}
        <p>{plan?.operation === 'restore' ? 'Restore only connection settings and identity headers still owned by ClawNex. Preserve unrelated edits and report conflicts.' : native ? 'Point the selected provider endpoints to local LiteLLM and add a signed instance-identity header. Original owned fields and credentials are stored in encrypted recovery records.' : 'Point the selected provider endpoints to LiteLLM and add a signed instance-identity header. Original credentials are retained in encrypted recovery records.'}</p>
        <details><summary>Affected providers and models</summary><p style={{ overflowWrap: 'anywhere' }}>{plan?.providers.join(', ') || 'None'}</p><p style={{ overflowWrap: 'anywhere' }}>{plan?.models.join(', ') || 'None'}</p></details>
        {!!plan?.legacyPaths.length && <p>Legacy routing fields will also be reviewed for safe restoration: {plan.legacyPaths.join(', ')}. Edited or still-referenced fields are preserved.</p>}
        <p>{native ? 'Start a new agent session after applying or restoring. Existing sessions and configuration overrides are outside this global route.' : 'Gateway restart may interrupt active work. No restart occurs automatically.'} Later operator edits are preserved; conflicts require review.</p></>}
      returnFocusTo={reviewOrigin.current} onConfirm={apply} onCancel={() => setPlan(null)} />
  </CollapsibleCard>;
}

export function RoutingWorkflowPanel({ focusedCard, connectors = ['openclaw', 'hermes'], refreshToken }: {
  focusedCard?: string | null;
  connectors?: readonly ConnectorId[];
  refreshToken?: string;
}) {
  const [data, setData] = useState<ConnectorRoutingResponse | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const response = await fetch('/api/connector-routing');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to read routing configuration.');
    setData(result); setError('');
  }, []);
  useEffect(() => { void refresh().catch(reason => setError(String(reason.message || reason))); }, [refresh, refreshToken]);
  return <>{error && <p role="alert" style={{ color: C.warn }}>{error}</p>}
    {data ? <>{connectors.filter(connector => data[connector].status !== 'missing').map(connector =>
      <InstanceRouting key={connector} connector={connector} data={data} refresh={refresh} focusedCard={focusedCard} />)}</>
      : error ? <button style={button} onClick={() => { setError(''); void refresh().catch(reason => setError(String(reason.message || reason))); }}>Retry reading configuration</button> : <p style={{ color: C.txS }}>Reading routing configuration…</p>}</>;
}
