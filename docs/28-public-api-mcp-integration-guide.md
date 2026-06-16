# ClawNex Public API and MCP Integration Guide

**Document ID:** CLAWNEX-PUB-INT-001
**Version:** 1.0
**Classification:** Public
**Product Version:** v0.15.0-alpha
**Status:** Public Reference

---

## 1. Purpose

This guide describes public-safe integration patterns for ClawNex APIs, OpenAI-compatible routing, and MCP-based workflows.

Use this document when building automation, CI checks, operator tooling, or AI-assistant integrations that need to interact with ClawNex.

---

## 2. Integration Surfaces

| Surface | Purpose | Typical Consumer |
|---|---|---|
| Dashboard API | Reads and updates ClawNex operational state | Dashboard and trusted automation |
| Public API | Programmatic shield, fleet, alert, audit, and health workflows | CI/CD, scripts, integrations |
| OpenAI-Compatible Endpoint | Model traffic routing through ClawNex controls | Agents and model clients |
| MCP Server | Tool/resource interface for AI assistants | Claude Code, Codex, and MCP-capable tools |

Exact endpoint availability can vary by release. Use the API reference and the running installation for final route details.

---

## 3. Authentication Model

Public API integrations should authenticate using a ClawNex API key or another configured authentication mechanism provided by the installation.

Use placeholders in automation templates:

```bash
export CLAWNEX_BASE_URL="https://YOUR_CLAWNEX_HOST"
export CLAWNEX_API_KEY="clx_REPLACE_WITH_REAL_KEY"
```

Do not commit API keys, provider keys, session cookies, or setup secrets to source control.

---

## 4. Common Request Pattern

```bash
curl -fsS "$CLAWNEX_BASE_URL/api/health"
```

For authenticated requests:

```bash
curl -fsS "$CLAWNEX_BASE_URL/api/v1/alerts" \
  -H "Authorization: Bearer $CLAWNEX_API_KEY"
```

Some installations may support a dedicated ClawNex key header. Prefer the documented method for the installed version.

---

## 5. Health Checks

Health checks are used to verify that the dashboard and service layer are reachable.

Example:

```bash
curl -fsS "$CLAWNEX_BASE_URL/api/health"
```

Expected result:

```json
{
  "status": "ok",
  "name": "ClawNex"
}
```

Installations may include additional timestamp or version fields.

---

## 6. Shield Scan Integration

Shield scan endpoints are used to submit text for evaluation.

Example pattern:

```bash
curl -fsS "$CLAWNEX_BASE_URL/api/v1/shield/scan" \
  -H "Authorization: Bearer $CLAWNEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Text to evaluate",
    "source": "ci-check"
  }'
```

Typical response fields include:

| Field | Meaning |
|---|---|
| verdict | `ALLOW`, `REVIEW`, or `BLOCK` |
| score | Numeric risk score |
| detections | Matching rule summaries |
| elapsed | Processing time |

Automation should treat `BLOCK` as a failed check and `REVIEW` as a policy decision.

---

## 7. OpenAI-Compatible Routing

ClawNex can sit in front of model providers through an OpenAI-compatible endpoint or proxy path.

Conceptual request:

```bash
curl -fsS "$CLAWNEX_BASE_URL/api/v1/chat/completions" \
  -H "Authorization: Bearer $CLAWNEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "configured-model-id",
    "messages": [
      {
        "role": "user",
        "content": "Summarize this incident."
      }
    ]
  }'
```

The exact model IDs depend on configured providers in the ClawNex dashboard.

---

## 8. Fleet, Alerts, and Audit

Common integration reads include:

| Workflow | Purpose |
|---|---|
| Fleet status | Verify connected services and agents |
| Alerts | Pull current incident and alert state |
| Audit | Review operator and system activity |
| Traffic monitor | Inspect recent model traffic metadata |
| Reports | Export evidence for governance workflows |

Example pattern:

```bash
curl -fsS "$CLAWNEX_BASE_URL/api/v1/fleet" \
  -H "Authorization: Bearer $CLAWNEX_API_KEY"
```

---

## 9. MCP Integration

MCP allows an AI assistant to interact with ClawNex through approved tools and resources.

Typical MCP use cases:

- Scan text before it is used in a workflow.
- Query current alert state.
- Review recent audit evidence.
- Inspect fleet posture.
- Retrieve security posture findings.
- Assist with incident triage.

MCP clients should run with the least privilege needed for the task. Avoid giving an assistant broad administrative access unless the workflow requires it and the operator understands the risk.

---

## 10. MCP Tool Model

A public-safe MCP integration should expose narrow tools such as:

| Tool Type | Purpose |
|---|---|
| Health tool | Confirm ClawNex is reachable |
| Shield scan tool | Submit content for policy evaluation |
| Alert read tool | Retrieve open alerts |
| Audit read tool | Retrieve relevant audit evidence |
| Fleet read tool | Retrieve service and agent state |
| Report tool | Retrieve or generate approved evidence artifacts |

Tools that mutate configuration or access control should be explicitly separated from read-only tools.

---

## 11. CI/CD Pattern

ClawNex can be used in CI/CD to scan prompts, agent instructions, or generated content before release.

Recommended pattern:

1. Store the ClawNex API key in the CI secret store.
2. Scan only the content needed for the check.
3. Fail the job on `BLOCK`.
4. Warn or require approval on `REVIEW`.
5. Archive the scan result as a build artifact if policy requires evidence.

---

## 12. Error Handling

Integrations should handle:

| Status | Meaning |
|---|---|
| 400 | Invalid request payload |
| 401 | Missing or invalid authentication |
| 403 | Authenticated but not authorized |
| 404 | Endpoint or resource not found |
| 409 | State conflict |
| 429 | Rate limited |
| 500 | Server error |

Automation should avoid retrying failed security decisions blindly. Retry transport failures, not policy decisions.

---

## 13. Security Guidance

- Store ClawNex keys in a secrets manager.
- Use least-privilege scopes where available.
- Rotate keys on a regular schedule.
- Do not expose local proxy ports publicly.
- Treat scan results and audit exports as sensitive operational evidence.
- Keep provider credentials out of prompts, logs, and source control.
- Review MCP tool permissions before connecting an assistant.

---

## 14. Intentionally Omitted

This public guide omits:

- Real credentials.
- Private deployment URLs.
- Internal endpoint inventories.
- Full schema definitions.
- Sensitive rule internals.
- Non-public operational procedures.

