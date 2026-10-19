-- Prompt 30: close the TRUNCATE gap in the append-only tables.
--
-- audit_logs (Prompt 18) and impact_point_transactions (Prompt 23) refuse
-- UPDATE and DELETE with row-level triggers, but row triggers never fire for
-- TRUNCATE, so one statement could still empty either table. These
-- statement-level triggers refuse it, with the same explicit maintenance
-- switch (`samadhaan.audit_maintenance = on` for the transaction) as the row
-- triggers.
--
-- Defence in depth only: production should also run the API as a database
-- role that does not own these tables and has no TRUNCATE privilege on them
-- (docs/PRODUCTION_CONFIGURATION.md).

CREATE OR REPLACE FUNCTION append_only_refuse_truncate() RETURNS trigger AS $$
BEGIN
  IF current_setting('samadhaan.audit_maintenance', true) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION '% is append-only (TRUNCATE refused)', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_refuse_truncate();

DROP TRIGGER IF EXISTS impact_point_transactions_no_truncate ON impact_point_transactions;
CREATE TRIGGER impact_point_transactions_no_truncate
  BEFORE TRUNCATE ON impact_point_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_refuse_truncate();
