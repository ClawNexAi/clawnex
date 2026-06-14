"use client";

import { useState, useEffect, useCallback } from "react";
import { C, F } from '../constants';
import { Badge, Card, CollapsibleCard, EmptyState, Fresh, Spark, Stat, Table, TokenRateBadge } from '../shared';
import { Tooltip } from '../tooltip';
import { sevColor, timeAgo } from '../utils';
import type { DashboardFilters, HealthData, TokenData } from '../types';
import { AGENTS_DATA, TOKEN_ALERTS } from '../mock-data';
import { RecentTokenEventsFiltered } from './RecentTokenEventsFiltered';
import { CostByAgentCard } from './CostByAgentCard';
import { CostBySessionCard } from './CostBySessionCard';
import { SignalsCard } from './SignalsCard';
import type { Signal, Source } from '@/lib/types/cost-reporting';
import { MissionControlBreadcrumb } from './mission-control/MissionControlBreadcrumb';

// Per-source visual identity for the per-source totals row. Each source gets a
// distinct accent so operators can scan source attribution at a glance — and
// so the per-source tiles never visually merge into a single combined figure.
// internal reviewer Gate C watchpoint #4 (per-source totals must never be summed) is
// enforced structurally: this is a side-by-side row, not a sum tile.
const SOURCE_COLOR: Record<Source, string> = {
  openclaw: C.cyan,
  hermes: C.brand,
  paperclip: C.purp,
};

const SOURCE_LABEL: Record<Source, string> = {
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  paperclip: 'Paperclip',
};

const SOURCE_ORDER: Source[] = ['openclaw', 'hermes', 'paperclip'];

export function TokenCostPanel({ filters, demoMode, health, incomingFromMissionControl, onMissionControlBackConsumed }: { filters: DashboardFilters; demoMode: boolean; health?: HealthData | null; incomingFromMissionControl?: boolean; onMissionControlBackConsumed?: () => void }) {
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  // Total-fetch-failure tracking. The sourceStatus banner below only fires when
  // the API responds AND reports a source as unavailable; a total failure
  // (network error / 5xx) never updates tokenData, so without this the panel
  // would show last-known-good numbers as if they were current. Honest-unknown
  // discipline: surface the failure + the last successful update time.
  const [fetchError, setFetchError] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  // Hide delivery-mirror filter — when true, all per-row card consumers
  // (Token Usage by Model, Cost By Agent, Cost By Session, Recent Events)
  // drop rows where `model === 'delivery-mirror'`. Default is OFF so an
  // operator who sees delivery-mirror has the tooltip context to recognise
  // it; the toggle exists for operators who want to suppress probe noise.
  // NOTE: This filter is render-time only. Per-source tile totals come from
  // the API's `tokenData.perSource` aggregation and are NOT re-derived
  // client-side here, so they're unaffected by the toggle. v1 scope —
  // delivery-mirror is always $0/0 tokens, so its noise contribution to
  // per-source totals is mathematically zero.
  const [hideDeliveryMirror, setHideDeliveryMirror] = useState<boolean>(false);
  // Active filter for the Signals card → rows table. `null` = no filter.
  // The Signals card renders nothing when there are no signals, so this state
  // is harmless when v1 reporting fields aren't yet populated by the API.
  const [signalFilter, setSignalFilter] = useState<Signal['kind'] | null>(null);
  // Focus token consumed by RecentTokenEventsFiltered's CollapsibleCard via
  // the focusKey/focusedCard mechanism. operator UX directive 2026-05-04: when
  // the operator clicks a row in the SignalsCard the Recent Events card must
  // re-open even if they had manually collapsed it. We append "#<timestamp>"
  // on every signal click so repeat clicks always re-trigger the focus
  // effect (the underlying CollapsibleCard splits on "#" and matches on the
  // base key — same convention used by the Welcome Wizard deep-links).
  const [focusedCard, setFocusedCard] = useState<string | null>(null);

  // Wrap the SignalsCard's onFilter so that activating a signal also pulses
  // the focus token. Deactivating (kind === null) leaves the card alone —
  // operator only asked for auto-expand on activation.
  const handleSignalFilter = useCallback((kind: Signal['kind'] | null) => {
    setSignalFilter(kind);
    if (kind !== null) setFocusedCard(`recentTokenEvents#${Date.now()}`);
  }, []);

  const fetchTokens = useCallback(async () => {
    try {
      const instanceParam = filters.selectedInstance !== "all" ? `&instance=${encodeURIComponent(filters.selectedInstance)}` : "";
      const res = await fetch(`/api/tokens?since=${encodeURIComponent(filters.since)}${instanceParam}`);
      if (res.ok) {
        setTokenData(await res.json());
        setFetchError(false);
        setLastUpdated(Date.now());
      } else {
        setFetchError(true);
      }
    } catch {
      setFetchError(true);
    }
  }, [filters.since, filters.selectedInstance]);

  useEffect(() => {
    fetchTokens();
    const interval = setInterval(fetchTokens, 30000);
    return () => clearInterval(interval);
  }, [fetchTokens]);

  return (
    // internal reviewer 2026-05-06 chrome cleanup: drop whole-page glassChrome slab; child
    // cards carry chrome. Mission Control is the baseline.
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* v0.12.0+: Mission Control return breadcrumb. */}
      <MissionControlBreadcrumb
        visible={!!incomingFromMissionControl}
        onClick={() => onMissionControlBackConsumed?.()}
      />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Tooltip as="div" placement="bottom" variant="detail" content={<span>Sessions currently producing traffic — agents in mid-conversation, not historical totals. Idle sessions drop off after the watcher poll interval.</span>}>
          <Stat label="Active Sessions" value={tokenData?.live?.sessions ?? 0} color={C.cyan} />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="compact" content="Distinct agents producing traffic right now.">
          <Stat label="Active Agents" value={tokenData?.live?.agents ?? 0} color={C.brand} />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="detail" content={<span>Whether the OpenClaw gateway is reachable. <strong>Connected</strong> means live session data is flowing in. <strong>Offline</strong> means the panel falls back to whatever&apos;s already in the local DB — no new sessions appear until the gateway returns.</span>}>
          <Stat label="OpenClaw" value={tokenData?.live?.openclawConnected ? "Connected" : "Offline"} color={tokenData?.live?.openclawConnected ? C.green : C.txT} />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="compact" content="All-time snapshot count in metrics_snapshots — used for the 24h aggregations below.">
          <Stat label="Total Snapshots" value={tokenData?.totalSnapshots ?? 0} color={C.info} />
        </Tooltip>
      </div>

      {/* Total-fetch-failure banner. Fires when /api/tokens is unreachable or
          errors entirely (distinct from the per-source banner below, which
          needs a successful response to populate). Without this, a WAN/backend
          outage would leave stale numbers on screen reading as current. */}
      {fetchError && (
        <div
          role="status"
          style={{
            background: `${C.danger}22`,
            border: `1px solid ${C.danger}55`,
            color: C.danger,
            borderRadius: 8,
            padding: '8px 12px',
            marginBottom: 12,
            fontSize: 12,
            fontFamily: F.sans,
            fontWeight: 600,
          }}
        >
          Live token data unavailable — {lastUpdated
            ? `showing last successful update at ${new Date(lastUpdated).toLocaleTimeString()}`
            : 'no data loaded yet'}.
        </div>
      )}

      {/* v1 FinOps reporting surface — source-status banner.
          Renders only when at least one source reported as 'unavailable'. We
          list each unavailable source by name so the operator knows whose
          number is missing — silent fallback would let an unknown read as a
          green zero. internal reviewer Gate C watchpoint #1 (honest "unknown" not green-zero). */}
      {(() => {
        const unavailableSources = Object.entries(tokenData?.sourceStatus ?? {})
          .filter(([, s]) => s === 'unavailable')
          .map(([src]) => src as Source);
        if (unavailableSources.length === 0) return null;
        const msg = unavailableSources
          .map(s => `${SOURCE_LABEL[s]} data unavailable`)
          .join('; ');
        return (
          <div
            role="status"
            style={{
              background: `${C.warn}22`,
              border: `1px solid ${C.warn}55`,
              color: C.warn,
              borderRadius: 8,
              padding: '8px 12px',
              marginBottom: 12,
              fontSize: 12,
              fontFamily: F.sans,
              fontWeight: 600,
            }}
          >
            {msg}
          </div>
        );
      })()}

      {/* v1 FinOps reporting surface — per-source totals + headline tile.
          Per-source totals appear side-by-side and are NEVER summed (internal reviewer Gate
          C watchpoint #4). The headline tile carries the literal spec-required
          label rendered below; the rejected alternatives flagged by internal reviewer Gate
          C watchpoint #2 must not appear anywhere in this file. The italic
          subtext below the row reinforces the same warning to the operator. */}
      {tokenData?.perSource && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            {SOURCE_ORDER.map(src => {
              const t = tokenData.perSource?.[src];
              const total = t?.totalUsd ?? 0;
              const count = t?.count ?? 0;
              // Source-specific tooltip content — pasted verbatim per operator
              // 2026-05-04 spec. Wrap each per-source tile with a compact
              // tooltip on the label so operators understand the granularity
              // and provenance of each total without needing the spec doc.
              const sourceTip: Record<Source, string> = {
                openclaw: "Cost rolled up from OpenClaw session JSONL files (per-message granularity).",
                hermes: "Cost rolled up from Hermes state.db sessions (per-session granularity).",
                paperclip: "Cost rolled up from Paperclip finance-events HTTP API (per-event granularity).",
              };
              return (
                <Tooltip key={src} as="div" placement="bottom" variant="compact" content={sourceTip[src]}>
                  <Stat
                    label={SOURCE_LABEL[src]}
                    value={`$${total.toFixed(4)}`}
                    sub={`${count} rows`}
                    color={SOURCE_COLOR[src]}
                  />
                </Tooltip>
              );
            })}
            {tokenData.headline && (
              <Tooltip as="div" placement="bottom" variant="detail" content="The largest single-source total. Source totals are NOT summed — same call appearing in multiple sources would double-count, so we show the highest reported figure instead.">
                <Stat
                  label="Highest reported monitored spend"
                  value={`$${tokenData.headline.total.toFixed(4)}`}
                  sub={`from ${SOURCE_LABEL[tokenData.headline.source]}`}
                  color={C.warn}
                />
              </Tooltip>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginTop: -8,
              marginBottom: 12,
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: C.txT,
                fontStyle: 'italic',
              }}
            >
              Source totals shown separately to avoid double-counting. Not invoice-reconciled.
            </div>
            {/* Hide delivery-mirror toggle — operator directive 2026-05-04:
                "keep delivery-mirror visible but add the ability to filter
                it out everywhere." Default OFF so first-time operators see
                the row + its tooltip context. Propagated to Token Usage by
                Model, Cost By Agent, Cost By Session, and Recent Events. */}
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 10,
                color: C.txS,
                fontFamily: F.mono,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={hideDeliveryMirror}
                onChange={e => setHideDeliveryMirror(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              Hide delivery-mirror
            </label>
          </div>
        </>
      )}

      {/* Real API aggregated data — collapsed by default per operator UX directive
          2026-05-04 ("collapse all tables by default"). Wrapped in
          CollapsibleCard rather than Card so the operator can opt into the
          24h metric breakdown when needed. */}
      {tokenData && tokenData.aggregated24h.length > 0 && (
        <CollapsibleCard title="Metric Aggregation (24h)" accent={C.cyan} defaultOpen={false} count={tokenData.aggregated24h.length} actions={<Fresh />}>
          {/* Per-column tooltips on header text — operator-readable explanation
              of the point-in-time semantics. The TOTAL column was dropped per
              internal reviewer Gate C feedback (2026-05-04): summing instantaneous counts
              is a category error and a tooltip warning is not enough on a
              trust-first cost surface. Average/Min/Max/Samples remain — those
              are the meaningful aggregations for point-in-time metrics. */}
          <Table
            headers={[
              <Tooltip key="h-metric" placement="bottom" variant="compact" content="Name of the point-in-time metric being sampled (e.g. agent_count = number of agents running at sample time).">Metric</Tooltip>,
              <Tooltip key="h-avg" placement="bottom" variant="compact" content="Mean value across all snapshots in the window.">Average</Tooltip>,
              <Tooltip key="h-min" placement="bottom" variant="compact" content="Lowest value observed in the window.">Min</Tooltip>,
              <Tooltip key="h-max" placement="bottom" variant="compact" content="Highest value observed in the window.">Max</Tooltip>,
              <Tooltip key="h-samples" placement="bottom" variant="compact" content="Number of times the metric was sampled. Higher = finer-grained measurement.">Samples</Tooltip>,
            ]}
            rows={tokenData.aggregated24h.map(a => [
              <span key="m" style={{ fontSize: 10 }}>{a.metric}</span>,
              a.average,
              <span key="mn" style={{ color: C.txT }}>{a.min}</span>,
              <span key="mx" style={{ color: C.txT }}>{a.max}</span>,
              a.samples,
            ])}
          />
        </CollapsibleCard>
      )}

      {/* Session log token data */}
      {tokenData?.sessionLogs && tokenData.sessionLogs.byModel.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16, marginTop: 16 }}>
            <Tooltip as="div" placement="bottom" variant="detail" content={<span><strong>Session tokens</strong> — total input + output tokens across every session ClawNex has scanned in the current window. These are exact counts from each agent message, not estimates. Drives the Cost calculation to the right.</span>}>
              <Stat label="Session Tokens" value={tokenData.sessionLogs.totals.totalTokens.toLocaleString()} color={C.brand} small />
            </Tooltip>
            <Tooltip as="div" placement="bottom" variant="detail" content={
              <span>
                Computed by ClawNex from token counts × <strong>LiteLLM-pinned rates</strong>, not the cost numbers session files report (those are unreliable on OpenRouter routes). Rate lookup order per model: per-install override → bundled/synced LiteLLM price table → curated fallback for internal/virtual models → zero. Refresh pricing in Configuration → Updates → Model Pricing.
              </span>
            }>
              <Stat label="Total Cost" value={`$${tokenData.sessionLogs.totals.totalCost.toFixed(4)}`} color={C.warn} small />
            </Tooltip>
            <Tooltip as="div" placement="bottom" variant="compact" content="Total messages exchanged (user + agent + tool turns combined) across every scanned session.">
              <Stat label="Messages" value={tokenData.sessionLogs.totals.totalMessages} color={C.cyan} small />
            </Tooltip>
            <Tooltip as="div" placement="bottom" variant="detail" content={<span><strong>Sessions</strong> — distinct conversations parsed from agent session files. One agent can drive many sessions over a window, so this number is usually larger than the active-agent count.</span>}>
              <Stat label="Sessions" value={tokenData.sessionLogs.totals.totalSessions} color={C.purp} small />
            </Tooltip>
            <Tooltip as="div" placement="bottom" variant="detail" content={<span><strong>Models used</strong> — distinct LLM models that appeared in the scanned sessions. A high count usually means agents are routing across providers; a sudden jump can signal a non-default model has been wired in (also flagged in the Cost by Agent card).</span>}>
              <Stat label="Models Used" value={tokenData.sessionLogs.totals.modelsUsed} color={C.info} small />
            </Tooltip>
            <Tooltip as="div" placement="bottom" variant="detail" content={<span><strong>Files scanned</strong> — number of agent session files the Session Watcher consumed to compute these totals. If this stays at zero, the watcher likely isn&apos;t running — check Traffic Monitor.</span>}>
              <Stat label="Files Scanned" value={tokenData.sessionLogs.scannedFiles} color={C.txS} small />
            </Tooltip>
          </div>

          {/* Per-model session-log breakdown — collapsed by default per operator
              UX directive 2026-05-04. The "(Session Logs)" suffix in the title
              is intentionally tooltip-explained: rolls up OpenClaw session
              JSONL only — Hermes / Paperclip traffic is NOT included here.
              Operators have asked us to make that scope explicit since the
              card sits next to the all-source per-source totals above. */}
          <CollapsibleCard
            title={
              <span>
                Token Usage by Model{' '}
                <Tooltip placement="bottom" variant="detail" content="Aggregated from OpenClaw session JSONL only. Hermes-routed and Paperclip-tracked traffic are NOT included here.">
                  <span>(session logs)</span>
                </Tooltip>
              </span>
            }
            accent={C.brand}
            defaultOpen={false}
            count={tokenData.sessionLogs.byModel.length}
            actions={<Badge label="REAL DATA" color={C.green} />}
          >
            <Table
              headers={[
                <Tooltip key="h-model" placement="bottom" variant="compact" content="Provider model identifier.">Model</Tooltip>,
                <Tooltip key="h-msgs" placement="bottom" variant="compact" content="Number of OpenClaw session messages attributed to this model.">Messages</Tooltip>,
                <Tooltip key="h-in" placement="bottom" variant="compact" content="Sum of input tokens across messages for this model.">Input</Tooltip>,
                <Tooltip key="h-out" placement="bottom" variant="compact" content="Sum of output tokens across messages for this model.">Output</Tooltip>,
                <Tooltip key="h-cr" placement="bottom" variant="compact" content="Sum of cache-read tokens (Anthropic-style prompt caching).">Cache Read</Tooltip>,
                <Tooltip key="h-tt" placement="bottom" variant="compact" content="Sum of input + output + cache-read + cache-write across messages.">Total Tokens</Tooltip>,
                <Tooltip key="h-cost" placement="bottom" variant="compact" content="Cost computed via ClawNex's pricing service from token counts × model rate.">Cost</Tooltip>,
              ]}
              rows={tokenData.sessionLogs.byModel
                // Render-time delivery-mirror filter — see hideDeliveryMirror
                // state declaration for invariants. delivery-mirror is
                // OpenClaw's internal echo virtual model; always $0 / 0 tokens.
                .filter(m => !hideDeliveryMirror || m.model !== 'delivery-mirror')
                .map(m => [
                m.model === 'delivery-mirror' ? (
                  <Tooltip key="m" variant="detail" content="OpenClaw's internal echo/test virtual model. Used for tool-test / message-passing probes; never invokes a real LLM. Always reports zero tokens and zero cost.">
                    <span style={{ fontSize: 12, fontFamily: F.mono, fontWeight: 600 }}>{m.model}</span>
                  </Tooltip>
                ) : (
                  <span key="m" style={{ fontSize: 12, fontFamily: F.mono, fontWeight: 600 }}>{m.model}</span>
                ),
                m.messageCount,
                <span key="i" style={{ color: C.txS }}>{m.totalInput.toLocaleString()}</span>,
                <span key="o" style={{ color: C.brand }}>{m.totalOutput.toLocaleString()}</span>,
                <span key="cr" style={{ color: C.txT }}>{m.totalCacheRead.toLocaleString()}</span>,
                <span key="t" style={{ fontWeight: 700, color: C.cyan }}>{m.totalTokens.toLocaleString()}</span>,
                <span key="c" style={{ fontWeight: 700, color: C.warn }}>${m.totalCost.toFixed(4)}</span>,
              ])}
            />
          </CollapsibleCard>

          {/* Signals card — relocated 2026-05-04 per operator UX directive
              ("signal panel is too far away from the tables that are being
              filtered"). Mounted immediately above RecentTokenEventsFiltered
              so the operator sees the click target right next to the table
              that's about to filter. Renders null when no signals have fired
              (handled inside SignalsCard). */}
          <SignalsCard
            signals={tokenData?.signals ?? []}
            activeFilter={signalFilter}
            onFilter={handleSignalFilter}
            rows={tokenData?.rows}
          />

          <RecentTokenEventsFiltered
            entries={tokenData.sessionLogs.recentEntries}
            rows={tokenData?.rows}
            signals={tokenData?.signals}
            signalFilter={signalFilter}
            onClearSignalFilter={() => setSignalFilter(null)}
            focusedCard={focusedCard}
            hideDeliveryMirror={hideDeliveryMirror}
          />
        </>
      )}

      {/* Cost by Agent — who is spending what, on which model. Renders in
          demo mode now too via demoMode-aware data substitution inside the
          card. Operator sees the pentest-agent runaway alongside the rest
          of the per-agent breakdown instead of an empty section. */}
      <CostByAgentCard globalFilters={filters} demoMode={demoMode} hideDeliveryMirror={hideDeliveryMirror} />

      {/* Cost by Session — sister surface to Cost by Agent, pivoted on
          sessionId. Same /api/tokens fetch, different rollup axis. The
          unknown bucket here is the operator-visible signal for traffic
          that bypassed OpenClaw routing (direct-to-Anthropic /
          direct-to-OpenRouter). Tooltip explains it inline so the label
          isn't misread as a bug. */}
      <CostBySessionCard globalFilters={filters} demoMode={demoMode} hideDeliveryMirror={hideDeliveryMirror} />

      {!demoMode && tokenData && tokenData.aggregated24h.length === 0 && tokenData.recentSnapshots.length === 0 && !tokenData.sessionLogs?.byModel.length && !tokenData.costByAgent?.length && (
        <EmptyState message="No token data yet. Metrics are recorded when OpenClaw is connected." />
      )}

      {/* Demo data */}
      {demoMode && (
        <>
          <Card title="Demo: Denial-of-Wallet Detection" accent={C.danger} glow={C.danger}>
            {TOKEN_ALERTS.map(alert => (
              <div key={alert.id} style={{
                position: "relative",
                background: C.glassSurfTrans, border: `1px solid ${sevColor(alert.severity)}33`, borderLeft: `4px solid ${sevColor(alert.severity)}`,
                borderRadius: 12, padding: 12, marginBottom: 10,
                boxShadow: C.glassCardShadow,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <TokenRateBadge rate={alert.badge} />
                  <span style={{ fontWeight: 700, fontSize: 12 }}>{alert.agent}</span>
                  <span style={{ fontSize: 14, color: C.txT }}>{alert.id}</span>
                </div>
                <div style={{ fontSize: 13, color: C.txS, marginBottom: 6 }}>{alert.desc}</div>
                <div style={{ display: "flex", gap: 12, fontSize: 14, fontFamily: F.mono, color: C.txS }}>
                  <span>{alert.tokens}</span>
                  <span style={{ color: C.warn }}>{alert.rate}</span>
                  <span style={{ color: C.danger }}>{alert.cost}</span>
                </div>
              </div>
            ))}
          </Card>

          <Card title="Demo: Agent Token Consumption" accent={C.info}>
            <Table
              headers={["Agent", "Model", "Tokens", "Rate", "Cost", "Trend", "Status"]}
              rows={AGENTS_DATA.map(a => [
                a.name,
                <span key="m" style={{ fontSize: 14, color: C.txS }}>{a.model}</span>,
                <span key="t">{(a.tokensUsed / 1000).toFixed(0)}K</span>,
                <span key="r" style={{ fontSize: 10 }}>{a.tokensUsed > 800000 ? "HIGH" : "NORMAL"}</span>,
                <span key="c" style={{ color: C.warn }}>${(a.tokensUsed * 0.00005).toFixed(2)}</span>,
                <Spark key="sp" data={[30, 45, 38, 52, 48, 55, 42, 58, 50, 46]} color={a.tokensUsed > 800000 ? C.danger : C.brand} w={60} h={16} />,
                <TokenRateBadge key="st" rate={a.tokensUsed > 800000 ? "ELEVATED" : "NORMAL"} />,
              ])}
            />
          </Card>
        </>
      )}
    </div>
  );
}
