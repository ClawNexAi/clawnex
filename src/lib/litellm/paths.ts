import fs from 'node:fs';
import path from 'node:path';

/** Select the configured file deterministically; never fall back on an explicit-path error.
 * This identifies a write target, not proof that the running proxy loaded it.
 */
export function resolveLiteLLMConfigPath(): string {
  const primary = process.env.CLAWNEX_LITELLM_CONFIG?.trim();
  const legacy = process.env.LITELLM_CONFIG_PATH?.trim();
  if (primary && legacy && primary !== legacy) {
    throw new Error('Conflicting LiteLLM configuration path settings. Configure one authoritative absolute path.');
  }
  const explicit = primary || legacy;
  if (explicit) {
    if (!path.isAbsolute(explicit)) throw new Error('Explicit LiteLLM configuration path must be absolute.');
    try {
      if (!fs.statSync(explicit).isFile()) throw new Error('not a file');
    } catch {
      throw new Error('Explicit LiteLLM configuration file is missing or invalid. No fallback file was selected.');
    }
    return explicit;
  }
  const installDir = process.env.CLAWNEX_INSTALL_DIR?.trim();
  if (installDir && !path.isAbsolute(installDir)) throw new Error('ClawNex installation directory must be absolute.');
  return path.join(installDir || process.cwd(), 'litellm', 'config.yaml');
}
