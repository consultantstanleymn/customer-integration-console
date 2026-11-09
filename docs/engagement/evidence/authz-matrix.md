# Authorization matrix (expected)

Generated from the route table. Do not edit by hand.

`allow` means the call passed authz. A 2xx, 404 or 422 all count as passed authz.

| Method and path | Summary | Anonymous | Viewer | Engineer | Admin |
|---|---|---|---|---|---|
| `GET /auth/login` | Start single sign-on (redirects to the identity provider) | allow | allow | allow | allow |
| `GET /auth/callback` | Finish single sign-on, create the session | allow | allow | allow | allow |
| `POST /auth/logout` | End the session | 401 | allow | allow | allow |
| `GET /health` | Liveness and database check | allow | allow | allow | allow |
| `GET /me` | Current user, role and CSRF token | 401 | allow | allow | allow |
| `GET /sources` | List sources with health | 401 | allow | allow | allow |
| `POST /sources` | Create a source | 401 | 403 | allow | allow |
| `DELETE /sources/:id` | Delete a source and its data | 401 | 403 | 403 | allow |
| `POST /sources/:id/run` | Run a REST or webhook source now | 401 | 403 | allow | allow |
| `POST /sources/:id/upload` | Upload a CSV file (text/csv body) | 401 | 403 | allow | allow |
| `POST /webhooks/:id` | Receive a webhook (HMAC signed, no session) | allow | allow | allow | allow |
| `GET /runs` | Recent runs (?source_id, ?limit) | 401 | allow | allow | allow |
| `GET /runs/:id` | One run with its quality results | 401 | allow | allow | allow |
| `GET /stats` | Dashboard numbers: throughput per day, quality scorecard, totals | 401 | allow | allow | allow |
| `GET /dead-letters` | Rows that failed validation (?status) | 401 | allow | allow | allow |
| `POST /dead-letters/:id/replay` | Fix (optional) and replay a dead letter | 401 | 403 | allow | allow |
| `POST /dead-letters/:id/discard` | Discard a dead letter | 401 | 403 | allow | allow |
| `GET /audit` | Audit log (admin only) | 401 | 403 | 403 | allow |

Routes: 18. Matrix entries: 18.
