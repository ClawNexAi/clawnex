"use client";

import { useState, useEffect, useCallback } from "react";
import { C, F } from '../constants';
import { Badge, Card, Dot, EmptyState, LoadingSpinner, Stat } from '../shared';
import { Tooltip } from '../tooltip';
import { sevColor } from '../utils';
import type { TabId } from '../types';

export function AccessControlPanel({ demoMode, onNavigate }: { demoMode: boolean; onNavigate: (tab: TabId, focus?: string) => void }) {
  const [pathInput, setPathInput] = useState("../../etc/shadow");
  const [urlInput, setUrlInput] = useState("http://evil.com:8080/shell.sh");
  const [pathResult, setPathResult] = useState<{ allowed: boolean; reason: string } | null>(null);
  const [urlResult, setUrlResult] = useState<{ allowed: boolean; reason: string } | null>(null);
  const [acData, setAcData] = useState<{ deniedFiles: string[]; deniedPaths: string[]; deniedExtensions: string[]; ruleCatalog: Array<{ rule: string; desc: string; status: string; sev: string }>; totalShieldRules: number } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/access-control");
      if (res.ok) setAcData(await res.json());
    } catch {}
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const checkPath = useCallback(async () => {
    try {
      const res = await fetch(`/api/access-control?checkPath=${encodeURIComponent(pathInput)}`);
      if (res.ok) { const data = await res.json(); setPathResult(data.pathCheck); }
    } catch {}
  }, [pathInput]);

  const checkUrl = useCallback(async () => {
    try {
      const res = await fetch(`/api/access-control?checkUrl=${encodeURIComponent(urlInput)}`);
      if (res.ok) { const data = await res.json(); setUrlResult(data.urlCheck); }
    } catch {}
  }, [urlInput]);

  const deniedFiles = acData?.deniedFiles || (demoMode ? [".env",".pem",".key","/etc/passwd","/etc/shadow","id_rsa","credentials.json",".ssh/"] : []);
  const deniedExtensions = acData?.deniedExtensions || (demoMode ? [".pem",".key",".p12",".env",".secret"] : []);
  const ruleCatalog = acData?.ruleCatalog || [];

  if (!acData && !demoMode) return <LoadingSpinner />;

  return (
    // internal reviewer 2026-05-06 chrome cleanup: drop whole-page glassChrome slab.
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16 }}>
      {acData && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <Stat label="Shield Rules" value={acData.totalShieldRules} color={C.brand} small />
          <Stat label="Denied Files" value={acData.deniedFiles.length} color={C.danger} small />
          <Stat label="Denied Paths" value={acData.deniedPaths.length} color={C.orange} small />
          <Stat label="Rule Categories" value={acData.ruleCatalog.length} color={C.purp} small />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card title="Path Guard" accent={C.danger}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <Tooltip placement="top" variant="detail" content={<span>Filesystem path you want the Path Guard to evaluate. The guard blocks anything matching its deny list — sensitive system files, private SSH keys, and paths that try to escape via directory-traversal sequences. Try one of the loaded examples below or paste your own.</span>}>
              <input value={pathInput} onChange={e => setPathInput(e.target.value)} onKeyDown={e => e.key === "Enter" && checkPath()} style={{
                flex: 1, padding: "6px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 6,
                color: C.tx, fontFamily: F.mono, fontSize: 13, outline: "none",
              }} />
            </Tooltip>
            <button onClick={checkPath} style={{ padding: "6px 12px", background: C.danger, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Check</button>
          </div>
          {pathResult && (
            <div style={{ padding: 8, background: pathResult.allowed ? `${C.green}11` : `${C.danger}11`, border: `1px solid ${pathResult.allowed ? C.green : C.danger}33`, borderRadius: 6 }}>
              <Badge label={pathResult.allowed ? "ALLOWED" : "BLOCKED"} color={pathResult.allowed ? C.green : C.danger} />
              <span style={{ fontSize: 13, color: C.txS, marginLeft: 8 }}>{pathResult.reason}</span>
            </div>
          )}
        </Card>

        <Card title="URL Safety" accent={C.warn}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <Tooltip placement="top" variant="detail" content={<span>URL you want to evaluate. URL Safety checks against the deny list (known C2 hosts, suspicious schemes, IP literals on uncommon ports) and the deny-domain list operators have added in Configuration. Catches outbound exfil attempts before they reach the network.</span>}>
              <input value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => e.key === "Enter" && checkUrl()} style={{
                flex: 1, padding: "6px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 6,
                color: C.tx, fontFamily: F.mono, fontSize: 13, outline: "none",
              }} />
            </Tooltip>
            <button onClick={checkUrl} style={{ padding: "6px 12px", background: C.warn, color: C.bg, border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Check</button>
          </div>
          {urlResult && (
            <div style={{ padding: 8, background: urlResult.allowed ? `${C.green}11` : `${C.danger}11`, border: `1px solid ${urlResult.allowed ? C.green : C.danger}33`, borderRadius: 6 }}>
              <Badge label={urlResult.allowed ? "ALLOWED" : "BLOCKED"} color={urlResult.allowed ? C.green : C.danger} />
              <span style={{ fontSize: 13, color: C.txS, marginLeft: 8 }}>{urlResult.reason}</span>
            </div>
          )}
        </Card>

        <Card title="Denied Files / Extensions" accent={C.orange}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {deniedFiles.map(f => <Badge key={f} label={f} color={C.danger} />)}
          </div>
          {deniedExtensions.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: C.txT, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, fontWeight: 600 }}>Extensions</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {deniedExtensions.map(e => <Badge key={e} label={e} color={C.orange} />)}
              </div>
            </>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <button onClick={() => onNavigate("configuration", "policiesAndRules")} style={{ background: "none", border: "none", color: C.info, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0, fontFamily: F.sans }}>View Shield Rules {"\u2192"}</button>
          </div>
        </Card>

        <Card title="Rule Catalog" accent={C.purp}>
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {ruleCatalog.map(r => (
              <div key={r.rule} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
                <Badge label={r.rule} color={C.txS} />
                <span style={{ fontSize: 13, color: C.txS, flex: 1 }}>{r.desc}</span>
                <Badge label={r.sev} color={sevColor(r.sev)} />
                <Dot color={C.green} glow />
              </div>
            ))}
            {ruleCatalog.length === 0 && <EmptyState message="No rules loaded" icon="\uD83D\uDD12" />}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={() => onNavigate("configuration", "policiesAndRules")} style={{ background: "none", border: "none", color: C.info, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0, fontFamily: F.sans }}>Full Rule Details {"\u2192"}</button>
          </div>
        </Card>
      </div>
    </div>
  );
}
