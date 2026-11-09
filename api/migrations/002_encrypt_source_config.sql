-- Source credentials move out of sources.config into sources.config_secrets.
-- Each value is an envelope object. The one-time script scripts/migrate-plain-secrets.ts moves old rows.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS config_secrets jsonb NOT NULL DEFAULT '{}'::jsonb;
