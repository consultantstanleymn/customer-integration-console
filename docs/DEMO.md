# Five-minute demo script

Setup: `npm run stack`, open the web URL. Have `sample-data/` open in a file browser. Optional: `docker compose --profile observability up` for Grafana.

| Time | Do | Say |
|---|---|---|
| 0:00 | Open the site. You land on the sign-in page. | "Nobody sees data without signing in. Sign-in goes to the customer's identity provider. Here it is a local mock." |
| 0:30 | Sign in as **Bob Engineer**. Point at the role badge. | "The role comes from the identity provider and decides what I can do." |
| 0:45 | **Sources**: create `orders-csv` (CSV). Upload `orders_good.csv`. | "Five rows in, five loaded. Validated, staged, then loaded by plain SQL." |
| 1:30 | Upload `orders_with_errors.csv`. | "One row loaded, three failed. The run did not fail. Bad rows are parked." |
| 2:00 | **Dead letters**: fix the bad email in the JSON, **Replay**. | "Every bad row has a reason. The customer fixes it, I replay it. Same pipeline, same checks." |
| 2:45 | **Sources**: create a REST source with the mock URL and key `demo-key`. **Run now**. | "120 rows over three pages. The mock rate limits, and the client waits and retries. The next run only asks for newer rows (the watermark)." |
| 3:30 | **Dashboard**: run table, chart, scorecard, connector health. Upload `orders_drifted.csv` to a new source to show schema drift. | "Quality checks run on every run: nulls, duplicates, drift, validation rate. A source that needs attention shows in the health table." |
| 4:15 | Sign out. Sign in as **Carol Viewer**. Show no create form. Open `/audit`. | "A viewer can look but not touch. The server enforces it, not only the screen." |
| 4:45 | Sign in as **Alice Admin**, **Audit log**. | "Every sign-in, change and denied attempt is recorded. The database refuses edits to this table." |
| 5:00 | Optional: Grafana dashboard, `/metrics`. | "Runs, rows and dead letters are Prometheus metrics, so on-call can alert on them." |

Likely questions: see the "what to say" notes in [LEARN.md](../LEARN.md) and the open points in [DECISIONS.md](DECISIONS.md).
