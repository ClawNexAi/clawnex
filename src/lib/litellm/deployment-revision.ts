import { createHash } from 'node:crypto';

/** Secret-free identity for the exact generated deployment, including its source file. */
export function deploymentRevision(configPath: string, modelName: string, params: Record<string, unknown>): string {
  const values = Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
  const key = values.api_key;
  if (typeof key === 'string' && key.startsWith('os.environ/')) {
    values.api_key = { reference: key, value: process.env[key.slice('os.environ/'.length)] ?? null };
  }
  return createHash('sha256').update(JSON.stringify({ configPath, modelName, params: values })).digest('hex');
}
