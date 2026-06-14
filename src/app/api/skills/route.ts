/**
 * Skills & Plugins API
 * GET /api/skills — returns skills from OpenClaw + plugins from Paperclip (if available)
 *
 * Sources:
 *   1. OpenClaw system skills (~/.openclaw/skills/) — always available
 *   2. OpenClaw workspace skills (~/.openclaw/workspace/skills/) — always available
 *   3. Paperclip plugins (PAPERCLIP_URL/api/plugins) — optional, gracefully skipped if unavailable
 *
 * READ-ONLY access to all sources.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SkillEntry {
  name: string;
  description: string;
  source: 'system' | 'workspace' | 'paperclip';
  type: 'skill' | 'plugin';
  status: 'active' | 'inactive' | 'unknown';
  path?: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  metadata?: Record<string, unknown>;
}

function classifyRisk(name: string, description: string): 'LOW' | 'MEDIUM' | 'HIGH' {
  const desc = (name + ' ' + description).toLowerCase();
  if (desc.includes('browser') || desc.includes('bash') || desc.includes('shell') || desc.includes('deploy') || desc.includes('exec')) return 'HIGH';
  if (desc.includes('api') || desc.includes('email') || desc.includes('slack') || desc.includes('web') || desc.includes('crm') || desc.includes('trello')) return 'MEDIUM';
  return 'LOW';
}

function parseSkillMd(content: string): { name: string; description: string } {
  let name = '';
  let description = '';

  // Parse YAML frontmatter
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    const descMatch = fm.match(/^description:\s*"?(.+?)"?\s*$/m);
    if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
    if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '');
  }

  // Truncate description
  if (description.length > 120) description = description.slice(0, 120) + '...';

  return { name, description };
}

function readSkillsFromDir(dir: string, source: 'system' | 'workspace'): SkillEntry[] {
  const skills: SkillEntry[] = [];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const skillDir = join(dir, entry);
      try {
        if (!statSync(skillDir).isDirectory()) continue;
      } catch { continue; }

      const skillMdPath = join(skillDir, 'SKILL.md');
      let name = entry;
      let description = '';

      try {
        const content = readFileSync(skillMdPath, 'utf-8');
        const parsed = parseSkillMd(content);
        if (parsed.name) name = parsed.name;
        if (parsed.description) description = parsed.description;
      } catch {
        // No SKILL.md — use directory name
        description = `Skill at ${source === 'system' ? '~/.openclaw/skills' : '~/.openclaw/workspace/skills'}/${entry}`;
      }

      skills.push({
        name,
        description,
        source,
        type: 'skill',
        status: 'active',
        path: skillDir,
        risk: classifyRisk(name, description),
      });
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return skills;
}

async function readPaperclipPlugins(): Promise<SkillEntry[]> {
  const paperclipUrl = process.env.PAPERCLIP_URL;
  if (!paperclipUrl) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${paperclipUrl}/api/plugins`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return [];

    const plugins = await res.json();
    if (!Array.isArray(plugins)) return [];

    return plugins.map((p: { name?: string; description?: string; status?: string; [key: string]: unknown }) => ({
      name: p.name || 'Unknown Plugin',
      description: (p.description || '').slice(0, 120),
      source: 'paperclip' as const,
      type: 'plugin' as const,
      status: (p.status === 'active' ? 'active' : 'inactive') as 'active' | 'inactive',
      risk: classifyRisk(p.name || '', p.description || ''),
      metadata: p,
    }));
  } catch {
    // Paperclip not running or endpoint doesn't exist — graceful skip
    return [];
  }
}

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'agents:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const systemDir = join(homedir(), '.openclaw', 'skills');
    const workspaceDir = join(homedir(), '.openclaw', 'workspace', 'skills');

    // Gather from all sources in parallel
    const [systemSkills, workspaceSkills, paperclipPlugins] = await Promise.all([
      Promise.resolve(readSkillsFromDir(systemDir, 'system')),
      Promise.resolve(readSkillsFromDir(workspaceDir, 'workspace')),
      readPaperclipPlugins(),
    ]);

    const all = [...systemSkills, ...workspaceSkills, ...paperclipPlugins];

    // Source summary
    const sources: Array<{ name: string; status: string; count: number }> = [];
    sources.push({ name: 'OpenClaw System Skills', status: systemSkills.length > 0 ? 'online' : 'empty', count: systemSkills.length });
    sources.push({ name: 'OpenClaw Workspace Skills', status: workspaceSkills.length > 0 ? 'online' : 'empty', count: workspaceSkills.length });

    const paperclipUrl = process.env.PAPERCLIP_URL;
    if (paperclipUrl) {
      sources.push({ name: 'Paperclip Plugins', status: paperclipPlugins.length > 0 ? 'online' : 'connected', count: paperclipPlugins.length });
    }

    return NextResponse.json({
      skills: all,
      total: all.length,
      sources,
      byRisk: {
        high: all.filter(s => s.risk === 'HIGH').length,
        medium: all.filter(s => s.risk === 'MEDIUM').length,
        low: all.filter(s => s.risk === 'LOW').length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API/skills] Error:', err);
    return NextResponse.json({ error: 'Failed to read skills' }, { status: 500 });
  }
}
