-- Explicitly opted-in, immutable on-demand reading copies. This is separate
-- from legacy article_shares: no existing publication contract is weakened.
CREATE TABLE private.demand_public_shares (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES private.demand_principals(id) ON DELETE RESTRICT,
  article_request_id uuid NOT NULL,
  token text NOT NULL UNIQUE CHECK (token ~ '^[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL,
  snapshot_fingerprint text NOT NULL CHECK (snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT demand_public_shares_article_unique UNIQUE (principal_id, article_request_id),
  CONSTRAINT demand_public_shares_owner_id_unique UNIQUE (principal_id, article_request_id, id),
  CONSTRAINT demand_public_shares_request_owner_fk FOREIGN KEY (principal_id, article_request_id)
    REFERENCES private.demand_requests(principal_id, id) ON DELETE RESTRICT,
  CONSTRAINT demand_public_shares_snapshot_valid CHECK (
    jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 262144
    AND snapshot->>'version' = '1'
    AND snapshot ?& ARRAY['version','title','deck','body','sources','sourceCount','basis',
      'researchedAt','readingMinutes','publishedAt','correction']
    AND snapshot - ARRAY['version','title','deck','body','sources','sourceCount','basis',
      'researchedAt','readingMinutes','publishedAt','correction'] = '{}'::jsonb
    AND jsonb_typeof(snapshot->'body') = 'array'
    AND jsonb_typeof(snapshot->'sources') = 'array'
  ),
  CONSTRAINT demand_public_shares_revocation_valid CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX demand_public_shares_principal_created_idx ON private.demand_public_shares(principal_id, created_at);

-- Remember keys even when an operation reused a previously shared version.
CREATE TABLE private.demand_share_operations (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  principal_id uuid NOT NULL,
  article_request_id uuid NOT NULL,
  share_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 8 AND 128 AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demand_share_operations_key_unique UNIQUE (principal_id, idempotency_key),
  CONSTRAINT demand_share_operations_share_owner_fk FOREIGN KEY (principal_id, article_request_id, share_id)
    REFERENCES private.demand_public_shares(principal_id, article_request_id, id) ON DELETE RESTRICT
);
CREATE INDEX demand_share_operations_principal_created_idx ON private.demand_share_operations(principal_id, created_at);

CREATE FUNCTION private.protect_demand_public_share()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'public demand reading cannot be hard deleted' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.id, NEW.principal_id, NEW.article_request_id, NEW.token, NEW.snapshot,
    NEW.snapshot_fingerprint, NEW.created_at) IS DISTINCT FROM
    ROW(OLD.id, OLD.principal_id, OLD.article_request_id, OLD.token, OLD.snapshot,
    OLD.snapshot_fingerprint, OLD.created_at)
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'public demand reading is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_demand_public_share() FROM PUBLIC;
CREATE TRIGGER demand_public_shares_immutable BEFORE UPDATE OR DELETE ON private.demand_public_shares
  FOR EACH ROW EXECUTE FUNCTION private.protect_demand_public_share();

CREATE FUNCTION private.protect_demand_share_operation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'public sharing operations are immutable' USING ERRCODE = '23514';
END;
$$;
REVOKE ALL ON FUNCTION private.protect_demand_share_operation() FROM PUBLIC;
CREATE TRIGGER demand_share_operations_immutable BEFORE UPDATE OR DELETE ON private.demand_share_operations
  FOR EACH ROW EXECUTE FUNCTION private.protect_demand_share_operation();

ALTER TABLE private.demand_public_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.demand_public_shares FORCE ROW LEVEL SECURITY;
ALTER TABLE private.demand_share_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.demand_share_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY demand_public_shares_worker_select ON private.demand_public_shares
  FOR SELECT TO edison_demand_worker USING (true);
CREATE POLICY demand_public_shares_worker_insert ON private.demand_public_shares
  FOR INSERT TO edison_demand_worker WITH CHECK (private.demand_principal_is_active(principal_id));
CREATE POLICY demand_share_operations_worker_select ON private.demand_share_operations
  FOR SELECT TO edison_demand_worker USING (true);
CREATE POLICY demand_share_operations_worker_insert ON private.demand_share_operations
  FOR INSERT TO edison_demand_worker WITH CHECK (private.demand_principal_is_active(principal_id));
REVOKE ALL ON TABLE private.demand_public_shares, private.demand_share_operations
  FROM PUBLIC, anon, authenticated, service_role, edison_api, edison_public, edison_demand_api, edison_demand_worker;
GRANT SELECT, INSERT ON TABLE private.demand_public_shares, private.demand_share_operations TO edison_demand_worker;

-- The function deliberately projects nested blocks/sources too: a malformed
-- privileged insert cannot make arbitrary private JSON fields publicly readable.
-- Guest expiry and loop rename/archive do not undo an explicit publication.
CREATE FUNCTION edison_public_api.read_demand_article_share(requested_token text)
RETURNS TABLE(token text, snapshot jsonb, created_at timestamptz)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT s.token, jsonb_build_object(
    'version', s.snapshot->'version', 'title', s.snapshot->'title', 'deck', s.snapshot->'deck',
    'body', (SELECT coalesce(jsonb_agg(CASE
      WHEN b.value->>'type' = 'heading' THEN jsonb_build_object('type','heading','level',b.value->'level','text',b.value->'text')
      ELSE jsonb_build_object('type',b.value->'type','text',b.value->'text','citations',
        (SELECT coalesce(jsonb_agg(jsonb_build_object('sourceId',c.value->'sourceId','label',c.value->'label') ORDER BY c.ordinality), '[]'::jsonb)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.value->'citations') = 'array' THEN b.value->'citations' ELSE '[]'::jsonb END)
          WITH ORDINALITY c(value, ordinality)))
        || CASE WHEN b.value->>'type' = 'quote' THEN jsonb_build_object('attribution',b.value->'attribution') ELSE '{}'::jsonb END
      END ORDER BY b.ordinality), '[]'::jsonb)
      FROM jsonb_array_elements(s.snapshot->'body') WITH ORDINALITY b(value, ordinality)),
    'sources', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',v.value->'id','title',v.value->'title','publisher',v.value->'publisher','url',v.value->'url',
      'publishedAt',v.value->'publishedAt','accessedAt',v.value->'accessedAt') ORDER BY v.ordinality), '[]'::jsonb)
      FROM jsonb_array_elements(s.snapshot->'sources') WITH ORDINALITY v(value, ordinality)),
    'sourceCount',s.snapshot->'sourceCount','basis',s.snapshot->'basis','researchedAt',s.snapshot->'researchedAt',
    'readingMinutes',s.snapshot->'readingMinutes','publishedAt',s.snapshot->'publishedAt',
    'correction',CASE WHEN jsonb_typeof(s.snapshot->'correction') = 'object'
      THEN jsonb_build_object('note',s.snapshot->'correction'->'note','correctedAt',s.snapshot->'correction'->'correctedAt')
      ELSE 'null'::jsonb END
  ), s.created_at
  FROM private.demand_public_shares s
  WHERE requested_token ~ '^[0-9a-f]{64}$' AND s.token = requested_token AND s.revoked_at IS NULL
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION edison_public_api.read_demand_article_share(text)
  FROM PUBLIC, anon, authenticated, service_role, edison_api, edison_demand_api, edison_demand_worker;
GRANT EXECUTE ON FUNCTION edison_public_api.read_demand_article_share(text) TO edison_public;
