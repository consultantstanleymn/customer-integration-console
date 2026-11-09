# Authorization matrix (expected)

Generated from the route table. Do not edit by hand.

`allow` means the call passed authz. A 2xx, 404 or 422 all count as passed authz.

| Method and path | Summary | Anonymous | Viewer | Engineer | Admin | Machine |
|---|---|---|---|---|---|---|
| `GET /auth/login` | Start single sign-on (redirects to the identity provider) | allow | allow | allow | allow | n/a |
| `GET /auth/callback` | Finish single sign-on, create the session | allow | allow | allow | allow | n/a |
| `POST /auth/logout` | End the session | 401 | allow | allow | allow | n/a |
| `GET /health` | Liveness and database check | allow | allow | allow | allow | n/a |
| `GET /me` | Current user, role and CSRF token | 401 | allow | allow | allow | 403 |
| `GET /sources` | List sources with health | 401 | allow | allow | allow | allow |
| `POST /sources` | Create a source | 401 | 403 | allow | allow | 403 |
| `DELETE /sources/:id` | Delete a source and its data | 401 | 403 | 403 | allow | 403 |
| `POST /sources/:id/run` | Run a REST or webhook source now | 401 | 403 | allow | allow | allow |
| `POST /sources/:id/upload` | Upload a CSV file (text/csv body) | 401 | 403 | allow | allow | 403 |
| `POST /webhooks/:id` | Receive a webhook (HMAC signed, no session) | allow | allow | allow | allow | n/a |
| `GET /runs` | Recent runs (?source_id, ?limit) | 401 | allow | allow | allow | 403 |
| `GET /runs/:id` | One run with its quality results | 401 | allow | allow | allow | 403 |
| `GET /stats` | Dashboard numbers: throughput per day, quality scorecard, totals | 401 | allow | allow | allow | 403 |
| `GET /dead-letters` | Rows that failed validation (?status) | 401 | allow | allow | allow | 403 |
| `POST /dead-letters/:id/replay` | Fix (optional) and replay a dead letter | 401 | 403 | allow | allow | 403 |
| `POST /dead-letters/:id/discard` | Discard a dead letter | 401 | 403 | allow | allow | 403 |
| `GET /audit` | Audit log (admin only) | 401 | 403 | 403 | allow | 403 |

Routes: 18. Matrix entries: 18.
