ALTER TABLE "private"."ai_request_reservations" ADD COLUMN "request_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "private"."ai_request_reservations" ALTER COLUMN "request_snapshot" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "private"."ai_request_reservations" ADD CONSTRAINT "ai_request_reservations_snapshot_valid" CHECK (jsonb_typeof("private"."ai_request_reservations"."request_snapshot") = 'object' and pg_column_size("private"."ai_request_reservations"."request_snapshot") <= 1048576);--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.prevent_ai_request_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.operation IS DISTINCT FROM OLD.operation
    OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
    OR NEW.request_snapshot IS DISTINCT FROM OLD.request_snapshot THEN
    RAISE EXCEPTION 'AI request identity and snapshot are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_request_reservations_identity_immutable"
BEFORE UPDATE OF user_id, operation, resource_id, idempotency_key,
  request_fingerprint, request_snapshot
ON private.ai_request_reservations
FOR EACH ROW EXECUTE FUNCTION private.prevent_ai_request_identity_change();
