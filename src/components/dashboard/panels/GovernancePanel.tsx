"use client";

import { useState } from "react";
import { C, F } from "../constants";
import { CollapsibleCard } from "../shared";
import { DocReader } from "../DocReader";

// ---------------------------------------------------------------------------
// Governance document catalog
// All entries must be present in the ALLOWED_DOCS whitelist in
// src/app/api/docs/route.ts — otherwise the DocReader fetch will 400.
// ---------------------------------------------------------------------------

interface GovernanceDoc {
  path: string;
  label: string;
  description: string;
}

const OVERVIEW_DOCS: GovernanceDoc[] = [
  { path: "governance-one-pager.md", label: "Governance One-Pager", description: "Leadership-facing summary: security posture, compliance trajectory (SOC 2 ~55-60%, ISO 27001 ~50-55%, NIST Tier 2), and the 90-day roadmap." },
  { path: "governance-index.md", label: "Governance Index", description: "Master entry point to every governance artifact — policies, registers, templates, summaries." },
  { path: "policy-evidence-checklist.md", label: "Policy Evidence Checklist", description: "Every clause across all 14 policies mapped to a concrete artifact or flagged as a gap with a named closure path." },
];

const POLICY_DOCS: GovernanceDoc[] = [
  { path: "policies/README.md", label: "Policy Index", description: "Approval status table covering all 14 policies." },
  { path: "policies/01-information-security-policy.md", label: "01 — Information Security Policy", description: "Overarching security posture: confidentiality, integrity, availability, and security principles." },
  { path: "policies/02-access-control-policy.md", label: "02 — Access Control Policy", description: "Authentication, RBAC roles and permissions, session hardening, and privilege management." },
  { path: "policies/03-incident-response-policy.md", label: "03 — Incident Response Policy", description: "Detection, classification, response, communication, and post-incident learning." },
  { path: "policies/04-change-management-policy.md", label: "04 — Change Management Policy", description: "Review, testing, rollback, and documentation requirements for code and config changes." },
  { path: "policies/05-vendor-third-party-risk-policy.md", label: "05 — Vendor & Third-Party Risk Policy", description: "Evaluation, due diligence, ongoing monitoring, and offboarding of external service providers." },
  { path: "policies/06-risk-management-policy.md", label: "06 — Risk Management Policy", description: "Risk identification, assessment, treatment, and review cadence." },
  { path: "policies/07-secure-sdlc-policy.md", label: "07 — Secure SDLC Policy", description: "Security requirements across design, development, test, and deployment." },
  { path: "policies/08-data-classification-policy.md", label: "08 — Data Classification Policy", description: "Four-tier data taxonomy and handling requirements by tier." },
  { path: "policies/09-data-retention-and-disposal-policy.md", label: "09 — Data Retention and Disposal Policy", description: "Retention windows by data type and disposal procedures." },
  { path: "policies/10-bcp-dr-policy.md", label: "10 — BCP / DR Policy", description: "Business continuity and disaster recovery roles, RTO/RPO targets, test cadence." },
  { path: "policies/11-cryptographic-controls-policy.md", label: "11 — Cryptographic Controls Policy", description: "Approved algorithms, key management, TLS requirements, at-rest encryption guidance." },
  { path: "policies/12-asset-management-policy.md", label: "12 — Asset Management Policy", description: "Software and service asset inventory with ownership." },
  { path: "policies/13-vulnerability-management-policy.md", label: "13 — Vulnerability Management Policy", description: "Scanning, triage, patching, and deferred-finding rationale." },
  { path: "policies/14-acceptable-use-policy.md", label: "14 — Acceptable Use Policy", description: "Contributor expectations, repository rules, and disclosure norms." },
];

const REGISTER_DOCS: GovernanceDoc[] = [
  { path: "registers/risk-register.md", label: "Risk Register", description: "Current risk register summary: P0: 0 active, P1: 10 active, P2: 10 active, P3: 1 closed, Closed: 16." },
  { path: "registers/vendor-inventory-register.md", label: "Vendor Inventory Register", description: "Third-party and supply-chain inventory grouped by dependency category, reconciled against the live codebase." },
];

// ---------------------------------------------------------------------------
// Doc row button
// ---------------------------------------------------------------------------

function DocRow({ doc, onOpen }: { doc: GovernanceDoc; onOpen: (path: string) => void }) {
  return (
    <button
      onClick={() => onOpen(doc.path)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "10px 12px",
        marginBottom: 6,
        background: C.glassSurfTrans,
        border: `1px solid ${C.glassBorderSubtle}`,
        borderRadius: 6,
        cursor: "pointer",
        transition: "all 0.15s ease",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = `${C.brand}66`;
        (e.currentTarget as HTMLButtonElement).style.background = `${C.brand}08`;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = C.glassSurfBorder;
        (e.currentTarget as HTMLButtonElement).style.background = C.bg;
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: C.tx }}>{doc.label}</span>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: C.txT }}>{doc.path}</span>
      </div>
      <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.5 }}>{doc.description}</div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// GovernancePanel
// ---------------------------------------------------------------------------

export function GovernancePanel() {
  const [openDoc, setOpenDoc] = useState<string | null>(null);

  if (openDoc) {
    return <DocReader file={openDoc} onClose={() => setOpenDoc(null)} accent={C.purp} />;
  }

  return (
    // internal reviewer 2026-05-06 chrome cleanup: drop whole-page glassChrome slab.
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Intro */}
      <CollapsibleCard title="About the Governance Lane" accent={C.cyan} defaultOpen={true}>
        <p style={{ fontSize: 13, color: C.txS, lineHeight: 1.7, margin: "0 0 10px" }}>
          Starter enterprise governance pack shipped with ClawNex. 14 approved policies, 2 live registers, 4 operational templates, plus three summary artifacts for leadership and auditors. Every policy is signed off by the Owner &amp; Maintainer pending a named alternate approver (tracked as risk R-019 in the register).
        </p>
        <p style={{ fontSize: 12, color: C.txT, lineHeight: 1.6, margin: 0 }}>
          This is deliberately a concise starter — not a consultant bureaucracy layer. Paths shown on each row are relative to the repository&rsquo;s <span style={{ fontFamily: F.mono, color: C.cyan }}>docs/</span> directory.
        </p>
      </CollapsibleCard>

      {/* Overview (Tier 1) */}
      <CollapsibleCard title="Overview" accent={C.brand} count={OVERVIEW_DOCS.length} defaultOpen={true}>
        <div style={{ fontSize: 11, color: C.txT, marginBottom: 10 }}>
          Start here. These three docs are the fastest path to understanding what governance posture ClawNex actually has today.
        </div>
        {OVERVIEW_DOCS.map(doc => <DocRow key={doc.path} doc={doc} onOpen={setOpenDoc} />)}
      </CollapsibleCard>

      {/* Policies (Tier 2a) */}
      <CollapsibleCard title="Policies" accent={C.info} count={POLICY_DOCS.length} defaultOpen={false}>
        <div style={{ fontSize: 11, color: C.txT, marginBottom: 10 }}>
          Fourteen approved policies plus the index. Each carries a document ID, approval metadata, and a change log.
        </div>
        {POLICY_DOCS.map(doc => <DocRow key={doc.path} doc={doc} onOpen={setOpenDoc} />)}
      </CollapsibleCard>

      {/* Registers (Tier 2b) */}
      <CollapsibleCard title="Registers" accent={C.orange} count={REGISTER_DOCS.length} defaultOpen={false}>
        <div style={{ fontSize: 11, color: C.txT, marginBottom: 10 }}>
          Live, ongoing trackers. The risk register is the authoritative ledger for open issues; the vendor inventory is reconciled against the live codebase every release.
        </div>
        {REGISTER_DOCS.map(doc => <DocRow key={doc.path} doc={doc} onOpen={setOpenDoc} />)}
      </CollapsibleCard>
    </div>
  );
}
