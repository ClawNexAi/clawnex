# ClawNex Public Infrastructure Architecture

**Document ID:** CLAWNEX-PUB-INFRA-001
**Version:** 1.0
**Classification:** Public
**Product Version:** v0.15.0-alpha
**Status:** Public Reference

---

## 1. Purpose

This document describes the public infrastructure model for ClawNex. It is intended for operators, reviewers, and integration teams who need to understand what runs, where traffic flows, and which trust boundaries ClawNex introduces.

This is a sanitized public version of the internal infrastructure design. It intentionally omits internal hostnames, private paths, credentials, implementation-only notes, and environment-specific details.

---

## 2. Platform Summary

ClawNex is an AI agent security operations platform. It provides a dashboard, policy and shield controls, audit evidence, model-provider routing visibility, traffic monitoring, fleet status, and operator workflows for investigating AI-agent activity.

At runtime, a typical installation includes:

| Component | Role |
|---|---|
| ClawNex Dashboard | Web UI, API backend, configuration, audit, security posture, fleet views, and operator workflows |
| LiteLLM Proxy | OpenAI-compatible model proxy used to route model traffic through shield controls |
| Local Database | Stores configuration, audit events, alerts, traffic metadata, scan results, and operator state |
| Service Manager | Keeps ClawNex services running on the target host |
| Reverse Proxy | Provides HTTPS and public-domain routing for VPS deployments |
| OpenClaw Gateway | Optional agent gateway integration used to observe agent sessions and routing state |

---

## 3. Deployment Modes

ClawNex supports two primary deployment modes.

### 3.1 Local Mode

Local mode is designed for a workstation, lab host, or single-operator environment. The dashboard and proxy bind locally, and the operator can choose whether to enable RBAC during setup.

Common local-mode characteristics:

- Localhost-only access by default.
- Optional RBAC depending on the operator's setup choice.
- No public TLS requirement.
- Suitable for testing, demos, development, and local agent monitoring.

### 3.2 VPS Mode

VPS mode is designed for a public or private server. It assumes a domain name, HTTPS, service supervision, and RBAC.

Common VPS-mode characteristics:

- HTTPS via reverse proxy.
- RBAC enabled.
- Dashboard served through a public domain.
- Services managed by the host service manager.
- LiteLLM proxy bound to localhost so it is not directly exposed.

---

## 4. Runtime Services

| Service | Default Binding | Public Exposure | Purpose |
|---|---:|---|---|
| Dashboard | Local HTTP port | Exposed only through reverse proxy in VPS mode | UI and API backend |
| LiteLLM Proxy | `127.0.0.1` local HTTP port | Not publicly exposed | Model traffic proxy and shield enforcement point |
| Reverse Proxy | 80/443 in VPS mode | Public | HTTPS termination and routing to dashboard |
| OpenClaw Gateway | Local gateway endpoint | Deployment-specific | Agent gateway integration |

The LiteLLM proxy should remain localhost-only. Public model traffic should reach ClawNex through the approved dashboard/API or through explicitly configured internal routing.

---

## 5. Network Boundaries

ClawNex separates four important network zones:

| Zone | Description | Control Objective |
|---|---|---|
| Operator Browser | Human operator access to the ClawNex dashboard | Authenticate, authorize, audit |
| Dashboard/API | ClawNex application service | Enforce RBAC, config policy, audit logging, and shield APIs |
| Model Proxy | Local LiteLLM proxy used for model routing | Keep local-only, enforce configured shield mode |
| Upstream Providers | External or local model providers | Route only through configured providers and retain audit evidence |

In VPS mode, the reverse proxy is the only intended public entry point. Internal services should not be directly exposed to the internet.

---

## 6. Data Storage

ClawNex uses a local database for operational state. The database stores:

- Operator and session state.
- Model provider configuration.
- Fleet and service metadata.
- Alert and incident records.
- Shield scan results and traffic metadata.
- Audit events and governance evidence.
- Security posture and trust audit findings.

Operators should include the database and environment files in their backup plan, but should treat those files as sensitive because they can contain operational metadata and security configuration.

---

## 7. Authentication and Authorization

ClawNex supports RBAC for operator access. In VPS deployments, RBAC is expected to be enabled. In local deployments, the installer can offer a choice between RBAC and no-RBAC operation depending on the operator's use case.

When RBAC is enabled:

- Operators authenticate before accessing protected dashboard routes.
- Administrative actions are tied to an operator identity.
- Sensitive configuration actions are logged.
- Session and access-control events contribute to the audit trail.

---

## 8. Model Provider Connectivity

ClawNex can route model traffic through configured providers. Provider configuration is managed after installation through the dashboard and can include cloud providers or local model endpoints.

The public infrastructure expectation is:

- Provider credentials are stored outside source control.
- Credentials are never printed in logs or public documentation.
- Provider changes are auditable.
- Local model endpoints are operator-managed and not assumed for VPS installs.

---

## 9. Operational Observability

ClawNex exposes operational views for:

- Service health.
- Fleet readiness.
- Shield activity.
- Alerts and incidents.
- Traffic monitor events.
- Token and cost intelligence.
- Security posture.
- Trust audit results.
- Audit and evidence review.

These views are intended to help operators understand whether agents are connected, whether shield controls are active, and whether current activity requires investigation.

---

## 10. Public-Safe Architecture Guarantees

The public deployment model is built around these guarantees:

- The model proxy is not intentionally exposed to the public internet.
- VPS deployments use HTTPS and RBAC.
- Security-sensitive configuration is auditable.
- Prompt shield behavior is operator-visible.
- Service health can be verified without exposing secrets.
- Installer behavior should make deployment mode choices explicit to the operator.

---

## 11. Intentionally Omitted

This public document does not include:

- Internal hostnames or private IP addresses.
- Personal workstation paths.
- Private keys, tokens, or credential formats beyond placeholders.
- Full database schema definitions.
- Internal implementation notes.
- Security-sensitive rule internals.

