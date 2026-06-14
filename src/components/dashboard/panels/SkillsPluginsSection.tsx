"use client";

import { useState, useEffect, useCallback } from "react";
import { C } from '../constants';
import { Badge, Card, CollapsibleCard, EmptyState, Stat, Table, PaginationFooter } from '../shared';
import { stColor } from '../utils';

interface SkillData {
  name: string;
  description: string;
  source: 'system' | 'workspace' | 'paperclip';
  type: 'skill' | 'plugin';
  status: string;
  risk: string;
}

export function SkillsPluginsSection() {
  const [skills, setSkills] = useState<SkillData[]>([]);
  const [sources, setSources] = useState<Array<{ name: string; status: string; count: number }>>([]);
  const [byRisk, setByRisk] = useState<{ high: number; medium: number; low: number }>({ high: 0, medium: 0, low: 0 });
  const [loading, setLoading] = useState(true);
  // v0.11.5+: rule-of-5 pagination — operator directive: skill sub-cards default 5/page.
  const [sysPageSize, setSysPageSize] = useState(5);
  const [sysPage, setSysPage] = useState(0);
  const [wsPageSize, setWsPageSize] = useState(5);
  const [wsPage, setWsPage] = useState(0);
  const [pcPageSize, setPcPageSize] = useState(5);
  const [pcPage, setPcPage] = useState(0);

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch("/api/skills");
      if (res.ok) {
        const data = await res.json();
        setSkills(data.skills || []);
        setSources(data.sources || []);
        setByRisk(data.byRisk || { high: 0, medium: 0, low: 0 });
      }
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  if (loading) return null;

  const systemSkills = skills.filter(s => s.source === 'system');
  const workspaceSkills = skills.filter(s => s.source === 'workspace');
  const paperclipPlugins = skills.filter(s => s.source === 'paperclip');

  const riskColor = (r: string) => r === 'HIGH' ? C.danger : r === 'MEDIUM' ? C.warn : C.green;
  const sourceColor = (s: string) => s === 'system' ? C.cyan : s === 'workspace' ? C.brand : C.purp;

  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Stat label="Total Skills" value={skills.length} color={C.brand} small />
        {sources.map(s => (
          <Stat key={s.name} label={s.name.replace('OpenClaw ', '')} value={s.count} color={s.status === 'online' ? C.green : C.txT} small />
        ))}
        <Stat label="High Risk" value={byRisk.high} color={byRisk.high > 0 ? C.danger : C.txT} small />
        <Stat label="Medium Risk" value={byRisk.medium} color={byRisk.medium > 0 ? C.warn : C.txT} small />
      </div>

      {systemSkills.length > 0 && (() => {
        const total = Math.max(1, Math.ceil(systemSkills.length / sysPageSize));
        const safe = Math.min(sysPage, total - 1);
        const paged = systemSkills.slice(safe * sysPageSize, (safe + 1) * sysPageSize);
        return (
          <CollapsibleCard title="System Skills" accent={C.cyan} count={systemSkills.length}>
            <Table
              headers={["Name", "Description", "Risk", "Status"]}
              rows={paged.map(s => [
                <span key="n" style={{ fontWeight: 600 }}>{s.name}</span>,
                <span key="d" style={{ fontSize: 11, color: C.txS }}>{s.description}</span>,
                <Badge key="r" label={s.risk} color={riskColor(s.risk)} />,
                <Badge key="s" label={s.status} color={stColor(s.status)} />,
              ])}
            />
            {total > 1 && (
              <PaginationFooter
                currentPage={safe}
                totalPages={total}
                pageSize={sysPageSize}
                totalRows={systemSkills.length}
                onPageSizeChange={(n) => { setSysPageSize(n); setSysPage(0); }}
                onPageChange={setSysPage}
              />
            )}
          </CollapsibleCard>
        );
      })()}

      {workspaceSkills.length > 0 && (() => {
        const total = Math.max(1, Math.ceil(workspaceSkills.length / wsPageSize));
        const safe = Math.min(wsPage, total - 1);
        const paged = workspaceSkills.slice(safe * wsPageSize, (safe + 1) * wsPageSize);
        return (
          <CollapsibleCard title="Workspace Skills" accent={C.brand} count={workspaceSkills.length} defaultOpen={false}>
            <Table
              headers={["Name", "Description", "Risk", "Status"]}
              rows={paged.map(s => [
                <span key="n" style={{ fontWeight: 600 }}>{s.name}</span>,
                <span key="d" style={{ fontSize: 11, color: C.txS }}>{s.description}</span>,
                <Badge key="r" label={s.risk} color={riskColor(s.risk)} />,
                <Badge key="s" label={s.status} color={stColor(s.status)} />,
              ])}
            />
            {total > 1 && (
              <PaginationFooter
                currentPage={safe}
                totalPages={total}
                pageSize={wsPageSize}
                totalRows={workspaceSkills.length}
                onPageSizeChange={(n) => { setWsPageSize(n); setWsPage(0); }}
                onPageChange={setWsPage}
              />
            )}
          </CollapsibleCard>
        );
      })()}

      {paperclipPlugins.length > 0 && (() => {
        const total = Math.max(1, Math.ceil(paperclipPlugins.length / pcPageSize));
        const safe = Math.min(pcPage, total - 1);
        const paged = paperclipPlugins.slice(safe * pcPageSize, (safe + 1) * pcPageSize);
        return (
          <CollapsibleCard title="Paperclip Plugins" accent={C.purp} count={paperclipPlugins.length} defaultOpen={false}>
            <Table
              headers={["Plugin", "Description", "Risk", "Status"]}
              rows={paged.map(s => [
                <span key="n" style={{ fontWeight: 600 }}>{s.name}</span>,
                <span key="d" style={{ fontSize: 11, color: C.txS }}>{s.description}</span>,
                <Badge key="r" label={s.risk} color={riskColor(s.risk)} />,
                <Badge key="s" label={s.status} color={stColor(s.status)} />,
              ])}
            />
            {total > 1 && (
              <PaginationFooter
                currentPage={safe}
                totalPages={total}
                pageSize={pcPageSize}
                totalRows={paperclipPlugins.length}
                onPageSizeChange={(n) => { setPcPageSize(n); setPcPage(0); }}
                onPageChange={setPcPage}
              />
            )}
          </CollapsibleCard>
        );
      })()}

      {skills.length === 0 && (
        <Card title="Skills & Plugins" accent={C.txT}>
          <EmptyState message="No skills or plugins detected. Skills are loaded from ~/.openclaw/skills/ and ~/.openclaw/workspace/skills/" />
        </Card>
      )}
    </>
  );
}
