# Architecture

## Metadata
- Label: architecture and data-flow diagram
- Date: 2026-11-09
- Code commit: f1e553a
- Machine: local workstation
- Command: none
- Notes: Data-flow diagram and trust boundaries for FoodDistCo.
---

## Data-flow diagram

```mermaid
flowchart TD
    subgraph TB_BROWSER["Trust boundary: Browser"]
        B["Browser"]
    end

    subgraph TB_WEB["Trust boundary: Web"]
        WEB["Next.js web server"]
    end

    subgraph TB_API["Trust boundary: API"]
        API["API service"]
        AUTH["Auth and RBAC"]
        AUDIT["Audit log writer"]
    end

    subgraph TB_IDP["Trust boundary: Identity provider"]
        IDP["Mock OIDC or Keycloak"]
    end

    subgraph TB_DB["Trust boundary: Database"]
        DB[("Postgres")]
    end

    subgraph TB_SOURCES["Trust boundary: Source systems"]
        CSV["CSV upload"]
        REST["REST source"]
    end

    subgraph TB_WEBHOOK["Trust boundary: Webhook senders"]
        WH["Webhook senders"]
    end

    subgraph TB_OBS["Trust boundary: Observability"]
        PROM["Prometheus"]
    end

    B -->|"1. HTTPS page load"| WEB
    WEB -->|"2. API call"| API
    B -->|"3. OIDC login redirect"| IDP
    IDP -->|"4. Authorization code"| B
    B -->|"5. Authorization code"| API
    API -->|"6. OIDC discovery, token exchange, JWKS"| IDP
    API -->|"7. Set session cookie"| B
    API --> AUTH
    AUTH -->|"8. RBAC decision"| API
    API --> AUDIT
    API -->|"9. Read and write application data"| DB
    AUDIT -->|"10. Append audit log row"| DB
    API -->|"11. Read source credentials and fetch orders"| REST
    REST -->|"12. Order data"| API
    B -->|"13. Select CSV file"| CSV
    CSV -->|"14. Upload order rows"| API
    WH -->|"15. Signed webhook order event"| API
    API -->|"16. Metrics"| PROM
```

## Trust boundaries

1. Browser. The user interface runs on a customer device.
2. Web. The Next.js web server renders the UI and forwards requests.
3. API. The API service checks auth and RBAC. It writes audit log rows.
4. Identity provider. The mock OIDC server or Keycloak issues identity tokens.
5. Database. Postgres stores orders, source credentials, sessions, and audit log rows.
6. Source systems. CSV upload and REST source provide order data.
7. Webhook senders. Signed webhook providers send order events.
8. Observability. Prometheus scrapes metrics from the API.

## Numbered data flows

1. Browser loads the web UI from the web server.
2. Web server calls the API.
3. Browser starts OIDC login at the identity provider.
4. Identity provider returns an authorization code to the browser.
5. Browser sends the authorization code to the API.
6. API performs OIDC discovery and token exchange with the identity provider.
7. API sets a session cookie in the browser.
8. API checks the session and RBAC decision.
9. API reads and writes application data in Postgres.
10. API appends an audit log row in Postgres.
11. API reads source credentials from Postgres and calls the REST source.
12. REST source returns order data to the API.
13. Browser selects a CSV file for upload.
14. CSV upload sends order rows to the API.
15. Webhook senders send signed order events to the API.
16. API exposes metrics to Prometheus.
