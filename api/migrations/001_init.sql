-- Core tables. Every statement is plain SQL so a customer DBA can read it.
CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_email   text NOT NULL,
  user_name    text NOT NULL,
  role         text NOT NULL CHECK (role IN ('admin','engineer','viewer')),
  csrf_token   text NOT NULL,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sources (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  type        text NOT NULL CHECK (type IN ('csv','rest','webhook')),
  config      jsonb NOT NULL DEFAULT '{}',
  watermark   text,                      -- highest updated_at loaded so far (ISO string)
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runs (
  id               serial PRIMARY KEY,
  source_id        integer NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  kind             text NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','upload','webhook','replay')),
  status           text NOT NULL CHECK (status IN ('running','success','failed')),
  rows_in          integer NOT NULL DEFAULT 0,
  rows_loaded      integer NOT NULL DEFAULT 0,
  rows_failed      integer NOT NULL DEFAULT 0,
  watermark_before text,
  watermark_after  text,
  error            text,
  triggered_by     text NOT NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);
CREATE INDEX runs_source_started ON runs (source_id, started_at DESC);

-- Bad rows are parked here instead of failing the whole run.
CREATE TABLE dead_letters (
  id         serial PRIMARY KEY,
  run_id     integer NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  source_id  integer NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  payload    jsonb NOT NULL,
  errors     jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','replayed','discarded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE quality_results (
  id        serial PRIMARY KEY,
  run_id    integer NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  check_name text NOT NULL,
  passed    boolean NOT NULL,
  detail    text NOT NULL
);

CREATE TABLE webhook_events (
  id          serial PRIMARY KEY,
  source_id   integer NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  payload     jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_run_id integer REFERENCES runs(id)
);

-- Staging: rows of the current run that passed validation.
CREATE TABLE stg_orders (
  run_id         integer NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  source_id      integer NOT NULL,
  external_id    text NOT NULL,
  customer_email text NOT NULL,
  amount         numeric NOT NULL,
  currency       text NOT NULL,
  status         text NOT NULL,
  updated_at     timestamptz NOT NULL
);

-- Target table. (source_id, external_id) is the idempotency key.
CREATE TABLE orders (
  source_id      integer NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id    text NOT NULL,
  customer_email text NOT NULL,
  amount_cents   bigint NOT NULL,
  currency       text NOT NULL,
  status         text NOT NULL,
  updated_at     timestamptz NOT NULL,
  loaded_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, external_id)
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor      text NOT NULL,
  role       text,
  action     text NOT NULL,
  target     text,
  outcome    text NOT NULL CHECK (outcome IN ('ok','denied','error')),
  detail     jsonb NOT NULL DEFAULT '{}'
);

-- Audit rows can be added but never changed or removed.
CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
