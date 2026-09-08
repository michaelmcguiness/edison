-- Reader entitlement is separate from provider spend. Existing requests, usage,
-- stages, loops and published snapshots retain their original identities.
CREATE TABLE private.demand_principal_claims (
  principal_id uuid PRIMARY KEY REFERENCES private.demand_principals(id) ON DELETE RESTRICT,
  account_principal_id uuid NOT NULL REFERENCES private.demand_principals(id) ON DELETE RESTRICT,
  guest_token_hash text NOT NULL UNIQUE CHECK (guest_token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demand_principal_claims_account ON private.demand_principal_claims(account_principal_id);

CREATE TABLE private.demand_allowance_grants (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES private.demand_principals(id) ON DELETE RESTRICT,
  period_start timestamptz NOT NULL,
  revision integer NOT NULL CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (principal_id, period_start, revision),
  CHECK (period_start = date_trunc('week', period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
);
CREATE TABLE private.demand_allowance_allocations (
  request_id uuid PRIMARY KEY REFERENCES private.demand_requests(id) ON DELETE RESTRICT,
  grant_id uuid NOT NULL REFERENCES private.demand_allowance_grants(id) ON DELETE RESTRICT,
  units integer NOT NULL CHECK (units BETWEEN 1 AND 6),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demand_allowance_allocations_grant ON private.demand_allowance_allocations(grant_id);
-- A merge carries the guest's current grant into this particular account
-- revision, never into a future manual reset. Its pending work remains live.
CREATE TABLE private.demand_allowance_carryovers (
  source_grant_id uuid PRIMARY KEY REFERENCES private.demand_allowance_grants(id) ON DELETE RESTRICT,
  target_grant_id uuid NOT NULL REFERENCES private.demand_allowance_grants(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_grant_id <> target_grant_id)
);
CREATE TABLE private.demand_allowance_resets (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES private.demand_principals(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128 AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'),
  previous_grant_id uuid NOT NULL REFERENCES private.demand_allowance_grants(id) ON DELETE RESTRICT,
  grant_id uuid NOT NULL UNIQUE REFERENCES private.demand_allowance_grants(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (principal_id, idempotency_key)
);
CREATE TABLE private.demand_allowance_reset_attempts (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES private.demand_principals(id) ON DELETE RESTRICT,
  accepted boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demand_allowance_reset_attempts_reader_time ON private.demand_allowance_reset_attempts(principal_id,created_at DESC);

CREATE FUNCTION private.demand_reader_id(requested_principal_id uuid)
RETURNS uuid LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT account_principal_id FROM private.demand_principal_claims WHERE principal_id=requested_principal_id), requested_principal_id)
$$;
REVOKE ALL ON FUNCTION private.demand_reader_id(uuid) FROM PUBLIC,anon,authenticated,service_role,edison_api,edison_public;
GRANT EXECUTE ON FUNCTION private.demand_reader_id(uuid) TO edison_demand_api,edison_demand_worker;

CREATE OR REPLACE FUNCTION private.demand_principal_is_active(requested_principal_id uuid)
RETURNS boolean LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS (
  SELECT 1 FROM private.demand_principals leaf
  JOIN private.demand_principals reader ON reader.id=private.demand_reader_id(leaf.id)
  WHERE leaf.id=requested_principal_id AND leaf.revoked_at IS NULL AND reader.revoked_at IS NULL
   AND ((reader.account_user_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.alpha_memberships m WHERE m.user_id=reader.account_user_id AND m.status='active'))
    OR (reader.account_user_id IS NULL AND reader.guest_token_hash IS NOT NULL AND reader.expires_at>statement_timestamp()))
 )
$$;
CREATE OR REPLACE FUNCTION private.demand_reader_preferences(requested_principal_id uuid)
RETURNS TABLE(article_length text, depth integer)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(p.article_length::text,'standard'),coalesce(p.depth::integer,60)
 FROM private.demand_principals reader LEFT JOIN public.feed_preferences p ON p.user_id=reader.account_user_id
 WHERE reader.id=private.demand_reader_id(requested_principal_id) AND reader.account_user_id IS NOT NULL
 AND private.demand_principal_is_active(requested_principal_id)
$$;
CREATE FUNCTION private.demand_reader_owns(requested_principal_id uuid)
RETURNS boolean LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT private.demand_principal_is_active(requested_principal_id)
  AND private.demand_reader_id(requested_principal_id)=private.demand_reader_id(private.current_active_demand_principal_id())
$$;
REVOKE ALL ON FUNCTION private.demand_reader_owns(uuid) FROM PUBLIC,anon,authenticated,service_role,edison_api,edison_public,edison_demand_worker;
GRANT EXECUTE ON FUNCTION private.demand_reader_owns(uuid) TO edison_demand_api;

-- Broaden only reader-scoped rows to the same verified, claimed reader. The
-- browser still has no table privileges and cannot set a server principal.
ALTER POLICY demand_loops_api_select_own ON private.demand_loops USING(private.demand_reader_owns(principal_id));
ALTER POLICY demand_requests_api_select_own ON private.demand_requests USING(private.demand_reader_owns(principal_id));
ALTER POLICY demand_ideas_api_select_own ON private.demand_ideas USING(private.demand_reader_owns(principal_id));
ALTER POLICY demand_stages_api_select_own ON private.demand_stages USING(private.demand_reader_owns(principal_id));
ALTER POLICY demand_mutations_api_select_own ON private.demand_mutations USING(private.demand_reader_owns(principal_id));
ALTER POLICY demand_events_api_select_own ON private.demand_events USING(private.demand_reader_owns(principal_id));
-- Writes still use the exact original principal scope; service ownership
-- resolution selects it only after checking the authenticated reader group.

CREATE FUNCTION private.protect_demand_allowance_record()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'reader allowance records are immutable' USING ERRCODE='23514'; END
$$;
REVOKE ALL ON FUNCTION private.protect_demand_allowance_record() FROM PUBLIC;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['demand_principal_claims','demand_allowance_grants','demand_allowance_allocations','demand_allowance_carryovers','demand_allowance_resets','demand_allowance_reset_attempts'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE private.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role,edison_api,edison_public,edison_demand_api,edison_demand_worker',name);
  EXECUTE format('GRANT SELECT,INSERT ON private.%I TO edison_demand_worker',name);
  EXECUTE format('CREATE POLICY %I ON private.%I FOR SELECT TO edison_demand_worker USING(true)',name||'_worker_select',name);
  EXECUTE format('CREATE POLICY %I ON private.%I FOR INSERT TO edison_demand_worker WITH CHECK(true)',name||'_worker_insert',name);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.protect_demand_allowance_record()',name||'_immutable',name);
 END LOOP;
END $$;
