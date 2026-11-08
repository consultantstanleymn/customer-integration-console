-- Mart: one row per customer email, with lifetime value.
DROP TABLE IF EXISTS mart_customer_summary;
CREATE TABLE mart_customer_summary AS
SELECT customer_email,
       count(*)                                         AS orders,
       sum(amount_cents) FILTER (WHERE status <> 'cancelled') AS lifetime_cents,
       max(updated_at)                                  AS last_order_at
FROM orders
GROUP BY customer_email
