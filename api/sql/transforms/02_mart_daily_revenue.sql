-- Mart: revenue per day, currency and source. Rebuilt in full (cheap at this size).
DROP TABLE IF EXISTS mart_daily_revenue;
CREATE TABLE mart_daily_revenue AS
SELECT source_id,
       date_trunc('day', updated_at)::date AS day,
       currency,
       count(*)                            AS orders,
       sum(amount_cents)                   AS revenue_cents
FROM orders
WHERE status <> 'cancelled'
GROUP BY 1, 2, 3
