import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readOpenClawConfig } from '@/lib/openclaw-paths';

function cleanVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/(?:OpenClaw\s+)?v?(\d{4}\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?|\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match?.[1] ?? null;
}

function readPackageVersion(packageJsonPath: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
    return cleanVersion(pkg.version);
  } catch {
    return null;
  }
}

function runCliVersion(cliPath: string): string | null {
  try {
    const result = spawnSync(cliPath, ['--version'], {
      encoding: 'utf8',
      timeout: 2_500,
      env: {
        ...process.env,
        PATH: [
          path.join(os.homedir(), '.npm-global', 'bin'),
          path.join(os.homedir(), '.local', 'bin'),
          process.env.PATH ?? '',
        ].join(path.delimiter),
      },
    });
    if (result.error || result.status !== 0) return null;
    return cleanVersion(`${result.stdout || ''}\n${result.stderr || ''}`);
  } catch {
    return null;
  }
}

export function getOpenClawInstalledVersion(): string | null {
  const home = os.homedir();
  const cliCandidates = [
    process.env.OPENCLAW_CLI,
    path.join(home, '.npm-global', 'bin', 'openclaw'),
    path.join(home, '.local', 'bin', 'openclaw'),
    '/usr/local/bin/openclaw',
    '/usr/bin/openclaw',
    'openclaw',
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of cliCandidates) {
    if (candidate !== 'openclaw' && !fs.existsSync(candidate)) continue;
    const version = runCliVersion(candidate);
    if (version) return version;
  }

  const packageCandidates = [
    path.join(home, '.npm-global', 'lib', 'node_modules', 'openclaw', 'package.json'),
    path.join(home, '.local', 'lib', 'node_modules', 'openclaw', 'package.json'),
    '/usr/local/lib/node_modules/openclaw/package.json',
    '/usr/lib/node_modules/openclaw/package.json',
  ];
  for (const packageJson of packageCandidates) {
    const version = readPackageVersion(packageJson);
    if (version) return version;
  }

  try {
    const updateCheck = JSON.parse(fs.readFileSync(path.join(home, '.openclaw', 'update-check.json'), 'utf8')) as Record<string, unknown>;
    const version = cleanVersion(updateCheck.currentVersion ?? updateCheck.version ?? updateCheck.lastInstalledVersion);
    if (version) return version;
  } catch {
    // Newer OpenClaw versions may migrate update-check state into SQLite.
  }

  try {
    const meta = readOpenClawConfig()?.meta as { lastTouchedVersion?: unknown } | undefined;
    return cleanVersion(meta?.lastTouchedVersion);
  } catch {
    return null;
  }
}
