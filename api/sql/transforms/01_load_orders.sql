-- Transform + load: staging -> orders. Parameter $1 = run id.
-- Idempotent: running it twice gives the same table. An older row never overwrites a newer one.
INSERT INTO orders (source_id, external_id, customer_email, amount_cents, currency, status, updated_at)
SELECT DISTINCT ON (source_id, external_id)
       source_id,
       trim(external_id),
       lower(trim(customer_email)),
       round(amount * 100)::bigint,
       upper(trim(currency)),
       lower(trim(status)),
       updated_at
FROM stg_orders
WHERE run_id = $1
ORDER BY source_id, external_id, updated_at DESC
ON CONFLICT (source_id, external_id) DO UPDATE
  SET customer_email = EXCLUDED.customer_email,
      amount_cents   = EXCLUDED.amount_cents,
      currency       = EXCLUDED.currency,
      status         = EXCLUDED.status,
      updated_at     = EXCLUDED.updated_at,
      loaded_at      = now()
  WHERE EXCLUDED.updated_at > orders.updated_at
