import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type NativeAgent = 'pi';
export type FieldPath = Array<string | number>;
export type ConfigObject = Record<string, any>;
export interface NativeDocument { path: string; raw: string; data: ConfigObject }
export interface NativeProvider {
  id: string; name: string; baseUrl: string; supported: boolean; reason: string;
  base: FieldPath; credential: FieldPath; headers: FieldPath;
  models: Array<{ id: string; path: FieldPath; name: string }>;
}
export const nativeLabels: Record<NativeAgent, string> = { pi: 'Pi' };
export function nativeConfigPath(type: NativeAgent): string {
  if (type === 'pi') return path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent'), 'models.json');
  throw new Error('Unsupported native agent.');
}
export function assertNativePath(file: string, missing = false): void {
  const home = fs.realpathSync(os.homedir());
  const absolute = path.resolve(file);
  if (!absolute.startsWith(path.resolve(os.homedir()) + path.sep)) throw new Error('Agent configuration must be inside the current user home.');
  let parent = path.dirname(absolute);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const realParent = fs.realpathSync(parent);
  if (realParent !== home && !realParent.startsWith(home + path.sep)) throw new Error('Agent configuration resolves outside the current user home.');
  if (!fs.existsSync(file) && missing) return;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4 * 1024 * 1024) throw new Error('Agent configuration must be a regular, non-linked file smaller than 4 MB.');
}
export function readNativeDocument(file: string, missing = false): NativeDocument {
  assertNativePath(file, missing);
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const data = raw ? JSON.parse(raw) : {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Agent configuration must contain an object.');
  return { path: file, raw, data };
}
export function nativeDocuments(type: NativeAgent): NativeDocument[] {
  const primary = readNativeDocument(nativeConfigPath(type));
  return [primary, readNativeDocument(path.join(path.dirname(primary.path), 'settings.json'), true)];
}
export function nativeConfigCheck(type: NativeAgent) {
  const configPath = nativeConfigPath(type);
  try { nativeDocuments(type); return { available: true, configPath, error: null }; }
  catch { return { available: false, configPath, error: `${nativeLabels[type]} global configuration is missing, invalid, or not safely writable.` }; }
}
export function field(data: ConfigObject, keys: FieldPath): unknown {
  let value: any = data;
  for (const key of keys) { if (value == null || typeof value !== 'object') return undefined; value = value[key]; }
  return value;
}
export function setField(data: ConfigObject, keys: FieldPath, value: unknown, present = true): void {
  let parent: any = data;
  for (const key of keys.slice(0, -1)) {
    if (['__proto__', 'prototype', 'constructor'].includes(String(key))) throw new Error('Unsupported configuration key.');
    if (parent[key] === undefined) parent[key] = {};
    if (!parent[key] || typeof parent[key] !== 'object') throw new Error('Configuration container changed.');
    parent = parent[key];
  }
  const key = keys.at(-1)!;
  if (['__proto__', 'prototype', 'constructor'].includes(String(key))) throw new Error('Unsupported configuration key.');
  if (present) parent[key] = value; else delete parent[key];
}
export function nativeProviders(type: NativeAgent, doc: NativeDocument): NativeProvider[] {
  if (type !== 'pi') return [];
  return Object.entries(doc.data.providers || {}).map(([id, p]: [string, any]) => {
    const models = Array.isArray(p?.models) ? p.models : [];
    const supported = !!p && typeof p.baseUrl === 'string' && models.length > 0 && !p.oauth && !p.modelOverrides &&
      models.every((m: any) => typeof m.id === 'string' && (m.api || p.api) === 'openai-completions' && !m.baseUrl && !m.headers && !m.samplingParams?.model) &&
      (!p.headers || typeof p.headers === 'object' && !Array.isArray(p.headers));
    return { id, name: id, baseUrl: typeof p?.baseUrl === 'string' ? p.baseUrl : '', supported,
      reason: 'Only explicit global OpenAI Chat Completions providers are managed. OAuth, extensions, per-model endpoints/headers and project overrides remain outside coverage.',
      base: ['providers', id, 'baseUrl'], credential: ['providers', id, 'apiKey'], headers: ['providers', id, 'headers'],
      models: models.map((m: any, index: number) => ({ id: String(m.id || ''), name: String(m.name || m.id || ''), path: ['providers', id, 'models', index, 'id'] })) };
  });
}
