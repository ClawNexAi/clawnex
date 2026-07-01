# ClawNex Public Low-Level Architecture

**Document ID:** CLAWNEX-PUB-LLD-001
**Version:** 1.0
**Classification:** Public
**Product Version:** v0.15.2-alpha
**Status:** Public Reference

---

## 1. Purpose

This document gives a public-safe low-level view of ClawNex. It explains the major modules, data pipelines, and runtime responsibilities without exposing private implementation details, internal-only paths, secrets, or rule internals.

---

## 2. Module Map

| Module Area | Responsibility |
|---|---|
| Database Core | Initializes local storage, applies schema, and provides query helpers |
| Configuration Service | Manages providers, gateways, shield settings, defaults, and operational options |
| Authentication and RBAC | Handles operators, sessions, role checks, and protected dashboard access |
| Shield Scanner | Evaluates content using ClawNex Shield Rules and returns verdicts, scores, and detections |
| Proxy Integration | Receives traffic metadata from the model proxy and applies shield decisions |
| Alert Manager | Creates and maintains alert lifecycle state |
| Audit Logger | Records security-relevant operator and system activity |
| Correlation Engine | Groups related signals into higher-level security findings |
| Session Watcher | Reads supported agent-session sources and turns activity into scan and traffic records |
| Security Posture | Runs and displays host, installation, network, prerequisite, and security checks |
| Trust Audit | Models agent reachability, exposed surfaces, and trust-boundary findings |
| Reporting | Produces operator and executive evidence artifacts |
| Dashboard Panels | Present operational, security, governance, and compliance workflows |

---

## 3. Request Pipeline

Dashboard and API requests follow this public model:

1. Request enters the ClawNex dashboard service.
2. Middleware applies public route handling and protected route checks.
3. RBAC is evaluated when enabled.
4. The route handler validates inputs.
5. The appropriate service performs the operation.
6. State changes are recorded in the database.
7. Security-relevant actions are written to audit.
8. The dashboard receives a structured JSON response or live update.

---

## 4. Shield Scan Pipeline

ClawNex shield scanning follows this pattern:

1. Receive text or traffic metadata from the dashboard, proxy, tests, or watcher.
2. Normalize scan options and applicable rule scope.
3. Run content through ClawNex Shield Rules.
4. Produce detections with severity, category, and confidence.
5. Calculate a score and verdict.
6. Store scan evidence when the source requires persistence.
7. Create or update alerts when policy requires operator attention.
8. Expose the result in dashboard panels and APIs.

Common verdicts are:

| Verdict | Meaning |
|---|---|
| ALLOW | No blocking condition was found |
| REVIEW | The content deserves operator review |
| BLOCK | The content should be stopped according to current policy |

---

## 5. Proxy Integration Pipeline

When model traffic is routed through the proxy integration:

1. The client sends an OpenAI-compatible request to the configured proxy endpoint.
2. The proxy integration calls ClawNex before or during request handling depending on configured mode.
3. ClawNex evaluates the request and returns a shield decision.
4. The proxy allows, records, or blocks the request according to policy.
5. Response and traffic metadata are sent back to ClawNex for visibility.

The proxy should run as an internal service. In VPS mode, it is not intended to be public-facing.

---

## 6. Alert and Incident Pipeline

Alert handling uses a simple lifecycle:

1. Signal arrives from shield, traffic, posture, trust audit, or operator action.
2. Alert manager checks for an existing related alert.
3. New or updated alert state is persisted.
4. Dashboard panels reflect the current status.
5. Operators can acknowledge, investigate, resolve, suppress similar items, or accept risk where supported.
6. Actions are recorded in audit.

---

## 7. Correlation Pipeline

The correlation engine connects events that are more meaningful together than alone. Examples include:

- Repeated shield blocks in a short time window.
- Alerts across multiple sources.
- Audit events paired with unusual traffic.
- Policy or posture changes near security events.

Correlation findings appear in the dashboard so operators can move from individual alerts to incident-level reasoning.

---

## 8. Trust Audit Pipeline

Trust Audit models who can reach agents, what paths exist, and where control gaps may appear.

The public model includes:

- Surface inventory.
- Agent reachability.
- Confidence labels.
- Finding severity.
- Remediation guidance.
- Risk acceptance workflow where appropriate.

Trust Audit is designed to make assumptions visible. Operators should review confidence levels before treating a finding as definitive.

---

## 9. Configuration Model

ClawNex stores operational configuration for:

- AI model providers.
- Default model routing.
- Shield settings.
- Local model cost rates.
- Fleet and gateway routing.
- Correlation rules.
- Access control.
- Report settings.
- Governance and evidence options.

Configuration changes that affect security posture or operator access should be considered audit-relevant.

---

## 10. Persistence Model

The local database stores the working state for a ClawNex installation. Key record families include:

- Operators and sessions.
- Providers and models.
- Shield scans and traffic metadata.
- Alerts and incidents.
- Audit events.
- Security posture results.
- Trust audit findings.
- Reports and governance evidence.

Operators should back up the database before destructive reinstall or cleanup operations when they want to preserve history.

---

## 11. Extension Points

Public extension points include:

- REST API access for scans and operational reads.
- OpenAI-compatible routing through the model proxy.
- MCP integration for agent-assisted operations.
- Dashboard configuration for providers and shield settings.
- Report exports for governance and executive workflows.

---

## 12. Intentionally Omitted

This public LLD omits:

- Full function-by-function inventories.
- Private rule patterns.
- Internal-only module paths.
- Secrets, sample real keys, and private environment values.
- Non-public deployment notes.
- Internal roadmap comments.

