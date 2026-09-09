/**
 * Hermes credential discovery for assisted routing.
 *
 * The browser only receives a masked description. The actual value is read
 * server-side for the explicit "wire this model" action and is never returned
 * in an inventory response, audit detail, or routing sidecar.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export type HermesCredentialSource = 'inline' | 'environment' | 'auth-pool' | 'external-secret' | 'oauth' | 'missing';

export interface HermesCredentialPreview {
  source: HermesCredentialSource;
  available: boolean;
  envName: string | null;
  masked: string | null;
  last4: string | null;
  detail: string;
}

export interface HermesCredentialResolution {
  preview: HermesCredentialPreview;
  value: string | null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseDotEnv(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && value) result[key] = value;
  }
  return result;
}

function readHermesEnv(configPath: string): Record<string, string> {
  const candidates = [path.join(path.dirname(configPath), '.env'), path.join(path.dirname(path.dirname(configPath)), '.env')];
  const result: Record<string, string> = {};
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) Object.assign(result, parseDotEnv(fs.readFileSync(candidate, 'utf8')));
    } catch {
      // Discovery remains useful when an optional env file is unreadable.
    }
  }
  return result;
}

function mask(value: string): string {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(16, Math.max(4, value.length - 8)))}${value.slice(-4)}`;
}

function preview(source: HermesCredentialSource, value: string | null, envName: string | null, detail: string): HermesCredentialPreview {
  return {
    source,
    available: Boolean(value),
    envName,
    masked: value ? mask(value) : null,
    last4: value ? value.slice(-4) : null,
    detail,
  };
}

function authPoolExists(configPath: string): boolean {
  return fs.existsSync(path.join(path.dirname(configPath), 'auth.json'))
    || fs.existsSync(path.join(path.dirname(path.dirname(configPath)), 'auth.json'));
}

export function resolveHermesCredential(input: {
  configPath: string;
  config: Record<string, unknown>;
  providerId: string;
  model: Record<string, unknown>;
}): HermesCredentialResolution {
  const model = input.model;
  const inline = stringValue(model.api_key) || stringValue(model.apiKey);
  if (inline) return { value: inline, preview: preview('inline', inline, null, 'API key is stored directly in the Hermes model/provider configuration.') };

  const envName = stringValue(model.key_env) || stringValue(model.keyEnv);
  if (envName) {
    const env = process.env[envName] || readHermesEnv(input.configPath)[envName] || null;
    if (env) return { value: env, preview: preview('environment', env, envName, `Hermes references ${envName}; ClawNex found its value in the Hermes environment.`) };
    return { value: null, preview: preview('environment', null, envName, `Hermes references ${envName}, but that variable is not readable by ClawNex.`) };
  }

  const external = stringValue(model.secret_ref) || stringValue(model.secret_source) || stringValue(input.config.secret_source);
  if (external) return { value: null, preview: preview('external-secret', null, null, `Hermes delegates this credential to ${external}; ClawNex cannot read it automatically.`) };
  if (authPoolExists(input.configPath)) return { value: null, preview: preview('auth-pool', null, null, 'Hermes has an auth pool, but this model credential is not exposed as a readable API key.') };
  if (stringValue(model.oauth_provider) || stringValue(input.config.oauth_provider)) {
    return { value: null, preview: preview('oauth', null, null, 'This model uses OAuth/session credentials. ClawNex cannot copy or proxy that credential automatically.') };
  }
  return { value: null, preview: preview('missing', null, null, 'No readable API key or environment reference was found for this Hermes model.') };
}

export function findHermesModelCredential(input: {
  configPath: string;
  providerId: string;
  primaryModel?: boolean;
}): HermesCredentialResolution {
  const raw = fs.readFileSync(input.configPath, 'utf8');
  const data = (YAML.parse(raw) || {}) as Record<string, unknown>;
  if (input.primaryModel) {
    const model = (data.model && typeof data.model === 'object' ? data.model : {}) as Record<string, unknown>;
    const primary = resolveHermesCredential({ configPath: input.configPath, config: data, providerId: input.providerId, model });
    if (primary.value || primary.preview.source !== 'missing') return primary;

    // Hermes commonly keeps the primary model in `model` but stores its API
    // key on the named custom provider. Resolve that provider before declaring
    // the model unwireable.
    const providers = Array.isArray(data.custom_providers) ? data.custom_providers : [];
    const provider = providers.find((entry) => entry && typeof entry === 'object' && stringValue((entry as Record<string, unknown>).name) === input.providerId);
    if (provider && typeof provider === 'object') {
      return resolveHermesCredential({
        configPath: input.configPath,
        config: data,
        providerId: input.providerId,
        model: provider as Record<string, unknown>,
      });
    }
    return primary;
  }
  const providers = Array.isArray(data.custom_providers) ? data.custom_providers : [];
  const provider = providers.find((entry) => entry && typeof entry === 'object' && stringValue((entry as Record<string, unknown>).name) === input.providerId);
  const model = (provider && typeof provider === 'object' ? provider : {}) as Record<string, unknown>;
  return resolveHermesCredential({ configPath: input.configPath, config: data, providerId: input.providerId, model });
}
