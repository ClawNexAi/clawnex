import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { queryAll, queryOne } from '@/lib/db';
import { nativeDocuments, nativeConfigCheck, nativeLabels, nativeProviders, nativeHeaders, field, setField, assertNativePath, serializeNativeDocument, readNativeDocument, type NativeAgent, type FieldPath, type NativeDocument } from './native-agent-config';
import { publishRoutingFile, removeRoutingJournal } from './routing-file-transaction';
import { createRoutingIdentity, routingIdentityHash, ROUTING_IDENTITY_HEADER } from './routing-identity';
import { stableRoutingFingerprint as hash } from './routing-reconciliation';
import { sealRoutingCredential, openRoutingCredential, type EncryptedRoutingCredential } from './routing-credential-recovery';
import { resolveConfiguredProxyModel } from './configured-proxy-model';
import type { ConnectorRoutingSummary, DiscoveredRoutingItem, RoutingApplyScope, ApplyOpenClawRoutingResult } from './connector-routing-inventory';

interface OwnedField { file: string; path: FieldPath; before: EncryptedRoutingCredential; afterHash: string }
interface OwnedProvider { providerId: string; baseUrl: string; identityHash: string; fields: OwnedField[]; models: Array<{ originalId: string; alias: string; path: FieldPath }> }
interface Journal { version: 1; providers: OwnedProvider[] }
export function nativeJournal(type: NativeAgent) { return path.join(os.homedir(), `.clawnex-${type}-routing-managed.json`); }
function readJournal(type: NativeAgent): Journal | null {
  const file = nativeJournal(type);
  if (!fs.existsSync(file)) return null;
  try {
    assertNativePath(file);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.providers) || data.providers.some((p: OwnedProvider) => !p.providerId || !Array.isArray(p.fields) || !Array.isArray(p.models))) throw new Error('Invalid');
    return data;
  } catch { throw new Error(`${nativeLabels[type]} recovery ownership is unreadable. Recover it before changing routing.`); }
}
export function hasNativeOwnership(type: NativeAgent) { return !!readJournal(type)?.providers.length; }
export function nativeOwnershipFingerprint(type: NativeAgent) { return hash(readJournal(type)); }
function route(base: string, type: NativeAgent): 'routed' | 'direct' | 'unsupported' {
  try {
    const u = new URL(base);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) return 'unsupported';
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && u.port === (process.env.LITELLM_PORT || '4001') && u.pathname.replace(/\/$/, '') === (type === 'claude' ? '' : '/v1') ? 'routed' : 'direct';
  } catch { return 'unsupported'; }
}
export function discoverNativeItems(type: NativeAgent): { status: ConnectorRoutingSummary['status']; detail: string; sourceId: string; items: DiscoveredRoutingItem[] } {
  const sourceId = `${type}:global`, name = nativeLabels[type];
  const connector = queryOne<{ id: string; name: string }>('SELECT id, name FROM coding_agent_connectors WHERE type = ? AND is_active = 1 LIMIT 1', [type]);
  if (!connector) return { status: 'missing', detail: `${name} connector is not configured.`, sourceId, items: [] };
  const check = nativeConfigCheck(type);
  if (!check.available) return { status: 'error', detail: check.error!, sourceId, items: [] };
  try {
    const docs = nativeDocuments(type), primary = docs[0];
    const owners = readJournal(type)?.providers || [];
    const items: DiscoveredRoutingItem[] = [];
    for (const p of nativeProviders(type, primary)) {
      const owner = owners.find(o => o.providerId === p.id);
      const headers = nativeHeaders(primary, p);
      const token = headers && Object.entries(headers).find(([key]) => key.toLowerCase() === ROUTING_IDENTITY_HEADER)?.[1];
      const intact = owner ? owner.fields.every(f => {
        const doc = docs.find(d => d.path === f.file);
        return doc && hash(field(doc.data, f.path) ?? null) === f.afterHash;
      }) : null;
      const currentRoute = route(p.baseUrl, type);
      const capability = p.supported && currentRoute !== 'unsupported' ? 'provider-routing' : 'unsupported';
      const metadata = { configPath: primary.path, configPaths: docs.map(d => d.path), connectorId: connector.id, profileName: connector.name,
        globalOnly: true, initialSetup: p.initial || false, note: p.reason, identityHash: owner?.identityHash || null,
        identityFingerprint: typeof token === 'string' ? routingIdentityHash(token) : null,
        identityIntact: owner ? intact && typeof token === 'string' && routingIdentityHash(token) === owner.identityHash : null };
      items.push({ connector: type, sourceId, itemType: 'provider', providerId: p.id, modelId: '', displayName: p.name, baseUrl: p.baseUrl || null,
        capability, currentRoute, defaultDesiredRoute: currentRoute === 'routed' ? 'routed' : 'direct', metadata });
      for (const model of p.models) {
        const saved = owner?.models.find(m => JSON.stringify(m.path) === JSON.stringify(model.path));
        const originalId = saved?.originalId || model.id;
        const alias = saved?.alias || resolveConfiguredProxyModel(originalId, { providerId: p.id, baseUrl: p.baseUrl })?.modelAlias || originalId;
        items.push({ connector: type, sourceId, itemType: 'model', providerId: p.id, modelId: originalId, displayName: model.name,
          baseUrl: p.baseUrl, capability: capability === 'provider-routing' ? 'model-inventory' : 'unsupported', currentRoute,
          defaultDesiredRoute: currentRoute === 'routed' ? 'routed' : 'direct', metadata: { ...metadata, proxyModelAlias: alias, enforcedAt: 'provider' } });
      }
    }
    return { status: 'ok', detail: `${name} native global configuration. Start a new session after Apply or Restore. Project, command-line, environment and extension overrides are outside this connector's coverage.`, sourceId, items };
  } catch { return { status: 'error', detail: `${name} configuration or recovery ownership cannot be read safely.`, sourceId, items: [] }; }
}
function context(type: NativeAgent, provider: string, file: string, keys: FieldPath) { return JSON.stringify([type, provider, file, keys]); }
function capture(type: NativeAgent, owner: OwnedProvider, doc: NativeDocument, keys: FieldPath, value: unknown, remove = false) {
  const before = field(doc.data, keys);
  const absentParents = keys.slice(0, -1).map((_, i) => keys.slice(0, i + 1)).filter(p => field(doc.data, p) === undefined);
  owner.fields.push({ file: doc.path, path: keys, before: sealRoutingCredential(nativeJournal(type), context(type, owner.providerId, doc.path, keys), { present: before !== undefined, value: before ?? null, absentParents }), afterHash: hash(value ?? null) });
  setField(doc.data, keys, value, !remove);
}
function original(type: NativeAgent, owner: OwnedProvider, f: OwnedField): { present: boolean; value: unknown; absentParents?: FieldPath[] } {
  return openRoutingCredential(nativeJournal(type), context(type, owner.providerId, f.file, f.path), f.before) as { present: boolean; value: unknown; absentParents?: FieldPath[] };
}
/** All original fields are journaled before any config write. An interrupted multi-file
 * update remains restorable: a field must still equal its before or after value. */
function commit(type: NativeAgent, docs: NativeDocument[], journal: Journal, previous: Journal | null) {
  for (const d of docs) {
    assertNativePath(d.path, !d.raw);
    if ((fs.existsSync(d.path) ? fs.readFileSync(d.path, 'utf8') : '') !== d.raw) throw new Error('Configuration changed during review. Refresh and review again.');
  }
  if (hash(readJournal(type)) !== hash(previous)) throw new Error('Recovery ownership changed during review.');
  publishRoutingFile(nativeJournal(type), JSON.stringify(journal, null, 2), 0o600);
  for (const d of docs) {
    const content = serializeNativeDocument(d);
    if (JSON.stringify(readNativeDocument(d.path, !d.raw).data) === JSON.stringify(d.data)) continue;
    if ((fs.existsSync(d.path) ? fs.readFileSync(d.path, 'utf8') : '') !== d.raw) throw new Error('Configuration changed during write. Recovery ownership retained.');
    fs.mkdirSync(path.dirname(d.path), { recursive: true, mode: 0o700 });
    const stat = fs.existsSync(d.path) ? fs.statSync(d.path) : undefined;
    publishRoutingFile(d.path, content, 0o600, stat);
  }
}
export function applyNativeRouting(type: NativeAgent, scope: RoutingApplyScope = {}): ApplyOpenClawRoutingResult {
  if (scope.sourceId !== `${type}:global`) throw new Error('Select the native global instance.');
  const docs = nativeDocuments(type), primary = docs[0];
  if (scope.expectedFiles && docs.some(d => scope.expectedFiles![d.path] !== hash(d.raw))) throw new Error('Agent configuration changed since review.');
  const previous = readJournal(type), journal: Journal = structuredClone(previous || { version: 1, providers: [] });
  const selected = new Set(queryAll<{ provider_id: string }>("SELECT DISTINCT provider_id FROM connector_routing_items WHERE connector = ? AND present = 1 AND desired_route = 'routed' AND capability IN ('provider-routing','model-inventory')", [type]).map(r => r.provider_id));
  const routedProviders: string[] = [], restoredProviders: string[] = [], skippedProviders: Array<{ providerId: string; reason: string }> = [];
  const restoreIds = new Set<string>();
  for (const p of nativeProviders(type, primary)) {
    const owner = journal.providers.find(o => o.providerId === p.id);
    if (owner) {
      const intact = owner.fields.every(f => {
        const d = docs.find(d => d.path === f.file); if (!d) return false;
        const current = field(d.data, f.path), before = original(type, owner, f);
        return hash(current ?? null) === f.afterHash || scope.restore && hash(current ?? null) === hash(before.present ? before.value : null);
      });
      if (!intact) { skippedProviders.push({ providerId: p.id, reason: 'A managed field changed. Operator edits and encrypted recovery ownership were preserved.' }); continue; }
      if (scope.restore && !selected.has(p.id)) {
        for (const f of [...owner.fields].reverse()) {
          const before = original(type, owner, f), data = docs.find(d => d.path === f.file)!.data;
          setField(data, f.path, before.value, before.present);
          for (const parent of [...(before.absentParents || [])].reverse()) {
            const value = field(data, parent);
            if (value && typeof value === 'object' && !Object.keys(value).length) setField(data, parent, null, false);
          }
        }
        restoredProviders.push(p.id); restoreIds.add(p.id);
      }
      continue;
    }
    if (scope.restore || !selected.has(p.id)) continue;
    if (!p.supported || route(p.baseUrl, type) !== 'direct') { skippedProviders.push({ providerId: p.id, reason: p.reason }); continue; }
    const key = process.env.LITELLM_MASTER_KEY;
    if (!key) throw new Error('Configure the local LiteLLM access key before applying routing.');
    const identity = createRoutingIdentity(type, `${type}:global`);
    if (!identity) throw new Error('Configure the ClawNex ingest secret before applying routing.');
    const existingHeaders = nativeHeaders(primary, p);
    if (existingHeaders && Object.keys(existingHeaders).some(k => k.toLowerCase() === ROUTING_IDENTITY_HEADER)) throw new Error('The routing identity header is already operator-owned.');
    const record: OwnedProvider = { providerId: p.id, baseUrl: p.baseUrl, identityHash: identity.hash, fields: [], models: [] };
    for (const m of p.models) {
      const configured = resolveConfiguredProxyModel(m.id, { providerId: p.id, baseUrl: p.baseUrl });
      if (!configured) throw new Error('A model has no unique configured ClawNex alias. Configure and test the exact upstream model first.');
      record.models.push({ originalId: m.id, alias: configured.modelAlias, path: m.path });
      capture(type, record, primary, m.path, configured.modelAlias);
      if (type === 'pi' && docs[1]?.data.defaultProvider === p.id && docs[1]?.data.defaultModel === m.id) capture(type, record, docs[1], ['defaultModel'], configured.modelAlias);
    }
    capture(type, record, primary, p.base, `http://127.0.0.1:${process.env.LITELLM_PORT || '4001'}${type === 'claude' ? '' : '/v1'}`);
    capture(type, record, primary, p.credential, type === 'pi' ? key.replace(/\$/g, '$$$$') : key);
    if (type === 'pi') capture(type, record, primary, ['providers', p.id, 'authHeader'], true);
    if (p.headerFormat === 'lines') {
      const originalHeaders = field(primary.data, p.headers);
      capture(type, record, primary, p.headers, `${typeof originalHeaders === 'string' && originalHeaders ? originalHeaders.trimEnd() + '\n' : ''}${ROUTING_IDENTITY_HEADER}: ${identity.token}`);
    } else capture(type, record, primary, [...p.headers, ROUTING_IDENTITY_HEADER], identity.token);
    for (const extra of p.extra || []) capture(type, record, primary, extra.path, extra.value, extra.remove);
    journal.providers.push(record); routedProviders.push(p.id);
  }
  const changed = routedProviders.length + restoredProviders.length > 0;
  if (changed) {
    commit(type, docs, journal, previous);
    journal.providers = journal.providers.filter(p => !restoreIds.has(p.providerId));
    if (journal.providers.length) publishRoutingFile(nativeJournal(type), JSON.stringify(journal, null, 2), 0o600);
    else removeRoutingJournal(nativeJournal(type));
  }
  return { ok: skippedProviders.length === 0, status: skippedProviders.length ? 'error' : changed ? 'applied' : 'noop',
    detail: changed ? `${nativeLabels[type]} configuration updated. Start a new session before verification.` : skippedProviders.length ? 'Operator edits were preserved; review the conflicts.' : 'Routing already matches the selected providers.',
    restartRequired: changed, routedProviders, restoredProviders, skippedProviders, sidecarPath: nativeJournal(type) };
}
