-- Audit hash chain. Old rows stay unchained (both columns NULL).
ALTER TABLE audit_log ADD COLUMN prev_hash text;
ALTER TABLE audit_log ADD COLUMN row_hash text;
