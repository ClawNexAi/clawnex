"use client";

/**
 * Policies & Rules — Configuration card for the v1 framework.
 * Read-only first; authoring affordances added in Stage 6.
 *
 * Spec §3.8.
 */

import { useState, useEffect, useCallback } from 'react';
import { C, F } from '../constants';
import { CollapsibleCard, PaginationFooter } from '../shared';
import type { Policy, PolicyRule } from '@/lib/shield/types';
import { PolicyEditModal, type PolicyEditMode } from './PolicyEditModal';
import { RuleEditModal, type RuleEditMode } from './RuleEditModal';
import { PolicyDisableConfirm } from './PolicyDisableConfirm';

interface PolicyWithCount extends Policy {
  rule_count: number;
}

const SOURCE_BADGE: Record<string, { label: string; color: string }> = {
  curated: { label: 'CURATED', color: '#3b82f6' },
  system:  { label: 'SYSTEM',  color: '#a855f7' },
  custom:  { label: 'CUSTOM',  color: '#9ca3af' },
};

const LIFECYCLE_BADGE: Record<string, { label: string; color: string }> = {
  draft:   { label: 'DRAFT',   color: '#6b7280' },
  lab:     { label: 'LAB',     color: '#f59e0b' },
  starter: { label: 'STARTER', color: '#22c55e' },
  strict:  { label: 'STRICT',  color: '#fb923c' },
  custom:  { label: 'CUSTOM',  color: '#9ca3af' },
};

export function PoliciesAndRulesCard({ focusedCard }: { focusedCard?: string | null }) {
  const [policies, setPolicies] = useState<PolicyWithCount[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rulesById, setRulesById] = useState<Record<string, PolicyRule[]>>({});
  // Stage 6 authoring — null when closed; create or edit (with policy) when open.
  const [editMode, setEditMode] = useState<PolicyEditMode | null>(null);
  // Stage 6 — rule-level authoring modal. Null when closed; create (with
  // parent policy) or edit (with parent policy + rule) when open.
  const [ruleEditMode, setRuleEditMode] = useState<RuleEditMode | null>(null);
  // Stage 7 (Task 21) — typed-phrase confirm for disabling vendor policies.
  // Null when closed; carries policy id + name when open. Custom policies
  // and re-enable transitions never open this modal — see toggleEnabled.
  const [disableConfirm, setDisableConfirm] = useState<{ id: string; name: string } | null>(null);
  // v0.11.5+: rule-of-5 pagination — policies list (default 5) + per-policy
  // rules pagination (default 10 since rule sets can be 100+ items deep).
  const [policyPageSize, setPolicyPageSize] = useState(5);
  const [policyPage, setPolicyPage] = useState(0);
  const [rulesPageByPolicy, setRulesPageByPolicy] = useState<Record<string, number>>({});
  const [rulesPageSizeByPolicy, setRulesPageSizeByPolicy] = useState<Record<string, number>>({});

  // Initial load — fetch all policies (with rule_count) once on mount.
  // Mirrors the same await-then-setState shape that `expand` uses for
  // per-policy rules; the plan's draft `load()` deliberately collapsed
  // the await for brevity, so we re-expand it here. Per-policy rules are
  // fetched lazily on first expand to keep the initial card payload small.
  //
  // Extracted to a useCallback so the Stage 6 modal can re-trigger it on
  // successful save (refresh new/renamed policies without a manual reload).
  const refetchPolicies = useCallback(async () => {
    const r = await fetch('/api/policies');
    if (r.ok) {
      const data = await r.json();
      setPolicies(data.policies);
    }
  }, []);

  useEffect(() => {
    void refetchPolicies();
  }, [refetchPolicies]);

  // Extracted from `expand` so the Stage 6 RuleEditModal can re-trigger a
  // refresh after a successful save (creating or editing a rule should make
  // the new/updated row appear without a manual collapse-and-re-expand).
  const refetchRules = useCallback(async (id: string) => {
    const r = await fetch(`/api/policies/${id}/rules`);
    if (r.ok) {
      const data = await r.json();
      setRulesById(s => ({ ...s, [id]: data.rules }));
    }
  }, []);

  const expand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!rulesById[id]) {
      await refetchRules(id);
    }
  };

  // Stage 7 (Task 21) — interactive enabled toggle.
  //
  // Three branches by source + intended transition:
  //   1. custom policies — PATCH `{ enabled: !current }` directly. The API
  //      doesn't require any guard for custom mutations.
  //   2. vendor (curated/system) re-enable — PATCH `{ enabled: true }`
  //      directly. Re-enabling restores protection, so friction-free is
  //      the right default per spec §3.3.
  //   3. vendor disable — open the typed-phrase confirm modal. The modal
  //      handles the probe + PATCH; on success it triggers refetch via
  //      the onSuccess callback.
  //
  // Errors on the direct paths are surfaced via console for now — the
  // toggle itself stays in the prior state if the API rejects, since we
  // only refetch on success. (A toast/inline error treatment would be a
  // Task 22+ enhancement and is out of scope here.)
  const toggleEnabled = useCallback(async (p: PolicyWithCount) => {
    const isVendor = p.source === 'curated' || p.source === 'system';
    if (isVendor && p.enabled) {
      // Disable transition — gate behind typed-phrase modal.
      setDisableConfirm({ id: p.id, name: p.name });
      return;
    }
    // Custom (any direction) + vendor re-enable — direct PATCH.
    try {
      const res = await fetch(`/api/policies/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !p.enabled }),
      });
      if (res.ok) {
        await refetchPolicies();
      } else {
        // Soft-fail: log the API error so a developer can see it in the
        // console; the row stays at its prior enabled state because we
        // only refetch on success.
        console.warn('[PoliciesAndRulesCard] toggle failed', res.status, await res.text().catch(() => ''));
      }
    } catch (err) {
      console.warn('[PoliciesAndRulesCard] toggle error', err);
    }
  }, [refetchPolicies]);

  return (
    <CollapsibleCard
      title="POLICIES & RULES"
      accent={C.cyan}
      defaultOpen={false}
      focusKey="policiesAndRules"
      focusedCard={focusedCard}
      count={policies.length}
    >
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 12, marginBottom: 12,
      }}>
        <div style={{ fontSize: 13, color: C.txS, flex: 1 }}>
          Starter DLP-style content matching. Curated packs ship verified; author your own custom policies and rules to extend.
        </div>
        <button
          type="button"
          onClick={() => setEditMode({ kind: 'create' })}
          style={{
            padding: '6px 12px', borderRadius: 4, fontSize: 12, fontWeight: 700,
            fontFamily: F.mono, letterSpacing: '0.04em',
            background: `${C.cyan}18`, border: `1px solid ${C.cyan}44`,
            color: C.cyan, cursor: 'pointer', flexShrink: 0,
          }}
        >
          + Add Policy
        </button>
      </div>

      {(() => {
        const policiesTotalPages = Math.max(1, Math.ceil(policies.length / policyPageSize));
        const safePolicyPage = Math.min(policyPage, policiesTotalPages - 1);
        const pagedPolicies = policies.slice(safePolicyPage * policyPageSize, (safePolicyPage + 1) * policyPageSize);
        return (<>
          {pagedPolicies.map(p => {
        const sb = SOURCE_BADGE[p.source];
        const lb = LIFECYCLE_BADGE[p.lifecycle];
        const isExpanded = expandedId === p.id;
        return (
          <div key={p.id} style={{
            border: `1px solid ${C.glassBorderCyan}`,
            borderRadius: 6,
            marginBottom: 8,
            background: p.enabled ? C.glassSurfTrans : "rgba(255,255,255,0.01)",
          }}>
            <div
              onClick={() => expand(p.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                cursor: 'pointer',
              }}
            >
              {/* Interactive enabled toggle — Task 21. The ✓/☐ glyph is now
                  a button that flips the policy's enabled state. Vendor
                  disable opens the typed-phrase modal; vendor re-enable +
                  custom (both directions) PATCH directly. stopPropagation
                  keeps the row's expand handler from firing on click. */}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); void toggleEnabled(p); }}
                title={p.enabled ? 'Click to disable' : 'Click to enable'}
                aria-label={`${p.enabled ? 'Disable' : 'Enable'} policy ${p.name}`}
                aria-pressed={p.enabled}
                style={{
                  background: 'transparent', border: 'none', padding: 0, margin: 0,
                  cursor: 'pointer',
                  fontSize: 12, fontWeight: 700,
                  color: p.enabled ? C.green : C.txT,
                  fontFamily: 'inherit',
                  lineHeight: 1,
                }}
              >
                {p.enabled ? '✓' : '☐'}
              </button>
              <span style={{ fontSize: 12, fontWeight: 700, color: p.enabled ? C.tx : C.txT, flex: 1 }}>
                {p.name}
              </span>
              <span style={{
                fontSize: 9, fontWeight: 700, fontFamily: F.mono, letterSpacing: '0.06em',
                padding: '1px 6px', borderRadius: 3,
                background: `${sb.color}14`, border: `1px solid ${sb.color}40`, color: sb.color,
              }}>{sb.label}</span>
              <span style={{
                fontSize: 9, fontWeight: 700, fontFamily: F.mono, letterSpacing: '0.06em',
                padding: '1px 6px', borderRadius: 3,
                background: `${lb.color}14`, border: `1px solid ${lb.color}40`, color: lb.color,
              }}>{lb.label}</span>
              {p.version && (
                <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono }}>v{p.version}</span>
              )}
              <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>{p.rule_count} rules</span>
              {/* Edit affordance — clickable for custom; disabled-with-tooltip
                  for vendor (curated/system). Vendor disable/delete belongs to
                  Task 21 (typed-phrase confirm). stopPropagation prevents the
                  row's expand toggle from firing when the operator clicks Edit. */}
              {p.source === 'custom' ? (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setEditMode({ kind: 'edit', policy: p }); }}
                  style={{
                    padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 700,
                    fontFamily: F.mono, letterSpacing: '0.04em',
                    background: `${C.cyan}14`, border: `1px solid ${C.cyan}40`,
                    color: C.cyan, cursor: 'pointer',
                  }}
                >
                  EDIT
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  title="Vendor policy — edit disabled in v1"
                  onClick={e => e.stopPropagation()}
                  style={{
                    padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 700,
                    fontFamily: F.mono, letterSpacing: '0.04em',
                    background: 'transparent', border: `1px solid ${C.glassBorderCyan}`,
                    color: C.txT, cursor: 'not-allowed', opacity: 0.6,
                  }}
                >
                  EDIT
                </button>
              )}
              <span style={{ color: C.txT }}>{isExpanded ? '▾' : '▸'}</span>
            </div>

            {isExpanded && rulesById[p.id] && (() => {
              const rules = rulesById[p.id];
              const pageSize = rulesPageSizeByPolicy[p.id] ?? 10;
              const page = rulesPageByPolicy[p.id] ?? 0;
              const totalPages = Math.max(1, Math.ceil(rules.length / pageSize));
              const safe = Math.min(page, totalPages - 1);
              const pagedRules = rules.slice(safe * pageSize, (safe + 1) * pageSize);
              return (
              <div style={{ borderTop: `1px solid ${C.glassBorderSubtle}`, padding: '8px 12px' }}>
                {pagedRules.map(r => (
                  <div key={r.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                    fontSize: 11, color: r.enabled ? C.txS : C.txT,
                    fontFamily: F.mono,
                  }}>
                    <span style={{ minWidth: 200 }}>{r.rule_key}</span>
                    <span style={{ flex: 1, opacity: 0.7 }}>{r.pattern.slice(0, 60)}{r.pattern.length > 60 ? '…' : ''}</span>
                    <span style={{
                      padding: '0 4px', borderRadius: 2, fontSize: 9,
                      background: r.severity === 'CRITICAL' ? `${C.danger}30` : r.severity === 'HIGH' ? `${C.warn}30` : `${C.txT}20`,
                      color: r.severity === 'CRITICAL' ? C.danger : r.severity === 'HIGH' ? C.warn : C.txS,
                    }}>{r.severity}</span>
                    <span style={{
                      padding: '0 4px', borderRadius: 2, fontSize: 9,
                      background: `${C.cyan}20`, color: C.cyan,
                    }}>{r.action.toUpperCase()}</span>
                    {r.lifecycle && r.lifecycle !== p.lifecycle && (
                      <span style={{
                        padding: '0 4px', borderRadius: 2, fontSize: 9,
                        background: `${LIFECYCLE_BADGE[r.lifecycle].color}20`,
                        color: LIFECYCLE_BADGE[r.lifecycle].color,
                      }}>{LIFECYCLE_BADGE[r.lifecycle].label}</span>
                    )}
                    {!r.enabled && <span style={{ color: C.txT, fontSize: 10 }}>(disabled)</span>}
                    {/* Per-row [EDIT] — clickable for rules in custom policies,
                        disabled-with-tooltip for vendor (curated/system) policies.
                        Mirrors the policy-row [EDIT] pattern from Task 18. */}
                    {p.source === 'custom' ? (
                      <button
                        type="button"
                        onClick={() => setRuleEditMode({ kind: 'edit', policy: p, rule: r })}
                        style={{
                          padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                          fontFamily: F.mono, letterSpacing: '0.04em',
                          background: `${C.cyan}14`, border: `1px solid ${C.cyan}40`,
                          color: C.cyan, cursor: 'pointer',
                        }}
                      >
                        EDIT
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        title="Vendor rule — edit disabled in v1"
                        style={{
                          padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                          fontFamily: F.mono, letterSpacing: '0.04em',
                          background: 'transparent', border: `1px solid ${C.glassBorderCyan}`,
                          color: C.txT, cursor: 'not-allowed', opacity: 0.6,
                        }}
                      >
                        EDIT
                      </button>
                    )}
                  </div>
                ))}
                {/* [+ Add Rule] only for custom policies — vendor policies
                    cannot accept new rules (the API would 403). */}
                {p.source === 'custom' && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${C.glassBorderSubtle}` }}>
                    <button
                      type="button"
                      onClick={() => setRuleEditMode({ kind: 'create', policy: p })}
                      style={{
                        padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                        fontFamily: F.mono, letterSpacing: '0.04em',
                        background: `${C.cyan}14`, border: `1px solid ${C.cyan}40`,
                        color: C.cyan, cursor: 'pointer',
                      }}
                    >
                      + Add Rule
                    </button>
                  </div>
                )}
                {totalPages > 1 && (
                  <PaginationFooter
                    currentPage={safe}
                    totalPages={totalPages}
                    pageSize={pageSize}
                    totalRows={rules.length}
                    onPageSizeChange={(n) => {
                      setRulesPageSizeByPolicy(prev => ({ ...prev, [p.id]: n }));
                      setRulesPageByPolicy(prev => ({ ...prev, [p.id]: 0 }));
                    }}
                    onPageChange={(page) => setRulesPageByPolicy(prev => ({ ...prev, [p.id]: page }))}
                  />
                )}
              </div>
              );
            })()}
          </div>
        );
      })}
          {policiesTotalPages > 1 && (
            <PaginationFooter
              currentPage={safePolicyPage}
              totalPages={policiesTotalPages}
              pageSize={policyPageSize}
              totalRows={policies.length}
              onPageSizeChange={(n) => { setPolicyPageSize(n); setPolicyPage(0); }}
              onPageChange={setPolicyPage}
            />
          )}
        </>);
      })()}

      {editMode && (
        <PolicyEditModal
          mode={editMode}
          onClose={() => setEditMode(null)}
          onSaved={() => { void refetchPolicies(); }}
        />
      )}

      {ruleEditMode && (
        <RuleEditModal
          mode={ruleEditMode}
          onClose={() => setRuleEditMode(null)}
          onSaved={() => {
            // Refetch BOTH the policy list (so the parent row's rule_count
            // badge updates immediately after a create/edit) AND the per-policy
            // rules cache (so the expanded view shows the new/edited rule).
            // Order doesn't matter — both are async fetches.
            void refetchPolicies();
            void refetchRules(ruleEditMode.policy.id);
          }}
        />
      )}

      {disableConfirm && (
        <PolicyDisableConfirm
          policyId={disableConfirm.id}
          policyName={disableConfirm.name}
          onClose={() => setDisableConfirm(null)}
          onSuccess={() => { void refetchPolicies(); }}
        />
      )}
    </CollapsibleCard>
  );
}
