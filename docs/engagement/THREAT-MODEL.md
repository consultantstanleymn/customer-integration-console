# Threat Model

## Metadata
- Label: threat model, scope and data classes
- Date: 2026-11-09
- Code commit: f1e553a
- Machine: local workstation
- Command: none
- Notes: Scope, boundaries, and data classes for FoodDistCo.
---

## Scope

This threat model covers the FoodDistCo order ingestion pipeline.

It includes:
- Browser users.
- Next.js web server.
- API service.
- Mock OIDC identity provider or Keycloak.
- Postgres database.
- CSV upload, REST source, and webhook sender source systems.
- Prometheus metrics.

The data-flow diagram is in `docs/engagement/ARCHITECTURE.md`.

## Boundaries

1. Browser
2. Web
3. API
4. Identity provider
5. Database
6. Source systems
7. Webhook senders
8. Observability

## Data classes

| Data class | Where it appears | Protection need |
|---|---|---|
| Customer emails in orders | CSV upload, REST source, webhook payloads, API routes, Postgres order tables, web UI | Confidentiality, least privilege, audit |
| Source credentials | Postgres source configuration, source credential rotation | Encryption at rest, secret provider, least privilege |
| Session ids | Browser session cookie, API session checks, audit log rows | Confidentiality, short lifetime, audit |
| Audit log | Postgres audit log table and hash chain | Tamper evidence, chain verification |
