# ClawNex Public High-Level Architecture

**Document ID:** CLAWNEX-PUB-HLD-001
**Version:** 1.0
**Classification:** Public
**Product Version:** v0.15.0-alpha
**Status:** Public Reference

---

## 1. Purpose

This document explains ClawNex at a high level: what it does, which components participate, how traffic moves, and where the main security boundaries exist.

This is a sanitized public version of the internal high-level architecture. It is suitable for customers, partners, operators, and technical evaluators.

---

## 2. Product Overview

ClawNex is a control layer for AI agents in production. It helps operators govern, defend, and prove what happened across an AI-agent environment.

The platform focuses on:

- Fleet visibility across connected agent systems.
- Prompt shield inspection and blocking.
- Alert and incident management.
- Threat correlation across traffic, audit, and fleet signals.
- Blast radius and trust boundary analysis.
- Security posture checks.
- Token and cost intelligence.
- Governance evidence and executive reporting.

---

## 3. System Context

```text
Operator Browser
      |
      v
ClawNex Dashboard and API
      |
      +--> Local Database
      |
      +--> LiteLLM Proxy
      |        |
      |        v
      |   Model Providers
      |
      +--> OpenClaw / Agent Gateway
      |
      +--> Security, Audit, and Governance Services
```

The dashboard is the operator-facing control plane. The proxy is the model-routing enforcement point. The database stores operational evidence. Optional gateway integrations supply fleet and session context.

---

## 4. Core Components

| Component | Responsibility |
|---|---|
| Dashboard UI | Presents Mission Control, Fleet Command, Instance Detail, Correlations, Blast Radius, Security Posture, Trust Audit, Traffic Monitor, and governance panels |
| API Backend | Serves dashboard data, configuration, authentication, audit, health, and shield workflows |
| Prompt Shield | Evaluates prompts and related content against ClawNex Shield Rules |
| LiteLLM Proxy Integration | Routes model calls and gives ClawNex a model-traffic enforcement point |
| Alert Manager | Creates, updates, groups, acknowledges, and resolves alerts |
| Correlation Engine | Connects related signals across shield, traffic, audit, and infrastructure activity |
| Trust Audit | Reviews who can reach agents, what they can do, and what happens if trust is wrong |
| Security Posture | Tracks hardening checks, CVE context, remediation suggestions, and posture score |
| Audit and Evidence | Records operator and system activity for review and reporting |
| Configuration | Manages model providers, routing, shield settings, access control, and operational defaults |

---

## 5. Traffic Flow

### 5.1 Operator Flow

1. The operator opens the ClawNex dashboard.
2. ClawNex authenticates the operator when RBAC is enabled.
3. The dashboard calls ClawNex APIs for live state and panel data.
4. Sensitive actions are recorded in the audit trail.

### 5.2 Model Traffic Flow

1. An agent or client sends a model request to the configured model endpoint.
2. The request flows through the LiteLLM proxy integration when routing is enabled.
3. ClawNex evaluates the request according to shield settings.
4. Depending on policy, the request is allowed, reviewed, or blocked.
5. Traffic metadata, verdicts, and relevant evidence are recorded.

### 5.3 Posture and Evidence Flow

1. ClawNex collects service, fleet, security, and audit signals.
2. Findings are mapped into posture, correlation, blast-radius, or trust-audit views.
3. Operators can investigate, accept risk, resolve alerts, or export reports.

---

## 6. Trust Boundaries

ClawNex treats the following as distinct boundaries:

| Boundary | Risk |
|---|---|
| Browser to Dashboard | Unauthorized operator access |
| Dashboard to Database | Unauthorized configuration or evidence mutation |
| Dashboard to Proxy | Misrouted or unscanned model traffic |
| Proxy to Provider | Credential exposure or unexpected provider routing |
| Gateway to Agents | Agents bypassing shield or operating outside expected policy |
| Public Internet to VPS | Exposed services, TLS, and authentication failures |

The platform makes these boundaries visible so operators can reason about exposure and control failures.

---

## 7. Security Model

The public security model is based on:

- RBAC for public deployments.
- Local-only binding for internal proxy services.
- Explicit provider configuration.
- Shield mode visibility.
- Audit logging for operator and system actions.
- Alert and correlation workflows for security events.
- Trust audit and blast-radius views for exposure analysis.

ClawNex is not a replacement for host hardening, network controls, endpoint security, or provider-side security controls. It is the agent-fleet control and evidence layer.

---

## 8. Deployment Model

The installer supports local and VPS-oriented deployment paths.

Local deployment prioritizes fast setup and single-host operation. VPS deployment adds public-domain assumptions such as HTTPS, service supervision, and RBAC.

The expected production pattern is:

- Public entry through HTTPS.
- Dashboard behind the reverse proxy.
- Proxy bound to localhost.
- Provider credentials configured after install.
- Audit and posture checks reviewed before go-live.

---

## 9. Design Choices

| Choice | Reason |
|---|---|
| Local database | Keeps alpha deployments simple, portable, and easy to back up |
| LiteLLM proxy integration | Uses an OpenAI-compatible routing layer instead of forcing every client to integrate a new SDK |
| Dashboard-first operations | Security operators need scan, investigate, resolve, and report workflows in one place |
| Built-in shield rules | Avoids install-time dependency on third-party rule downloads |
| Explicit deployment modes | Local and VPS installs have different risk profiles and should be chosen deliberately |

---

## 10. Public Scope

This document does not disclose internal source inventories, private paths, private environments, or implementation-only controls. For installation and operations, use the deployment and troubleshooting guides in this documentation set.

