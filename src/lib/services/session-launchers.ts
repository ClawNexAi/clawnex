import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type SessionLauncherId = 'codex' | 'claude' | 'opencode' | 'pi' | 'hermes';
export type SessionLauncherProtocol = 'responses' | 'messages' | 'chat';

export interface SessionLauncherAvailability {
  id: SessionLauncherId;
  label: string;
  protocol: SessionLauncherProtocol;
  installed: boolean;
}

const definitions: Array<Omit<SessionLauncherAvailability, 'installed'> & { bin: string }> = [
  { id: 'codex', label: 'Codex', protocol: 'responses', bin: 'codex' },
  { id: 'claude', label: 'Claude Code', protocol: 'messages', bin: 'claude' },
  { id: 'opencode', label: 'OpenCode', protocol: 'chat', bin: 'opencode' },
  { id: 'pi', label: 'Pi', protocol: 'chat', bin: 'pi' },
  { id: 'hermes', label: 'Hermes', protocol: 'chat', bin: 'hermes' },
];

function executableExists(bin: string): boolean {
  const home = os.homedir();
  const candidates = [
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, bin)),
    path.join(home, '.npm-global', 'bin', bin),
    path.join(home, '.local', 'bin', bin),
    path.join(home, '.bun', 'bin', bin),
    path.join(home, '.cargo', 'bin', bin),
    `/usr/local/bin/${bin}`,
    `/opt/homebrew/bin/${bin}`,
  ];
  return [...new Set(candidates)].some(candidate => {
    try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch { return false; }
  });
}

export function listSessionLaunchers(): SessionLauncherAvailability[] {
  return definitions.map(({ bin, ...definition }) => ({ ...definition, installed: executableExists(bin) }));
}
