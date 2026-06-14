"use client";

import { useState, useEffect } from "react";
import { C, F } from "./constants";
import { Card } from "./shared";

// ---------------------------------------------------------------------------
// Lightweight markdown → JSX renderer (zero dependencies)
// Shared between HelpPanel (operator docs) and AboutPanel (governance docs).
// ---------------------------------------------------------------------------

export function renderMarkdown(raw: string): React.ReactNode {
  const lines = raw.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  let tableRows: string[][] = [];
  let inTable = false;

  const inlineFormat = (text: string): React.ReactNode => {
    // Bold, code, links — simple regex, covers 90% of our doc patterns
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;
    while (remaining.length > 0) {
      // Code
      const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)/);
      if (codeMatch) {
        if (codeMatch[1]) parts.push(codeMatch[1]);
        parts.push(<code key={key++} style={{ fontFamily: F.mono, fontSize: "0.9em", color: C.cyan, background: `${C.cyan}0c`, padding: "1px 4px", borderRadius: 3 }}>{codeMatch[2]}</code>);
        remaining = codeMatch[3];
        continue;
      }
      // Bold
      const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*(.*)/);
      if (boldMatch) {
        if (boldMatch[1]) parts.push(boldMatch[1]);
        parts.push(<strong key={key++} style={{ color: C.tx }}>{boldMatch[2]}</strong>);
        remaining = boldMatch[3];
        continue;
      }
      parts.push(remaining);
      break;
    }
    return parts.length === 1 ? parts[0] : <>{parts}</>;
  };

  const flushTable = () => {
    if (tableRows.length < 2) { tableRows = []; inTable = false; return; }
    const headers = tableRows[0];
    const body = tableRows.slice(2); // skip separator row
    elements.push(
      <div key={`tbl-${i}`} style={{ overflowX: "auto", marginBottom: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: F.mono }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.brd}` }}>
              {headers.map((h, hi) => <th key={hi} style={{ padding: "6px 8px", textAlign: "left", color: C.txT, fontWeight: 700, fontSize: 11 }}>{inlineFormat(h.trim())}</th>)}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri} style={{ borderBottom: `1px solid ${C.brd}08` }}>
                {row.map((cell, ci) => <td key={ci} style={{ padding: "5px 8px", color: C.txS, fontSize: 12 }}>{inlineFormat(cell.trim())}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableRows = [];
    inTable = false;
  };

  while (i < lines.length) {
    const line = lines[i];

    // Table detection
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      inTable = true;
      tableRows.push(line.trim().slice(1, -1).split("|"));
      i++;
      continue;
    }
    if (inTable) flushTable();

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} style={{ border: "none", borderTop: `1px solid ${C.brd}`, margin: "16px 0" }} />);
      i++;
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const sizes: Record<number, number> = { 1: 18, 2: 16, 3: 14, 4: 13, 5: 12, 6: 11 };
      elements.push(
        <div key={i} style={{ fontSize: sizes[level] || 13, fontWeight: 700, color: C.tx, margin: `${level <= 2 ? 20 : 12}px 0 6px`, borderBottom: level <= 2 ? `1px solid ${C.brd}` : undefined, paddingBottom: level <= 2 ? 6 : undefined }}>
          {inlineFormat(headerMatch[2])}
        </div>
      );
      i++;
      continue;
    }

    // List items
    if (/^\s*[-*]\s/.test(line)) {
      const indent = (line.match(/^\s*/)?.[0].length || 0) / 2;
      elements.push(
        <div key={i} style={{ paddingLeft: 12 + indent * 16, fontSize: 12, color: C.txS, lineHeight: 1.6, marginBottom: 2 }}>
          <span style={{ color: C.brand, marginRight: 6 }}>{"•"}</span>
          {inlineFormat(line.replace(/^\s*[-*]\s/, ""))}
        </div>
      );
      i++;
      continue;
    }

    // Numbered list
    const numMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (numMatch) {
      elements.push(
        <div key={i} style={{ paddingLeft: 12, fontSize: 12, color: C.txS, lineHeight: 1.6, marginBottom: 2 }}>
          <span style={{ color: C.brand, marginRight: 6, fontFamily: F.mono, fontSize: 11 }}>{numMatch[1]}.</span>
          {inlineFormat(numMatch[2])}
        </div>
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: 8 }} />);
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <div key={i} style={{ fontSize: 12, color: C.txS, lineHeight: 1.7, marginBottom: 4 }}>
        {inlineFormat(line)}
      </div>
    );
    i++;
  }
  if (inTable) flushTable();

  return <>{elements}</>;
}

// ---------------------------------------------------------------------------
// DocReader — fetches /api/docs?file=<path> and renders the markdown inline.
// ---------------------------------------------------------------------------

export function DocReader({ file, onClose, accent }: { file: string; onClose: () => void; accent?: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/docs?file=${encodeURIComponent(file)}`);
        if (res.ok) {
          const data = await res.json();
          setContent(data.content);
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error || `HTTP ${res.status}`);
        }
      } catch {
        setError("Failed to load document");
      }
    })();
  }, [file]);

  return (
    <Card title={file} accent={accent ?? C.purp} actions={
      <button onClick={onClose} style={{
        padding: "3px 10px", background: `${C.danger}18`, border: `1px solid ${C.danger}44`,
        borderRadius: 4, color: C.danger, fontSize: 11, fontWeight: 700, fontFamily: F.mono,
        cursor: "pointer",
      }}>Close</button>
    }>
      {error && <div style={{ color: C.danger, fontSize: 12 }}>{error}</div>}
      {content === null && !error && <div style={{ color: C.txT, fontSize: 12 }}>Loading...</div>}
      {content !== null && (
        <div style={{ maxHeight: 600, overflowY: "auto", padding: "4px 0" }}>
          {renderMarkdown(content)}
        </div>
      )}
    </Card>
  );
}
