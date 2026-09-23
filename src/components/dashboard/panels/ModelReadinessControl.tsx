'use client';

import { useEffect, useRef, useState } from 'react';
import { C, F } from '../constants';
import { ConfirmDialog } from '../ConfirmDialog';
import { Tooltip } from '../tooltip';

type ReadinessMessage = { tone: 'success' | 'warning' | 'error'; title: string; detail: string };

const baseButton = {
  padding: '8px 12px', borderRadius: 6, border: `1px solid ${C.cyan}66`,
  background: `${C.cyan}16`, color: C.cyan, fontFamily: F.disp,
  fontSize: 12, cursor: 'pointer', minWidth: 126, fontWeight: 700,
};

export function ModelReadinessControl({
  providerId,
  modelAlias,
  providerName,
  ready,
  disabled = false,
  onRefresh,
  onMessage,
}: {
  providerId: string;
  modelAlias: string;
  providerName: string;
  ready: boolean;
  disabled?: boolean;
  onRefresh?: () => void | Promise<void>;
  onMessage?: (message: string) => void;
}) {
  const [message, setMessage] = useState<ReadinessMessage | null>(null);
  const [testing, setTesting] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const origin = useRef<HTMLElement | null>(null);

  useEffect(() => { setMessage(null); setConfirmOpen(false); }, [providerId, modelAlias]);

  const verified = ready || message?.tone === 'success';
  const reloadRequired = message?.title === 'Request not sent' && message.detail.startsWith('LiteLLM');
  const failed = message?.tone === 'error';
  const color = verified ? C.green : failed ? C.danger : C.warn;
  const label = verified ? 'Model verified' : testing ? 'Testing…' : reloadRequired ? (restartBusy ? 'Reloading…' : 'Reload proxy') : failed ? 'Retry test' : 'Test model';
  const detail = verified
    ? 'This model is accessible through ClawNex. Verification remains valid for 30 minutes unless the configuration changes.'
    : reloadRequired
      ? 'LiteLLM must load the current model configuration before the required access test can run.'
      : failed
        ? `${message.title}: ${message.detail}`
        : 'Required before routing. This test confirms that the selected model is accessible through the ClawNex proxy.';
  const actionDisabled = disabled || verified || testing || restartBusy;

  const runTest = async () => {
    setTesting(true); setMessage(null); onMessage?.('');
    try {
      const response = await fetch(`/api/config/providers/${encodeURIComponent(providerId)}/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'inference', modelAlias, approved: true }),
      });
      const result = await response.json();
      const failures: Record<string, ReadinessMessage> = {
        'reload-required': { tone: 'warning', title: 'Request not sent', detail: 'LiteLLM has not loaded this configuration. Reload the proxy here, then test again.' },
        'not-configured': { tone: 'warning', title: 'Request not sent', detail: 'Add this model to its provider and sync the configuration first.' },
        'invalid-configuration': { tone: 'error', title: 'Proxy test failed', detail: 'The proxy configuration is missing or invalid.' },
        'proxy-unavailable': { tone: 'error', title: 'Proxy test failed', detail: 'ClawNex cannot inspect the running LiteLLM proxy.' },
        'inference-failed': { tone: 'error', title: 'Proxy test failed', detail: 'The selected model did not return a successful response.' },
        'shield-unavailable': { tone: 'error', title: 'ClawNex Shield unavailable', detail: 'Shield could not scan the test, so the request was blocked before provider inference.' },
        'inference-timeout': { tone: 'error', title: 'Proxy test timed out', detail: 'The provider did not complete the test within 125 seconds.' },
        'invalid-response': { tone: 'error', title: 'Proxy test failed', detail: 'The provider returned an incomplete response.' },
        'configuration-changed': { tone: 'warning', title: 'Result not retained', detail: 'Configuration changed during the test. Review it and test again.' },
      };
      const next = response.ok && result.ready
        ? { tone: 'success' as const, title: 'Tested', detail: 'The model returned a successful response through ClawNex.' }
        : failures[result.status] || { tone: 'error' as const, title: 'Proxy test failed', detail: 'The connection test could not be completed.' };
      setMessage(next);
      if (next.tone !== 'success') onMessage?.(`${next.title}: ${next.detail}`);
      await onRefresh?.();
    } catch {
      const next = { tone: 'error' as const, title: 'Test result unavailable', detail: 'ClawNex could not confirm the model test.' };
      setMessage(next); onMessage?.(`${next.title}: ${next.detail}`);
    } finally { setTesting(false); }
  };

  const restartLiteLLM = async () => {
    setRestartBusy(true); onMessage?.('');
    try {
      const response = await fetch('/api/system/litellm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restart' }) });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error(result.error || 'Restart failed.');
      setMessage({ tone: 'warning', title: 'Test required', detail: 'LiteLLM reloaded. Test the model again when the proxy is ready.' });
      onMessage?.('LiteLLM reload requested. Test the model again when the proxy is ready.');
      await onRefresh?.();
    } catch (error) { onMessage?.(error instanceof Error ? error.message : 'LiteLLM reload could not be confirmed.'); }
    finally { setRestartBusy(false); }
  };

  return <>
    <Tooltip placement="top" variant="detail" content={<span>{detail}</span>}>
      <button type="button" aria-label={`${label}: ${detail}`} disabled={actionDisabled}
        style={{ ...baseButton, color: actionDisabled && !verified ? C.txT : color,
          borderColor: actionDisabled && !verified ? C.glassBorderSubtle : `${color}66`,
          background: actionDisabled && !verified ? C.glassSurfTrans : `${color}16`,
          cursor: verified ? 'default' : actionDisabled ? 'not-allowed' : 'pointer',
          opacity: verified ? 1 : actionDisabled ? 0.45 : 1, flex: '0 0 auto' }}
        onClick={event => {
          if (actionDisabled) return;
          if (reloadRequired) { void restartLiteLLM(); return; }
          origin.current = event.currentTarget; setConfirmOpen(true);
        }}>{verified ? '✓ ' : failed ? '✕ ' : ''}{label}</button>
    </Tooltip>
    <ConfirmDialog open={confirmOpen} title="Test model" confirmLabel="Run test" returnFocusTo={origin.current}
      body={<p>Send the harmless prompt “Reply with OK.” through ClawNex to <b>{modelAlias}</b> using <b>{providerName}</b>? This makes one inference request and may incur provider charges. It does not change agent routing.</p>}
      onCancel={() => setConfirmOpen(false)} onConfirm={() => { setConfirmOpen(false); void runTest(); }} />
  </>;
}
