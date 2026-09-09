import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseOpenCodeConfig } from './opencode-config';

export type CodingAgentConnectorType = 'opencode';

export interface CodingAgentConfigCheck {
  available: boolean;
  configPath: string;
  error: string | null;
}

function inside(base: string, candidate: string): boolean {
  return candidate === base || candidate.startsWith(`${base}${path.sep}`);
}

export function resolveOpenCodeGlobalConfig(): CodingAgentConfigCheck {
  const home = path.resolve(os.homedir());
  const configuredDirectory = process.env.OPENCODE_CONFIG_DIR?.trim();
  const configPath = path.resolve(configuredDirectory
    ? path.join(configuredDirectory, 'opencode.json')
    : path.join(home, '.config', 'opencode', 'opencode.json'));
  if (!inside(home, configPath)) {
    return { available: false, configPath, error: 'OpenCode global configuration must be inside this user\'s home directory.' };
  }
  try {
    const homeRealPath = fs.realpathSync(home);
    const fileStat = fs.lstatSync(configPath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.nlink !== 1) {
      return { available: false, configPath, error: 'OpenCode global configuration must be a regular file, not a link.' };
    }
    if (fileStat.size > 4 * 1024 * 1024) {
      return { available: false, configPath, error: 'OpenCode global configuration is larger than 4 MB.' };
    }
    const realPath = fs.realpathSync(configPath);
    if (!inside(homeRealPath, realPath)) {
      return { available: false, configPath, error: 'OpenCode global configuration resolves outside this user\'s home directory.' };
    }
    parseOpenCodeConfig(fs.readFileSync(realPath, 'utf8'));
    return { available: true, configPath: realPath, error: null };
  } catch (error) {
    const detail = error instanceof SyntaxError ? 'OpenCode global configuration is not valid JSON or JSONC.' : 'OpenCode global configuration was not found or could not be read.';
    return { available: false, configPath, error: detail };
  }
}
