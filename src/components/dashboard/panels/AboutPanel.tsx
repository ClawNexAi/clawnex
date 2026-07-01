"use client";

import { useState, useEffect } from "react";
import { C, F } from "../constants";
import { Card, CollapsibleCard, Badge } from "../shared";

// ---------------------------------------------------------------------------
// Upstream attribution — projects whose licenses require acknowledgment
// ---------------------------------------------------------------------------

const ATTRIBUTION: Array<{
  name: string;
  url: string;
  license: string;
  role: string;
}> = [
  { name: "Next.js", url: "https://nextjs.org", license: "MIT", role: "Dashboard framework (App Router, SSR, API routes)" },
  { name: "React", url: "https://react.dev", license: "MIT", role: "UI rendering engine" },
  { name: "LiteLLM", url: "https://github.com/BerriAI/litellm", license: "MIT", role: "LLM proxy engine + model pricing data. All AI traffic routes through the LiteLLM proxy; token cost calculations use the model_prices_and_context_window.json from their GitHub repo at the pinned version tag" },
  { name: "better-sqlite3", url: "https://github.com/WiseLibs/better-sqlite3", license: "MIT", role: "SQLite database driver (synchronous, WAL mode)" },
  { name: "Tailwind CSS", url: "https://tailwindcss.com", license: "MIT", role: "Utility CSS framework" },
  { name: "OpenClaw", url: "https://github.com/openclaw", license: "MIT", role: "AI agent fleet manager — the gateway ClawNex monitors, secures, and routes traffic through" },
  { name: "Hermes Agent", url: "https://github.com/nousresearch/hermes-agent", license: "MIT", role: "Nous Research's self-improving AI agent — integration target" },
  { name: "TypeScript", url: "https://www.typescriptlang.org", license: "Apache 2.0", role: "Language and type system" },
  { name: "Node.js", url: "https://nodejs.org", license: "MIT", role: "Server runtime" },
  { name: "Python", url: "https://python.org", license: "PSF", role: "LiteLLM callback logger runtime" },
  { name: "SQLite", url: "https://sqlite.org", license: "Public Domain", role: "Embedded database engine" },
];

// ---------------------------------------------------------------------------
// Threat intel sources
// ---------------------------------------------------------------------------

const THREAT_INTEL: Array<{ name: string; handle: string; url: string; contribution: string }> = [
  { name: "Elder Pliny", handle: "elder-plinius", url: "https://github.com/elder-plinius", contribution: "L1B3RT4S, ST3GG, G0DM0D3, P4RS3LT0NGV3 — jailbreak, steganography, GODMODE, and encoding obfuscation repos that informed 16 shield detection rules" },
  { name: "MITRE", handle: "mitre", url: "https://cve.mitre.org", contribution: "CVE database and CWE classification system — powers the CVE correlation engine that maps known vulnerabilities to shield rule categories (108 CVEs tracked)" },
];

// ---------------------------------------------------------------------------
// Link icon badges — small, tasteful, icon-only
// ---------------------------------------------------------------------------

const LINK_ICONS: Record<string, { label: string; color: string }> = {
  yt: { label: "YT", color: "#ff0000" },
  x: { label: "X", color: "#8899a6" },
  web: { label: "WEB", color: C.cyan },
  li: { label: "IN", color: "#0a66c2" },
  gh: { label: "GH", color: C.txS },
};

function LinkBadges({ links }: { links: Record<string, string> }) {
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
      {Object.entries(links).map(([type, url]) => {
        const icon = LINK_ICONS[type];
        if (!icon) return null;
        return (
          <a
            key={type}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, fontFamily: F.mono,
              background: `${icon.color}18`, border: `1px solid ${icon.color}33`, color: icon.color,
              textDecoration: "none", letterSpacing: "0.05em",
              transition: "background 0.15s, border-color 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = `${icon.color}30`; (e.currentTarget as HTMLAnchorElement).style.borderColor = `${icon.color}66`; }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = `${icon.color}18`; (e.currentTarget as HTMLAnchorElement).style.borderColor = `${icon.color}33`; }}
          >
            {icon.label}
          </a>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Acknowledgment Section — renders a tier (Educators / Builders / Inner Circle)
// ---------------------------------------------------------------------------

interface AckPerson {
  name: string;
  desc: string;
  links: Record<string, string>;
}

function AckSection({ title, subtitle, people }: { title: string; subtitle: string; people: AckPerson[] }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, fontFamily: F.mono, color: C.warn, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {title}
        </div>
        <div style={{ fontSize: 11, color: C.txT, marginTop: 2 }}>{subtitle}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
        {people.map(person => (
          <div key={person.name} style={{
            padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`,
            borderRadius: 6, borderLeft: `3px solid ${C.warn}44`,
          }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.tx, marginBottom: 3 }}>
              {person.name}
            </div>
            <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.5 }}>
              {person.desc}
            </div>
            <LinkBadges links={person.links} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AboutPanel
// ---------------------------------------------------------------------------

export function AboutPanel() {
  const [version, setVersion] = useState<string>("...");
  const [uptime, setUptime] = useState<number>(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/health");
        if (res.ok) {
          const data = await res.json();
          setVersion(data.version || "unknown");
          setUptime(data.uptime || 0);
        }
      } catch { /* silent */ }
    })();
  }, []);

  const formatUptime = (s: number) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  };

  return (
    // internal reviewer 2026-05-06 chrome cleanup: drop whole-page glassChrome slab.
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Version + Identity */}
      <CollapsibleCard title="ClawNex" accent={C.brand} defaultOpen={false}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: F.disp, background: `linear-gradient(90deg, ${C.brand}, ${C.cyan})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              ClawNex
            </div>
            <div style={{ fontSize: 12, color: C.txT, marginTop: 2 }}>One nexus. Total control.</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ padding: "8px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.txT, fontFamily: F.mono, letterSpacing: "0.05em" }}>VERSION</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.brand, fontFamily: F.mono }}>{version}</div>
          </div>
          <div style={{ padding: "8px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.txT, fontFamily: F.mono, letterSpacing: "0.05em" }}>UPTIME</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.green, fontFamily: F.mono }}>{formatUptime(uptime)}</div>
          </div>
          <div style={{ padding: "8px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.txT, fontFamily: F.mono, letterSpacing: "0.05em" }}>LICENSE</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.cyan, fontFamily: F.mono }}>Apache 2.0</div>
          </div>
          <div style={{ padding: "8px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.txT, fontFamily: F.mono, letterSpacing: "0.05em" }}>CONTRIBUTIONS</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.purp, fontFamily: F.mono }}>DCO Sign-off</div>
          </div>
        </div>
        <p style={{ fontSize: 12, color: C.txT, marginTop: 12, lineHeight: 1.6, margin: "12px 0 0" }}>
          AI Agent Fleet Security Operations Center. Built by ClawNex maintainers.
          ClawNex monitors, scans, and secures AI agent fleets in real time through a 163-detection built-in shield engine (plus the starter Shield/DLP policy framework for operator-authored rules),
          multi-signal correlation, and comprehensive audit trail.
        </p>
      </CollapsibleCard>

      {/* Upstream Attribution */}
      <CollapsibleCard title="Upstream Attribution" accent={C.info} defaultOpen={false} count={ATTRIBUTION.length}>
        <p style={{ fontSize: 12, color: C.txT, marginBottom: 12, margin: "0 0 12px", lineHeight: 1.6 }}>
          ClawNex builds on the work of these open-source projects. Their licenses require attribution — and they deserve it regardless.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
          {ATTRIBUTION.map(dep => (
            <div key={dep.name} style={{ padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: C.tx }}>{dep.name}</span>
                <Badge label={dep.license} color={C.cyan} />
              </div>
              <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.5 }}>{dep.role}</div>
            </div>
          ))}
        </div>
      </CollapsibleCard>

      {/* Threat Intelligence Sources */}
      <CollapsibleCard title="Threat Intelligence Sources" accent={C.danger} count={THREAT_INTEL.length} defaultOpen={false}>
        <p style={{ fontSize: 12, color: C.txT, marginBottom: 12, margin: "0 0 12px", lineHeight: 1.6 }}>
          Shield rules are informed by real-world threat intelligence. The following researchers and repositories have directly shaped ClawNex&apos;s detection capabilities.
        </p>
        {THREAT_INTEL.map(source => (
          <div key={source.handle} style={{ padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.danger}22`, borderLeft: `3px solid ${C.danger}`, borderRadius: 6, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.tx, marginBottom: 4 }}>
              {source.name} <span style={{ fontFamily: F.mono, fontSize: 11, color: C.txT }}>@{source.handle}</span>
            </div>
            <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.5 }}>{source.contribution}</div>
          </div>
        ))}
      </CollapsibleCard>

      {/* Acknowledgments */}
      <CollapsibleCard title="Acknowledgments" accent={C.warn} defaultOpen={false} count={28}>
        <p style={{ fontSize: 13, color: C.txS, lineHeight: 1.7, margin: "0 0 16px" }}>
          ClawNex didn&apos;t emerge in isolation. It was shaped by educators who made AI accessible, builders who shared their struggles openly, and people who bet on the vision before there was anything to show. This section exists because credit matters &mdash; and because the best ideas come from standing on the shoulders of people who give generously.
        </p>

        <AckSection title="Educators & Researchers" subtitle="The people whose teaching built the foundation" people={[
          { name: "Andrej Karpathy", desc: "Made neural networks intuitive for an entire generation of builders", links: { x: "https://x.com/karpathy", yt: "https://www.youtube.com/andrejkarpathy" } },
          { name: "Cole Medin", desc: "PRDs, the BMAD method, proper Claude prompting, and long-horizon tasking — taught the discipline behind building with AI", links: { yt: "https://www.youtube.com/@ColeMedin", x: "https://x.com/cole_medin", web: "https://dynamous.ai/" } },
          { name: "Nate B Jones", desc: "Helped see the bigger picture — where AI is, where it's going, and how to position yourself for what's coming", links: { yt: "https://www.youtube.com/@NateBJones", web: "https://www.natebjones.com/" } },
          { name: "Manifold AI Learning", desc: "Structured AI/ML curriculum that bridges theory and practice", links: { yt: "https://www.youtube.com/@ManifoldAILearning", web: "https://manifoldailearning.com/" } },
          { name: "Tina Huang", desc: "Data science and AI career pathways — made the field feel reachable", links: { yt: "https://www.youtube.com/@TinaHuang1" } },
          { name: "Daniel Messier", desc: "Unsupervised Learning — deep technical analysis without the hype", links: { yt: "https://www.youtube.com/@unsupervised-learning" } },
          { name: "Network Chuck", desc: "Networking, DevOps, and security fundamentals with infectious energy", links: { yt: "https://www.youtube.com/@NetworkChuck", x: "https://x.com/networkchuck" } },
          { name: "Alex Ziskind", desc: "Developer education — clean, practical, no-nonsense", links: { yt: "https://www.youtube.com/@AZisk" } },
        ]} />

        <AckSection title="Builders & Voices" subtitle="The AI agent community whose work and shared struggles directly informed ClawNex" people={[
          { name: "Nate Herk", desc: "AI automation at scale — real workflows, real friction, real solutions", links: { yt: "https://www.youtube.com/@nateherk", web: "https://www.skool.com/ai-automation-society/about" } },
          { name: "Matt Wolfe", desc: "AI tools landscape — if it exists, Matt's already reviewed it", links: { yt: "https://www.youtube.com/@mreflow", x: "https://x.com/mreflow", web: "https://mattwolfe.com/" } },
          { name: "Matthew Berman", desc: "Model reviews and AI news with honest, grounded takes", links: { yt: "https://www.youtube.com/@matthew_berman", x: "https://x.com/matthewberman" } },
          { name: "Alex Finn", desc: "AI content that cuts through the noise", links: { yt: "https://www.youtube.com/@AlexFinnOfficial", x: "https://twitter.com/AlexFinn" } },
          { name: "Julian Goldie", desc: "AI-powered SEO at scale — proved what agents can do in production", links: { yt: "https://www.youtube.com/@JulianGoldieSEO" } },
          { name: "Zan Van Riel", desc: "AI agent building with a focus on what actually ships", links: { yt: "https://www.youtube.com/@zenvanriel" } },
          { name: "Corbin Brown", desc: "AI workflows and tooling — the builder's perspective", links: { yt: "https://www.youtube.com/@Corbin_Brown" } },
          { name: "Ras Mic", desc: "AI exploration with genuine curiosity", links: { yt: "https://www.youtube.com/@rasmic" } },
          { name: "Jay E", desc: "RoboNuggets — AI automation and agent workflows", links: { yt: "https://www.youtube.com/@RoboNuggets" } },
          { name: "Nick Saraev", desc: "AI automation systems — efficiency-obsessed, production-minded", links: { yt: "https://www.youtube.com/@nicksaraev" } },
          { name: "Jack Roberts", desc: "AI agent building and experimentation", links: { yt: "https://www.youtube.com/@Itssssss_Jack" } },
          { name: "Jonathan Mast", desc: "AI with code — bridging development and AI tooling", links: { yt: "https://www.youtube.com/@jonathanmast_withai", x: "https://x.com/jonathanmast" } },
          { name: "Word of AI", desc: "AI industry pulse — staying current when the field moves daily", links: { yt: "https://www.youtube.com/@intheworldofai" } },
          { name: "This Week in Startups", desc: "Startup ecosystem context — the business side of building in AI", links: { yt: "https://www.youtube.com/@startups" } },
        ]} />

        <AckSection title="Contributors" subtitle="Without being directly involved, they provided the information and inspiration that stood up OpenClaw and shaped ClawNex into what it is" people={[
          { name: "Elder Pliny", desc: "Jailbreak research across four repos that directly shaped 16 shield detection rules — the threat intelligence backbone of ClawNex", links: { gh: "https://github.com/elder-plinius" } },
          { name: "Jeff Hunter", desc: "Delegation, systems thinking, and the discipline to build a real business — the operational blueprint behind the product", links: { yt: "https://www.youtube.com/@JeffJHunter/videos", web: "https://jeffjhunter.com/about-me/" } },
        ]} />
        <AckSection title="Maintainers" subtitle="ClawNex is maintained by a small security-focused product team. Public identity details are intentionally minimized for operator privacy and launch safety." people={[
          { name: "ClawNex maintainers", desc: "Product, security, DLP policy, UX, and release ownership for the public project", links: { web: "https://clawnexai.com" } },
        ]} />

        {/* AI tooling disclosure -- Apache-2.0 + DCO already captures this in
            commit Co-Authored-By trailers; the panel surface adds an honest
            one-liner so a recruiter / customer / security reviewer reading
            the About page sees it explicitly without putting AI agents on a
            peer footing with the human team. Discussed and chosen
            2026-04-30 with operator. */}
        <div style={{
          marginTop: 18, padding: "10px 14px",
          background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 12,
          fontSize: 12, color: C.txS, lineHeight: 1.6,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.txT, marginBottom: 6 }}>
            AI Tooling
          </div>
          Built with the assistance of <strong style={{ color: C.tx }}>Anthropic Claude</strong> (Opus 4.6, 4.7, 4.8, and Fable 5) for code generation, documentation, and architectural review, and <strong style={{ color: C.tx }}>OpenAI Codex</strong> (GPT 5.4, 5.5) for code review, UX/UI critique, and vulnerability assessment. AI work was orchestrated through the <strong style={{ color: C.tx }}>Claude Code</strong> CLI, the <strong style={{ color: C.tx }}>Hermes</strong> review harness, and the <strong style={{ color: C.tx }}>OpenClaw</strong> gateway. Every commit was reviewed and shipped under operator authorship.
        </div>
      </CollapsibleCard>

      {/* Disclaimers */}
      <CollapsibleCard title="Disclaimers" accent={C.txT} defaultOpen={false}>
        <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.7 }}>
          <p style={{ margin: "0 0 10px" }}>
            <strong style={{ color: C.tx }}>Scope.</strong> ClawNex is a monitoring and detection platform — not a replacement for a full Security Operations Center (SOC), a SIEM, or a dedicated incident response team. It provides visibility and early warning; the operator is responsible for investigation and remediation.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            <strong style={{ color: C.tx }}>Shield coverage.</strong> The 163-detection built-in shield engine (plus any operator-authored custom rules in the starter Shield/DLP policy framework) detects known attack patterns through regex-based scanning. It does not guarantee detection of novel, zero-day, or adversarial-ML attacks. Defense in depth is always recommended — ClawNex is one layer, not the only layer.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            <strong style={{ color: C.tx }}>Cost accuracy.</strong> Token cost calculations use rates from the LiteLLM model pricing table, refreshed from GitHub at the pinned version tag. Actual provider billing may differ due to rate changes, promotional pricing, or metering discrepancies. Use ClawNex cost data for trend analysis and anomaly detection, not as a substitute for your provider invoices.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            <strong style={{ color: C.tx }}>LiteLLM dependency.</strong> ClawNex pins LiteLLM to v1.84.10 as the verified patched 1.84.x line for current LiteLLM proxy advisories. Do not upgrade LiteLLM without explicit verification. See the LiteLLM pinning note in SECURITY.md for details.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: C.tx }}>No warranty.</strong> ClawNex is provided &ldquo;as is&rdquo; under the Apache License 2.0, without warranties or conditions of any kind.
            See the LICENSE file for the full legal text.
          </p>
        </div>
      </CollapsibleCard>

      {/* Security & Responsible Disclosure */}
      <CollapsibleCard title="Security & Responsible Disclosure" accent={C.green} defaultOpen={false}>
        <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.7 }}>
          <p style={{ margin: "0 0 10px" }}>
            <strong style={{ color: C.tx }}>Found a vulnerability?</strong> Please report responsibly.
            Do not file public issues for security bugs.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            Email: <span style={{ fontFamily: F.mono, color: C.cyan }}>security@clawnexai.com</span> with subject line <span style={{ fontFamily: F.mono, color: C.txT }}>[SECURITY] Short description</span>.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            We aim to <strong style={{ color: C.tx }}>acknowledge within 72 hours</strong>, triage within 7 days, and ship a fix on a severity-dependent timeline
            (Critical: 7 days, High: 14 days, Medium: 30 days, Low: 60 days).
          </p>
          <p style={{ margin: 0, fontSize: 11, color: C.txT }}>
            Full policy: <span style={{ fontFamily: F.mono, color: C.cyan }}>SECURITY.md</span> at the repository root.
          </p>
        </div>
      </CollapsibleCard>

      {/* License */}
      <CollapsibleCard title="License" accent={C.purp} defaultOpen={false}>
        <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.7 }}>
          <p style={{ margin: "0 0 10px" }}>
            ClawNex is licensed under the <strong style={{ color: C.tx }}>Apache License, Version 2.0</strong>.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            The Apache 2.0 license includes an <strong style={{ color: C.tx }}>explicit patent grant</strong> from every contributor —
            protecting users from &ldquo;submarine patent&rdquo; claims. It also includes a defensive termination clause:
            if you sue anyone claiming the project infringes your patents, your own patent license to the project terminates.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            Contributions are accepted under the <strong style={{ color: C.tx }}>Developer Certificate of Origin (DCO)</strong> —
            a lightweight <span style={{ fontFamily: F.mono, color: C.cyan }}>Signed-off-by</span> line on every commit,
            certifying you have the right to submit the work under this license.
          </p>
          <p style={{ margin: 0, fontSize: 11, color: C.txT }}>
            Full contributor workflow: <span style={{ fontFamily: F.mono, color: C.cyan }}>CONTRIBUTING.md</span> at the repository root.
          </p>
        </div>
      </CollapsibleCard>
    </div>
  );
}
