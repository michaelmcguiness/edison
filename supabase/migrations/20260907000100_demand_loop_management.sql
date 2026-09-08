-- D34: explicit future-direction edits and retention-preserving loop deletion.
-- No provider requests, content, allowance, or historical snapshot is rewritten.
ALTER TABLE private.demand_loops ADD COLUMN editor_instructions text;
ALTER TABLE private.demand_loops ADD COLUMN archived_at timestamp with time zone;
ALTER TABLE private.demand_loops ADD CONSTRAINT demand_loops_editor_instructions_length
  CHECK (editor_instructions IS NULL OR char_length(editor_instructions) <= 500);

CREATE TABLE private.demand_loop_edits (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES private.demand_principals(id) ON DELETE RESTRICT,
  loop_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  operation text NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT demand_loop_edits_owner_fk FOREIGN KEY (principal_id, loop_id)
    REFERENCES private.demand_loops(principal_id, id) ON DELETE RESTRICT,
  CONSTRAINT demand_loop_edits_key_valid CHECK (char_length(idempotency_key) BETWEEN 8 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'),
  CONSTRAINT demand_loop_edits_fingerprint_valid CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT demand_loop_edits_operation_valid CHECK (operation IN ('edit', 'archive')),
  CONSTRAINT demand_loop_edits_receipt_valid CHECK (jsonb_typeof(receipt) = 'object'
    AND pg_column_size(receipt) <= 262144)
);
CREATE UNIQUE INDEX demand_loop_edits_principal_key_unique ON private.demand_loop_edits (principal_id, idempotency_key);
CREATE INDEX demand_loop_edits_loop_created_idx ON private.demand_loop_edits (principal_id, loop_id, created_at);
ALTER TABLE private.demand_loop_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.demand_loop_edits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.demand_loop_edits FROM PUBLIC, anon, authenticated, service_role,
  edison_api, edison_public, edison_demand_api, edison_demand_worker;
GRANT SELECT, INSERT ON private.demand_loop_edits TO edison_demand_worker;
CREATE POLICY demand_loop_edits_worker_select ON private.demand_loop_edits
  FOR SELECT TO edison_demand_worker USING (true);
CREATE POLICY demand_loop_edits_worker_insert ON private.demand_loop_edits
  FOR INSERT TO edison_demand_worker WITH CHECK (true);

CREATE FUNCTION private.guard_demand_loop_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.principal_id IS DISTINCT FROM OLD.principal_id
    OR NEW.original_curiosity IS DISTINCT FROM OLD.original_curiosity
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'demand loop identity and original request are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'demand loop archive is permanent' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_demand_loop_identity() FROM PUBLIC;
CREATE TRIGGER demand_loops_identity_immutable BEFORE UPDATE ON private.demand_loops
  FOR EACH ROW EXECUTE FUNCTION private.guard_demand_loop_identity();

-- The supported deletion path is archive, never a cascade over retained reading.
REVOKE DELETE ON private.demand_loops FROM edison_demand_worker;
